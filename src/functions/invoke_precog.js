/* jshint node: true, esversion: 11 */
/**
 * OpenAI function definition for invoke_precog
 * Used in Phase 3: Dev Tooling Integration
 */

export const invokePrecogFunction = {
  name: "invoke_precog",
  description: "Invoke a Precogs oracle to analyze schema or HTML content using domain-specific knowledge. Returns a job_id and stream URL for real-time results. Prefer inline content when user provides schema or HTML snippets.",
  parameters: {
    type: "object",
    properties: {
      kb: {
        type: "string",
        description: "Knowledge base identifier. Defaults to 'schema-foundation' for schema precog, 'general' otherwise.",
        enum: ["general", "schema-foundation", "siding-services", "cladding"],
        default: "schema-foundation",
      },
      precog: {
        type: "string",
        description: "Precog type to invoke",
        enum: ["schema", "faq", "pricing"],
      },
      content_source: {
        type: "string",
        description: "Source of content: 'inline' for pasted HTML/JSON-LD snippets, 'url' for web page URLs. Defaults to 'inline'.",
        enum: ["inline", "url"],
        default: "inline",
      },
      content: {
        type: "string",
        description: "Inline content (HTML or JSON-LD snippet) when content_source is 'inline'. Preferred when user provides schema or HTML in chat.",
      },
      url: {
        type: "string",
        description: "Target URL to analyze. Only use when content_source is 'url' or user explicitly provides a URL.",
      },
      type: {
        type: "string",
        description: "Context type (e.g., 'Service', 'Product', 'Article')",
      },
      task: {
        type: "string",
        description: "Task description or prompt. Defaults to 'validate' for schema precog, 'Run {precog}' otherwise.",
      },
    },
    required: ["precog"],
  },
};

/**
 * Execute the invoke_precog function
 * Creates a job and returns job_id + stream URL
 */
export async function executeInvokePrecog(args, baseUrl = "https://precogs.croutons.ai") {
  const { insertJob } = await import("../db.js");
  const { enqueueJob } = await import("../redis.js");

  // Extract parameters with defaults
  const {
    kb = args.precog === "schema" ? "schema-foundation" : "general",
    precog,
    content_source = "inline",
    content,
    url,
    type,
    task,
  } = args;
  
  // Validate kb is a known value
  const validKBs = ["general", "schema-foundation", "siding-services", "cladding"];
  const kbValue = validKBs.includes(kb) ? kb : (precog === "schema" ? "schema-foundation" : "general");

  // Validate required parameters
  if (!precog) {
    throw new Error("precog is required");
  }

  // Validate content source requirements
  if (content_source === "inline" && !content) {
    throw new Error("content is required when content_source is 'inline'");
  }
  if (content_source === "url" && !url) {
    throw new Error("url is required when content_source is 'url'");
  }

  const context = {
    kb: kbValue,
    content_source,
  };
  if (type) context.type = type;
  if (content_source === "inline" && content) {
    context.content = content;
  }
  if (content_source === "url" && url) {
    context.url = url;
  }

  // Default task based on precog type
  const jobTask = task || (precog === "schema" ? "validate" : `Run ${precog}`);

  // Create job
  const job = await insertJob(precog, jobTask, context);

  // Enqueue job to Redis Stream
  if (process.env.REDIS_URL) {
    try {
      await enqueueJob(job.id, precog, jobTask, context);
    } catch (redisErr) {
      console.error("[invoke_precog] Redis enqueue failed:", redisErr.message);
      // Continue anyway - job is in DB
    }
  }

  // Build URLs (prefer POST for inline, GET for URL)
  const params = new URLSearchParams({ precog, kb: kbValue });
  if (type) params.set("type", type);
  if (jobTask !== `Run ${precog}`) params.set("task", jobTask);

  // Return structured result for LLM
  return {
    job_id: job.id,
    status: "pending",
    stream_url: `${baseUrl}/v1/jobs/${job.id}/events`,
    ndjson_url: content_source === "inline" 
      ? `${baseUrl}/v1/run.ndjson` // POST endpoint
      : `${baseUrl}/v1/run.ndjson?${params.toString()}&url=${encodeURIComponent(url)}`,
    cli_url: `${baseUrl}/cli?${params.toString()}${url ? `&url=${encodeURIComponent(url)}` : ""}`,
    message: `Precog job created. Job ID: ${job.id}. Stream results at: ${baseUrl}/cli?${params.toString()}`,
  };
}

