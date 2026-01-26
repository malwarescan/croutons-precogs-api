#!/usr/bin/env node
/**
 * Cleanup stuck pending jobs older than 1 day
 * Usage: node scripts/cleanup-stuck-jobs.js
 */

import "dotenv/config";
import { pool } from "../src/db.js";

async function cleanupStuckJobs() {
  try {
    console.log("🔍 Checking for stuck pending jobs...");

    // Find stuck jobs
    const stuckJobs = await pool.query(`
      SELECT id, precog, prompt, created_at, 
             EXTRACT(EPOCH FROM (NOW() - created_at)) as age_seconds
      FROM precogs.jobs
      WHERE status = 'pending'
        AND created_at < NOW() - INTERVAL '1 day'
      ORDER BY created_at ASC
    `);

    if (stuckJobs.rows.length === 0) {
      console.log("✅ No stuck jobs found!");
      process.exit(0);
    }

    console.log(`\n📋 Found ${stuckJobs.rows.length} stuck job(s):`);
    stuckJobs.rows.forEach((job) => {
      const ageDays = (job.age_seconds / 86400).toFixed(1);
      console.log(`  - Job ${job.id}: ${job.precog} (${ageDays} days old)`);
    });

    // Clean them up
    const result = await pool.query(`
      UPDATE precogs.jobs
      SET status = 'error',
          error = 'Stuck job cleaned up - older than 1 day',
          completed_at = NOW()
      WHERE status = 'pending'
        AND created_at < NOW() - INTERVAL '1 day'
      RETURNING id
    `);

    console.log(`\n✅ Cleaned up ${result.rows.length} stuck job(s)`);
    console.log(`   Job IDs: ${result.rows.map((r) => r.id).join(", ")}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

cleanupStuckJobs();
