#!/usr/bin/env node
/**
 * Check Redis connection and status
 * Usage: node scripts/check-redis.js
 */

import "dotenv/config";

async function checkRedis() {
  try {
    if (!process.env.REDIS_URL) {
      console.log("⚠️  REDIS_URL not set in environment");
      console.log("   Redis is optional - API will work without it");
      process.exit(0);
    }

    console.log("🔍 Testing Redis connection...");
    console.log(`   REDIS_URL: ${process.env.REDIS_URL.replace(/:[^:@]+@/, ':****@')}`);

    const { testRedis } = await import("../src/redis.js");
    const result = await testRedis();

    if (result) {
      console.log("✅ Redis connection: OK");
    } else {
      console.log("❌ Redis connection: FAILED");
      console.log("   Check REDIS_URL and Redis service status");
    }

    process.exit(result ? 0 : 1);
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("   Stack:", error.stack);
    process.exit(1);
  }
}

checkRedis();
