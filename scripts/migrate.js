/* jshint node: true, esversion: 11 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway") 
    ? { rejectUnauthorized: false }
    : false,
});

(async () => {
  console.log("[migrate] Running precogs migrations...");

  const client = await pool.connect();
  try {
    // Ensure precogs schema exists first
    await client.query(`CREATE SCHEMA IF NOT EXISTS precogs;`);
    
    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS precogs.schema_migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const appliedRes = await client.query(
      `SELECT filename FROM precogs.schema_migrations;`
    );
    const already = new Set(appliedRes.rows.map((r) => r.filename));

    const migrationsDir = join(__dirname, "..", "migrations");
    const migrationFiles = ["001_init_precogs.sql"];

    let appliedCount = 0;
    for (const fname of migrationFiles) {
      if (already.has(fname)) {
        console.log(`⏭️  Skipping ${fname} (already applied)`);
        continue;
      }

      const fullPath = join(migrationsDir, fname);
      const sql = readFileSync(fullPath, "utf8");

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO precogs.schema_migrations (filename) VALUES ($1);`,
          [fname]
        );
        await client.query("COMMIT");
        console.log(`✅ Applied ${fname}`);
        appliedCount++;
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(`❌ Failed ${fname}:`, e.message);
        throw e;
      }
    }

    console.log(
      appliedCount > 0
        ? `Migrations applied: ${appliedCount}`
        : "No new migrations."
    );
  } finally {
    client.release();
    await pool.end();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

