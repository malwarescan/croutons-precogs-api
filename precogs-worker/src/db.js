/* jshint node: true, esversion: 11 */
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway")
    ? { rejectUnauthorized: false }
    : false,
});

export async function getJob(jobId) {
  const { rows } = await pool.query(
    `SELECT * FROM precogs.jobs WHERE id = $1`,
    [jobId]
  );
  return rows[0] || null;
}

export async function updateJobStatus(jobId, status, error = null) {
  const updates = [];
  const params = [];
  let paramIdx = 1;

  updates.push(`status = $${paramIdx++}`);
  params.push(status);

  if (status === "running" && !updates.includes("started_at")) {
    updates.push(`started_at = NOW()`);
  }
  if (status === "done" || status === "error") {
    updates.push(`completed_at = NOW()`);
  }
  if (error) {
    updates.push(`error = $${paramIdx++}`);
    params.push(error);
  }

  params.push(jobId);
  await pool.query(
    `UPDATE precogs.jobs SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
    params
  );
}

export async function insertEvent(jobId, type, data) {
  await pool.query(
    `INSERT INTO precogs.events (job_id, type, data)
     VALUES ($1, $2, $3)`,
    [jobId, type, JSON.stringify(data)]
  );
}

export { pool };

