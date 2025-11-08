/* jshint node: true, esversion: 11 */
import { getRedis } from "./src/redis.js";
import { updateJobStatus, insertEvent, getJob } from "./src/db.js";
import "dotenv/config";

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
  console.log(`[worker] Processing job ${jobId}: precog=${precog}, retry=${retryCount}`);

  try {
    // Update job status to running
    await updateJobStatus(jobId, "running");

    // Fetch grounding from graph service
    // TODO: Implement actual grounding fetch based on precog type
    // For now, emit a placeholder grounding event
    await insertEvent(jobId, "grounding.chunk", {
      count: 1,
      source: `${GRAPH_BASE}/api/triples`,
    });

    // Simulate processing (replace with actual precog logic)
    await insertEvent(jobId, "answer.delta", {
      text: `Processing precog "${precog}" with prompt: ${prompt.substring(0, 50)}...`,
    });

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

