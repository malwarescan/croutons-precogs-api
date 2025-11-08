/* jshint node: true, esversion: 11 */
import { createClient } from "redis";
import "dotenv/config";

let redisClient = null;

export async function getRedis() {
  if (!redisClient) {
    if (!process.env.REDIS_URL) {
      throw new Error("REDIS_URL environment variable is required");
    }

    redisClient = createClient({
      url: process.env.REDIS_URL,
    });

    redisClient.on("error", (e) => console.error("[redis] error", e));
    await redisClient.connect();
    console.log("[redis] Connected");
  }
  return redisClient;
}

