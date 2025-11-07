/* jshint node: true, esversion: 11 */
import { createClient } from "redis";
import "dotenv/config";

let redisClient = null;

export async function getRedis() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL,
    });

    redisClient.on("error", (e) => console.error("[redis] error", e));
    await redisClient.connect();
  }
  return redisClient;
}

export async function enqueueJob(jobId, precog, prompt, context) {
  const redis = await getRedis();
  const payload = JSON.stringify({ job_id: jobId, precog, prompt, context });
  const id = await redis.xAdd("precogs:jobs", "*", { payload });
  return id;
}

export async function testRedis() {
  try {
    const redis = await getRedis();
    const pong = await redis.ping();
    console.log("[redis] Connection test:", pong);
    return true;
  } catch (e) {
    console.error("[redis] Connection failed:", e.message);
    return false;
  }
}

