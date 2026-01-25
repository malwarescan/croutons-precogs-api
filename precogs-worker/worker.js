/* jshint node: true, esversion: 11 */
import { getRedis } from "./src/redis.js";
import { updateJobStatus, insertEvent, getJob } from "./src/db.js";
import { loadKB } from "./src/kb.js";
import {
  validateJsonLdAgainstRules,
  buildRecommendations,
  prettyPrintResult,
} from "./src/validateSchema.js";
import { processHomePrecog } from "./src/homePrecog.js";
import { processBkkMassagePrecog } from "./src/bkkMassagePrecog.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STREAM_NAME = "precogs:jobs";
const DLQ_STREAM = "precogs:jobs:dlq";
const CONSUMER_GROUP = "cg1";
const CONSUMER_NAME = `c1-${process.pid}`;
const GRAPH_BASE = process.env.GRAPH_BASE || "https://graph.croutons.ai";
const BLOCK_TIME = 10000; // 10 seconds
const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_BASE = 1000; // 1 second base

let isShuttingDown = false;
let inFlightJobs = new Set();

// Load KB at startup (cache for performance)
let KB_CACHE = null;

function getKB(name = "schema-foundation") {
  if (!KB_CACHE) {
    KB_CACHE = loadKB(name);
  }
  return KB_CACHE;
}

// Extract JSON-LD from HTML content
function extractJSONLD(content) {
  // Try parsing as direct JSON first
  try {
    const parsed = JSON.parse(content);
    if (parsed["@type"] || parsed["@context"]) {
      // Handle @graph - extract each item separately
      if (parsed["@graph"] && Array.isArray(parsed["@graph"])) {
        return parsed["@graph"];
      }
      return [parsed];
    }
  } catch (e) {
    // Not JSON, try HTML parsing
  }

  // Extract from HTML script tags
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  const matches = [];
  let match;
  while ((match = jsonLdRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      // Handle @graph - extract each item separately
      if (parsed["@graph"] && Array.isArray(parsed["@graph"])) {
        matches.push(...parsed["@graph"]);
      } else {
        matches.push(parsed);
      }
    } catch (e) {
      console.warn("[worker] Failed to parse JSON-LD:", e.message);
    }
  }
  return matches;
}

async function initConsumerGroup() {
  const redis = await getRedis();
  try {
    await redis.xGroupCreate(STREAM_NAME, CONSUMER_GROUP, "$", { MKSTREAM: true });
    console.log(`[worker] Created consumer group ${CONSUMER_GROUP} on ${STREAM_NAME}`);
  } catch (e) {
    if (e.message.includes("BUSYGROUP")) {
      console.log(`[worker] Consumer group ${CONSUMER_GROUP} already exists`);
    } else {
      throw e;
    }
  }
}

