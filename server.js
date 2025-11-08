// server.js
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { insertJob, getJob, getJobEvents, pool } from "./src/db.js";
import { enqueueJob } from "./src/redis.js";

const app = express();

// Simple in-memory rate limiter (per IP)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }

  const record = rateLimitStore.get(ip);
  
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + RATE_LIMIT_WINDOW;
    return next();
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({
      ok: false,
      error: "Rate limit exceeded",
      retryAfter: Math.ceil((record.resetAt - now) / 1000),
    });
  }

  record.count++;
  next();
}

// Cleanup old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now > record.resetAt) {
      rateLimitStore.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW * 2);

// CORS: restrict in production, permissive in dev
const corsOptions = process.env.NODE_ENV === "production"
  ? {
      origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(",")
        : ["https://precogs.croutons.ai"],
      credentials: true,
    }
  : { origin: true, credentials: true };
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// Bearer token authentication middleware (optional, enabled via API_KEY env var)
function requireAuth(req, res, next) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    // No API key set, skip auth
    return next();
  }

  const authHeader = req.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "Authorization required" });
  }

  const token = authHeader.slice(7);
  if (token !== apiKey) {
    return res.status(403).json({ ok: false, error: "Invalid token" });
  }

  next();
}

app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Optional Redis test endpoint
app.get("/health/redis", async (_req, res) => {
  try {
    if (!process.env.REDIS_URL) {
      return res.json({ ok: false, error: "REDIS_URL not set" });
    }
    const { testRedis } = await import("./src/redis.js");
    const result = await testRedis();
    res.json({ ok: result, redis: process.env.REDIS_URL ? "configured" : "not configured" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /v1/invoke - Create job and enqueue (requires auth if API_KEY is set, rate limited)
app.post("/v1/invoke", requireAuth, rateLimit, async (req, res) => {
  try {
    const { precog, prompt, context, stream } = req.body || {};
    if (!precog) {
      return res.status(400).json({ ok: false, error: "precog required" });
    }

    // Insert job into database (status=pending)
    const job = await insertJob(precog, prompt, context || {});

    // Enqueue job to Redis Stream
    if (process.env.REDIS_URL) {
      try {
        await enqueueJob(job.id, precog, prompt, context || {});
      } catch (redisErr) {
        console.error("[invoke] Redis enqueue failed:", redisErr.message);
        // Continue anyway - job is in DB, worker can poll DB if needed
      }
    }

    res.json({ ok: true, job_id: job.id, stream: !!stream });
  } catch (e) {
    console.error("[invoke] Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /v1/jobs/:id/events - Stream events as SSE
app.get("/v1/jobs/:id/events", async (req, res) => {
  try {
    // If auth is required, allow token in query param for EventSource (can't set headers)
    if (process.env.API_KEY) {
      const hdr = req.headers.authorization || "";
      const qtk = req.query.token ? `Bearer ${req.query.token}` : "";
      const expected = `Bearer ${process.env.API_KEY}`;
      
      if (hdr !== expected && qtk !== expected) {
        return res.status(401).json({ ok: false, error: "Authorization required" });
      }
    }

    const jobId = req.params.id;
    const job = await getJob(jobId);

    if (!job) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    });

    let lastEventId = null;
    const pollInterval = 500; // Poll every 500ms
    const maxPollTime = 300000; // Max 5 minutes
    const startTime = Date.now();
    let isActive = true;

    // SSE keep-alive heartbeat (prevents Cloudflare/edge idle timeout)
    const keepAliveInterval = setInterval(() => {
      if (isActive) {
        res.write(":keepalive\n\n");
      }
    }, 15000); // Every 15 seconds

    const pollEvents = async () => {
      try {
        const events = await getJobEvents(jobId, 1000);
        
        // Send only new events (after lastEventId)
        let sentAny = false;
        for (const event of events) {
          // Skip events we've already sent
          if (lastEventId !== null && event.id <= lastEventId) {
            continue;
          }
          
          // Parse JSONB data
          const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
          sse(res, event.type, data);
          lastEventId = event.id;
          sentAny = true;
        }

        // Check if job is complete
        const currentJob = await getJob(jobId);
        if (currentJob && (currentJob.status === "done" || currentJob.status === "error")) {
          if (currentJob.status === "error" && currentJob.error) {
            sse(res, "error", { message: currentJob.error });
          }
          isActive = false;
          clearInterval(keepAliveInterval);
          res.end();
          return;
        }

        // Continue polling if not done and within time limit
        if (Date.now() - startTime < maxPollTime) {
          setTimeout(pollEvents, pollInterval);
        } else {
          sse(res, "timeout", { message: "Polling timeout reached" });
          isActive = false;
          clearInterval(keepAliveInterval);
          res.end();
        }
      } catch (err) {
        console.error("[events] Poll error:", err);
        sse(res, "error", { message: err.message });
        isActive = false;
        clearInterval(keepAliveInterval);
        res.end();
      }
    };

    // Cleanup on client disconnect
    req.on("close", () => {
      isActive = false;
      clearInterval(keepAliveInterval);
    });

    // Start polling
    pollEvents();
  } catch (e) {
    console.error("[events] Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// GET /metrics - Prometheus-style metrics
app.get("/metrics", async (_req, res) => {
  try {
    res.set("Cache-Control", "no-cache"); // Don't cache metrics

    const metrics = {
      processed_total: 0,
      failed_total: 0,
      inflight_jobs: 0,
      oldest_pending_age_seconds: null,
      redis_lag_ms: null,
      build_sha: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_SHA || "unknown",
    };

    // Count processed jobs (done status)
    const processedRes = await pool.query(
      `SELECT COUNT(*) as count FROM precogs.jobs WHERE status = 'done'`
    );
    metrics.processed_total = parseInt(processedRes.rows[0].count, 10);

    // Count failed jobs (error status)
    const failedRes = await pool.query(
      `SELECT COUNT(*) as count FROM precogs.jobs WHERE status = 'error'`
    );
    metrics.failed_total = parseInt(failedRes.rows[0].count, 10);

    // Count inflight jobs (running status)
    const inflightRes = await pool.query(
      `SELECT COUNT(*) as count FROM precogs.jobs WHERE status = 'running'`
    );
    metrics.inflight_jobs = parseInt(inflightRes.rows[0].count, 10);

    // Find oldest pending job age
    const oldestRes = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) as age_seconds
       FROM precogs.jobs
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1`
    );
    if (oldestRes.rows.length > 0 && oldestRes.rows[0].age_seconds) {
      metrics.oldest_pending_age_seconds = parseFloat(oldestRes.rows[0].age_seconds);
    }

    // Redis lag: time since last processed event
    try {
      const lastEventRes = await pool.query(
        `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(ts))) * 1000 as lag_ms
         FROM precogs.events`
      );
      if (lastEventRes.rows.length > 0 && lastEventRes.rows[0].lag_ms !== null) {
        metrics.redis_lag_ms = parseFloat(lastEventRes.rows[0].lag_ms);
      }
    } catch (e) {
      // Ignore redis lag errors
    }

    res.json(metrics);
  } catch (e) {
    console.error("[metrics] Error:", e);
    res.status(500).json({ 
      ok: false, 
      error: e.message || String(e),
      details: process.env.DATABASE_URL ? "Database connection failed" : "DATABASE_URL not set"
    });
  }
});

// GET /v1/run.ndjson - Create job and stream events as NDJSON
app.get("/v1/run.ndjson", async (req, res) => {
  try {
    // Optional auth (header OR ?token= for browser)
    if (process.env.API_KEY) {
      const hdr = req.headers.authorization || "";
      const qtk = req.query.token ? `Bearer ${req.query.token}` : "";
      const expected = `Bearer ${process.env.API_KEY}`;
      
      if (hdr !== expected && qtk !== expected) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }
    }

    const precog = req.query.precog || "schema";
    const task = req.query.task || `Run ${precog}`;
    const ctx = {};
    if (req.query.url) ctx.url = req.query.url;
    if (req.query.type) ctx.type = req.query.type;

    // Create job
    const job = await insertJob(precog, task, ctx);
    
    // Enqueue job to Redis Stream
    if (process.env.REDIS_URL) {
      try {
        await enqueueJob(job.id, precog, task, ctx);
      } catch (redisErr) {
        console.error("[run.ndjson] Redis enqueue failed:", redisErr.message);
        // Continue anyway - job is in DB
      }
    }

    // NDJSON stream headers
    res.set({
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Transfer-Encoding": "chunked",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    });

    // Helper to write one NDJSON line
    const line = (obj) => {
      try {
        res.write(JSON.stringify(obj) + "\n");
      } catch (e) {
        // Client disconnected
        return false;
      }
      return true;
    };

    // Send initial ack
    if (!line({ type: "ack", job_id: job.id })) return;

    // Poll DB events and write each as NDJSON
    let lastId = 0;
    let open = true;
    req.on("close", () => {
      open = false;
    });

    // Heartbeat keeps proxies from closing idle streams
    const hb = setInterval(() => {
      if (open) line({ type: "heartbeat" });
    }, 15000);

    try {
      while (open) {
        const rows = await getJobEvents(job.id, 1000);
        
        for (const r of rows) {
          if (!open) break;
          
          const eventId = Number(r.id);
          if (eventId > lastId) {
            lastId = eventId;
            
            // Parse JSONB data if it's a string
            const data = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
            
            if (!line({ type: r.type, data: data, ts: r.ts })) {
              open = false;
              break;
            }
          }
        }

        const j = await getJob(job.id);
        if (j && (j.status === "done" || j.status === "error" || j.status === "cancelled")) {
          line({ type: "complete", status: j.status, error: j.error || null });
          break;
        }

        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (e) {
      line({ type: "error", message: String(e?.message || e) });
    } finally {
      clearInterval(hb);
      res.end();
    }
  } catch (e) {
    console.error("[run.ndjson] Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /run - Convenience redirect to NDJSON endpoint
app.get("/run", (req, res) => {
  const target = "/v1/run.ndjson";
  const q = new URLSearchParams(req.query).toString();
  res.redirect(`${target}?${q}`);
});

// Serve /runtime (static UI to run directives later)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use("/runtime", express.static(path.join(__dirname, "runtime")));

const port = process.env.PORT || 8080;
app.listen(port, "0.0.0.0", () => console.log("precogs-api listening on", port));
