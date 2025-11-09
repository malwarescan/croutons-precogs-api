/* jshint node: true, esversion: 11 */
/**
 * OpenAI function definition for invoke_precog
 * Used in Phase 3: Dev Tooling Integration
 */

export const invokePrecogFunction = {
  name: "invoke_precog",
  description: "Invoke a Precogs oracle to analyze a URL using domain-specific knowledge. Returns a job_id and stream URL for real-time results.",
  parameters: {
    type: "object",
    properties: {
      kb: {
        type: "string",
        description: "Knowledge base identifier (e.g., 'siding-services', 'cladding', 'general'). Defaults to 'general' if not specified.",
        enum: ["general", "siding-services", "cladding"],
      },
      precog: {
        type: "string",
        description: "Precog type to invoke",
        enum: ["schema", "faq", "pricing"],
      },
      url: {
        type: "string",
        description: "Target URL to analyze",
      },
      type: {
        type: "string",
        description: "Context type (e.g., 'Service', 'Product', 'Article')",
      },
      task: {
        type: "string",
        description: "Task description or prompt. If not provided, defaults to 'Run {precog}'",
      },
    },
    required: ["precog", "url"],
  },
};

/**
 * Execute the invoke_precog function
 * Creates a job and returns job_id + stream URL
 */
export async function executeInvokePrecog(args, baseUrl = "https://precogs.croutons.ai") {
  const { insertJob } = await import("../db.js");
  const { enqueueJob } = await import("../redis.js");

  const { kb = "general", precog, url, type, task } = args;

  // Validate required parameters
  if (!precog || !url) {
    throw new Error("precog and url are required");
  }

  const context = {};
  if (type) context.type = type;

  // Create job
  const job = await insertJob(precog, task || `Run ${precog}`, { ...context, kb, url });

  // Enqueue job to Redis Stream
  if (process.env.REDIS_URL) {
    try {
      await enqueueJob(job.id, precog, task || `Run ${precog}`, { ...context, kb, url });
    } catch (redisErr) {
      console.error("[invoke_precog] Redis enqueue failed:", redisErr.message);
      // Continue anyway - job is in DB
    }
  }

  // Return structured result for LLM
  return {
    job_id: job.id,
    status: "pending",
    stream_url: `${baseUrl}/v1/jobs/${job.id}/events`,
    ndjson_url: `${baseUrl}/v1/run.ndjson?precog=${precog}&url=${encodeURIComponent(url)}${type ? `&type=${encodeURIComponent(type)}` : ""}${task ? `&task=${encodeURIComponent(task)}` : ""}`,
    cli_url: `${baseUrl}/cli?precog=${precog}&url=${encodeURIComponent(url)}${type ? `&type=${encodeURIComponent(type)}` : ""}${task ? `&task=${encodeURIComponent(task)}` : ""}`,
    message: `Precog job created. Job ID: ${job.id}. Stream results at: ${baseUrl}/cli?precog=${precog}&url=${encodeURIComponent(url)}`,
  };
}