async function processJob(jobId, precog, prompt, context, retryCount = 0) {
  const startTime = Date.now();
  const kb = context?.kb || (precog.startsWith("home") ? "home-foundation" : "general");
  const contentSource = context?.content_source || "inline";
  const content = context?.content;
  const url = context?.url;
  const type = context?.type;
  const region = context?.region;
  const domain = context?.domain;
  const vertical = context?.vertical;

  console.log(`[worker] Processing job ${jobId}: precog=${precog}, kb=${kb}, source=${contentSource}, retry=${retryCount}`);

  try {
    // Update job status to running
    await updateJobStatus(jobId, "running");

    // Process home domain precogs
    if (precog.startsWith("home")) {
      const task = context?.task || "diagnose";
      const emit = async (type, data) => {
        await insertEvent(jobId, type, data);
      };
      
      // Pass full context including region/domain/vertical
      const homeContext = {
        ...context,
        region,
        domain,
        vertical,
        content,
        task,
      };
      
      await processHomePrecog(jobId, precog, task, homeContext, emit);
      
      // Mark as complete after home precog finishes
      await insertEvent(jobId, "answer.complete", { ok: true });
      await updateJobStatus(jobId, "done");
      
      const elapsed = Date.now() - startTime;
      console.log(`[worker] Completed job ${jobId} in ${elapsed}ms`);
      return { success: true, elapsed };
    }
    // Process Bangkok Massage precog
    else if (precog === "bkk_massage") {
      const task = context?.task || "district_aware_ranking";
      const emit = async (type, data) => {
        await insertEvent(jobId, type, data);
      };
      
      // Pass full context including region (district)
      const bkkContext = {
        ...context,
        region, // District name (Asok, Nana, etc.)
        content,
        task,
      };
      
      await processBkkMassagePrecog(jobId, precog, task, bkkContext, emit);
      
      // Mark as complete after bkk massage precog finishes
      await insertEvent(jobId, "answer.complete", { ok: true });
      await updateJobStatus(jobId, "done");
      
      const elapsed = Date.now() - startTime;
      console.log(`[worker] Completed job ${jobId} in ${elapsed}ms`);
      return { success: true, elapsed };
    }
    // Process schema precog with KB validation
    else if (precog === "schema" && kb === "schema-foundation") {
      const kbData = getKB(kb);
      
      await insertEvent(jobId, "grounding.chunk", {
        count: 1,
        source: `KB: ${kb}`,
        rules_loaded: !!kbData.types && Object.keys(kbData.types).length > 0,
        types_loaded: Object.keys(kbData.types || {}),
      });

      // Process based on content source
      if (contentSource === "inline" && content) {
        // Extract JSON-LD from inline content
        const schemas = extractJSONLD(content);
        
        if (schemas.length === 0) {
          await insertEvent(jobId, "answer.delta", {
            text: `⚠️ No JSON-LD found in content. Please provide a <script type="application/ld+json"> block or valid JSON-LD.\n\n`,
          });
        } else {
          // Validate each schema against KB rules
          for (const schema of schemas) {
            const schemaType = type || schema["@type"];
            const rules = schemaType ? kbData.types[schemaType] : null;

            if (!rules) {
              await insertEvent(jobId, "answer.delta", {
                text: `⚠️ No KB rules found for @type=${schemaType || "unknown"}. Available types: ${Object.keys(kbData.types).join(", ")}\n\n`,
              });
              // Still output the schema
              await insertEvent(jobId, "answer.delta", {
                text: `📦 JSON-LD:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n`,
              });
              continue;
            }

            // Validate against rules
            const issues = validateJsonLdAgainstRules(schema, rules);
            const recommendations = buildRecommendations(schema, rules);
            const output = prettyPrintResult(schemaType, issues, recommendations, schema);

            await insertEvent(jobId, "answer.delta", {
              text: output,
            });
          }
        }
      } else if (contentSource === "url" && url) {
        // URL mode - fetch and process
        await insertEvent(jobId, "answer.delta", {
          text: `Fetching URL: ${url}\n`,
        });
        
        try {
          // Fetch HTML from URL
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Croutons-Precog/1.0'
            }
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const html = await response.text();
          await insertEvent(jobId, "answer.delta", {
            text: `✅ Fetched ${html.length} bytes\nExtracting JSON-LD schemas...\n`,
          });
          
          // Extract JSON-LD from HTML
          const schemas = extractJSONLD(html);
          
          if (schemas.length === 0) {
            await insertEvent(jobId, "answer.delta", {
              text: `⚠️ No JSON-LD schemas found in ${url}\n`,
            });
          } else {
            await insertEvent(jobId, "answer.delta", {
              text: `Found ${schemas.length} JSON-LD schema(s)\n\n`,
            });
            
            // Validate each schema
            for (const schema of schemas) {
              const schemaType = schema["@type"] || (Array.isArray(schema["@type"]) ? schema["@type"][0] : "Unknown");
              const normalizedType = Array.isArray(schemaType) ? schemaType[0] : schemaType;
              const typeToUse = type || normalizedType;
              
              // Get rules for this schema type
              const rules = typeToUse ? kbData.types[typeToUse] : null;
              
              // Check if type matches requested type (if specified)
              if (type && normalizedType !== type) {
                await insertEvent(jobId, "answer.delta", {
                  text: `⏭️  Skipping ${normalizedType} (requested: ${type})\n`,
                });
                continue;
              }
              
              if (!rules) {
                await insertEvent(jobId, "answer.delta", {
                  text: `⚠️ No KB rules found for @type=${typeToUse || "unknown"}. Available types: ${Object.keys(kbData.types).join(", ")}\n\n`,
                });
                // Still output the schema
                await insertEvent(jobId, "answer.delta", {
                  text: `📦 JSON-LD:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n`,
                });
                continue;
              }
              
              // Validate against rules
              const issues = validateJsonLdAgainstRules(schema, rules);
              const recommendations = buildRecommendations(schema, rules);
              const output = prettyPrintResult(typeToUse, issues, recommendations, schema);
              
              await insertEvent(jobId, "answer.delta", {
                text: output,
              });
            }
          }
        } catch (error) {
          await insertEvent(jobId, "answer.delta", {
            text: `❌ Error processing URL: ${error.message}\n`,
          });
        }
      } else {
        await insertEvent(jobId, "answer.delta", {
          text: `⚠️ No content or URL provided. Please provide inline content or a URL.\n`,
        });
      }
    } else {
      // Non-schema precog or different KB - use fallback
      await insertEvent(jobId, "grounding.chunk", {
        count: 1,
        source: `${GRAPH_BASE}/api/triples`,
      });

      if (contentSource === "inline" && content) {
        const schemas = extractJSONLD(content);
        if (schemas.length > 0) {
          await insertEvent(jobId, "answer.delta", {
            text: `Found ${schemas.length} JSON-LD schema(s):\n\`\`\`json\n${JSON.stringify(schemas, null, 2)}\n\`\`\`\n`,
          });
        }
      } else if (contentSource === "url" && url) {
        try {
          await insertEvent(jobId, "answer.delta", {
            text: `Fetching URL: ${url}\n`,
          });
          const response = await fetch(url, {
            headers: { 'User-Agent': 'Croutons-Precog/1.0' }
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const html = await response.text();
          const schemas = extractJSONLD(html);
          if (schemas.length > 0) {
            await insertEvent(jobId, "answer.delta", {
              text: `Found ${schemas.length} JSON-LD schema(s):\n\`\`\`json\n${JSON.stringify(schemas, null, 2)}\n\`\`\`\n`,
            });
          } else {
            await insertEvent(jobId, "answer.delta", {
              text: `No JSON-LD schemas found in ${url}\n`,
            });
          }
        } catch (error) {
          await insertEvent(jobId, "answer.delta", {
            text: `Error fetching URL: ${error.message}\n`,
          });
        }
      }
    }

    // Mark as complete
    await insertEvent(jobId, "answer.complete", { ok: true });
    await updateJobStatus(jobId, "done");

    const elapsed = Date.now() - startTime;
    console.log(`[worker] Completed job ${jobId} in ${elapsed}ms`);
    return { success: true, elapsed };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[worker] Error processing job ${jobId} (attempt ${retryCount + 1}):`, error.message);

    // Retry with exponential backoff
    if (retryCount < MAX_RETRIES) {
      const backoff = RETRY_BACKOFF_BASE * Math.pow(2, retryCount);
      console.log(`[worker] Retrying job ${jobId} after ${backoff}ms`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      return processJob(jobId, precog, prompt, context, retryCount + 1);
    }

    // Max retries exceeded - mark as error
    await updateJobStatus(jobId, "error", error.message);
    await insertEvent(jobId, "error", { message: error.message, retries: retryCount + 1 });

    // Send to dead letter queue
    try {
      const redis = await getRedis();
      const payload = JSON.stringify({ job_id: jobId, precog, prompt, context, error: error.message, retries: retryCount + 1 });
      await redis.xAdd(DLQ_STREAM, "*", { payload });
      console.log(`[worker] Sent job ${jobId} to DLQ after ${retryCount + 1} retries`);
    } catch (dlqError) {
      console.error(`[worker] Failed to send job ${jobId} to DLQ:`, dlqError.message);
    }

    return { success: false, elapsed, error: error.message };
  }
}

async function consumeJobs() {
  const redis = await getRedis();

  while (!isShuttingDown) {
    try {
      // Read from consumer group
      // Redis v4 API: xReadGroup(streams, group, consumer, options)
      const messages = await redis.xReadGroup(
        CONSUMER_GROUP,
        CONSUMER_NAME,
        [
          {
            key: STREAM_NAME,
            id: ">", // Read new messages
          },
        ],
        {
          COUNT: BATCH_SIZE,
          BLOCK: BLOCK_TIME,
        }
      );

      if (!messages || messages.length === 0) {
        continue;
      }

      // Messages format: [{ name: 'precogs:jobs', messages: [{ id: '...', message: { payload: '...' } }] }]
      for (const stream of messages) {
        if (stream.name !== STREAM_NAME) continue;

        for (const msg of stream.messages) {
          if (isShuttingDown) {
            console.log("[worker] Shutdown requested, stopping message processing");
            break;
          }

          try {
            const payload = msg.message.payload;
            const jobData = JSON.parse(payload);
            const { job_id: jobId, precog, prompt, context } = jobData;

            inFlightJobs.add(jobId);

            // Process the job
            const result = await processJob(jobId, precog, prompt, context || {});

            // Acknowledge the message only on success or final failure
            await redis.xAck(STREAM_NAME, CONSUMER_GROUP, msg.id);
            console.log(`[worker] Acknowledged message ${msg.id} for job ${jobId} (${result.success ? "ok" : "error"})`);

            inFlightJobs.delete(jobId);
          } catch (jobError) {
            console.error(`[worker] Error processing message ${msg.id}:`, jobError);
            // Don't ack on error - let it be retried by Redis
            const jobId = JSON.parse(msg.message.payload)?.job_id;
            if (jobId) inFlightJobs.delete(jobId);
          }
        }
      }
    } catch (error) {
      if (isShuttingDown) {
        console.log("[worker] Shutdown requested, exiting consume loop");
        break;
      }
      console.error("[worker] Error in consume loop:", error);
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  // Wait for in-flight jobs to complete
  if (inFlightJobs.size > 0) {
    console.log(`[worker] Waiting for ${inFlightJobs.size} in-flight jobs to complete...`);
    const maxWait = 30000; // 30 seconds max
    const startWait = Date.now();
    while (inFlightJobs.size > 0 && Date.now() - startWait < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (inFlightJobs.size > 0) {
      console.log(`[worker] ${inFlightJobs.size} jobs still in flight after ${maxWait}ms`);
    }
  }
}

async function main() {
  console.log("[worker] Starting precogs-worker...");
  console.log(`[worker] GRAPH_BASE=${GRAPH_BASE}`);
  console.log(`[worker] Consumer: ${CONSUMER_NAME}`);

  // Initialize consumer group
  await initConsumerGroup();

  // Start consuming
  console.log("[worker] Starting job consumption...");
  await consumeJobs();
}

// Handle graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`[worker] ${signal} received, shutting down gracefully...`);
  isShuttingDown = true;

  // Wait for in-flight jobs (handled in consumeJobs)
  // Give it a moment for the loop to exit
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Close Redis connection
  try {
    const redis = await getRedis();
    await redis.quit();
    console.log("[worker] Redis connection closed");
  } catch (e) {
    console.error("[worker] Error closing Redis:", e);
  }

  console.log("[worker] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

main().catch((error) => {
  console.error("[worker] Fatal error:", error);
  process.exit(1);
});

