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

// Verification routes (for Croutons domain verification)
import { initiateVerification, checkVerification } from "./src/routes/verify.js";
app.post('/v1/verify/initiate', initiateVerification);
app.post('/v1/verify/check', checkVerification);

// Ingestion routes
import { ingestUrl } from "./src/routes/ingest.js";
app.post('/v1/ingest', ingestUrl);

// Discovery routes (webhook-first discovery system)
import { discoverPage } from "./src/routes/discover.js";
app.post('/v1/discover', discoverPage);

// Scanner routes (scheduled safety net)
import { runScanner } from "./src/routes/scanner.js";
app.get('/v1/scanner/run', runScanner);
app.post('/v1/scanner/run', runScanner);

// Facts stream endpoint (E1)
import { getFactsStream, getAllFactsStream } from "./src/routes/facts.js";
app.get('/v1/facts/:domain.ndjson', getFactsStream);
app.get('/v1/facts.ndjson', getAllFactsStream);

// Entity graph endpoint (C2)
import { getEntityGraph } from "./src/routes/graph.js";
app.get('/v1/graph/:domain.jsonld', getEntityGraph);

// Status endpoint (Protocol v1.1)
import { getStatus } from "./src/routes/status.js";
app.get('/v1/status/:domain', getStatus);

// Extract validation endpoint (PHASE E) - Rate-limited (most expensive)
import { getExtract } from "./src/routes/extract.js";
app.get('/v1/extract/:domain', rateLimit, getExtract);

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

app.get("/health", async (_req, res) => {
  try {
    // Quick database ping
    await pool.query("SELECT 1");
    res.json({ 
      ok: true, 
      ts: new Date().toISOString(),
      database: "connected"
    });
  } catch (error) {
    // Database might be down, but server is running
    res.status(503).json({ 
      ok: false, 
      ts: new Date().toISOString(),
      database: "disconnected",
      error: error.message 
    });
  }
});

// Debug endpoint: check applied migrations
app.get("/debug/migrations", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT filename, applied_at 
      FROM precogs.schema_migrations 
      ORDER BY applied_at DESC
    `);
    res.json({ 
      ok: true,
      migrations: result.rows
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Debug endpoint: check croutons table schema
app.get("/debug/croutons-schema", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'croutons'
      ORDER BY ordinal_position
    `);
    res.json({ 
      ok: true,
      columns: result.rows
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Debug endpoint: list all domains in croutons table
app.get("/debug/croutons-domains", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT domain, COUNT(*) as count 
      FROM public.croutons 
      GROUP BY domain 
      ORDER BY count DESC 
      LIMIT 50
    `);
    res.json({ ok: true, domains: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Debug endpoint: query by specific crouton_id
app.get("/debug/crouton/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT * FROM public.croutons WHERE crouton_id = $1
    `, [id]);
    res.json({
      ok: true,
      found: result.rows.length > 0,
      row: result.rows[0] || null
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Debug endpoint: test INSERT and verify it persists
app.get("/debug/test-insert", async (_req, res) => {
  try {
    const testId = 'test-' + Date.now();
    const testDomain = 'test-insert-debug.com';
    
    // INSERT
    const insertResult = await pool.query(`
      INSERT INTO croutons (
        crouton_id, domain, source_url, text,
        slot_id, fact_id, revision, confidence
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, domain, crouton_id
    `, [testId, testDomain, 'https://test.com', 'Test fact', 'test-slot', 'test-fact', 1, 0.5]);
    
    // Query back immediately
    const queryResult = await pool.query(`
      SELECT * FROM croutons WHERE crouton_id = $1
    `, [testId]);
    
    res.json({
      ok: true,
      insertedRow: insertResult.rows[0],
      queriedRow: queryResult.rows[0] ? {
        id: queryResult.rows[0].id,
        domain: queryResult.rows[0].domain,
        crouton_id: queryResult.rows[0].crouton_id
      } : null
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message, stack: error.stack });
  }
});

// Debug endpoint: check croutons table status
app.get("/debug/croutons", async (_req, res) => {
  try {
    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'croutons'
      );
    `);
    const tableExists = tableCheck.rows[0].exists;
    
    if (!tableExists) {
      return res.json({ 
        ok: false,
        tableExists: false,
        message: "croutons table does not exist"
      });
    }
    
    // Count total rows
    const countResult = await pool.query('SELECT COUNT(*) FROM croutons');
    const totalCount = parseInt(countResult.rows[0].count);
    
    // Get sample rows (most recent and oldest)
    let sampleRow = null;
    let mostRecentRow = null;
    if (totalCount > 0) {
      const sampleResult = await pool.query('SELECT * FROM croutons LIMIT 1');
      sampleRow = sampleResult.rows[0];
      
      const recentResult = await pool.query('SELECT * FROM croutons ORDER BY created_at DESC LIMIT 1');
      mostRecentRow = recentResult.rows[0];
    }
    
    res.json({ 
      ok: true,
      tableExists: true,
      totalCount,
      sampleRow: sampleRow ? {
        id: sampleRow.id,
        domain: sampleRow.domain,
        slot_id: sampleRow.slot_id ? sampleRow.slot_id.substring(0, 16) + '...' : null,
        fact_id: sampleRow.fact_id ? sampleRow.fact_id.substring(0, 16) + '...' : null,
        has_evidence_anchor: !!sampleRow.evidence_anchor,
        has_supporting_text: !!sampleRow.supporting_text
      } : null,
      mostRecentRow: mostRecentRow ? {
        id: mostRecentRow.id,
        domain: mostRecentRow.domain,
        source_url: mostRecentRow.source_url,
        slot_id: mostRecentRow.slot_id ? mostRecentRow.slot_id.substring(0, 16) + '...' : null,
        fact_id: mostRecentRow.fact_id ? mostRecentRow.fact_id.substring(0, 16) + '...' : null,
        has_evidence_anchor: !!mostRecentRow.evidence_anchor,
        has_supporting_text: !!mostRecentRow.supporting_text,
        created_at: mostRecentRow.created_at
      } : null
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message,
      stack: error.stack
    });
  }
});

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

    // Default prompt if not provided
    const jobPrompt = prompt || `Run ${precog}`;

    // Insert job into database (status=pending)
    const job = await insertJob(precog, jobPrompt, context || {});

    // Enqueue job to Redis Stream
    if (process.env.REDIS_URL) {
      try {
        await enqueueJob(job.id, precog, jobPrompt, context || {});
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

// GET/POST /v1/run.ndjson - Create job and stream events as NDJSON
// GET: legacy URL-based mode (?precog=...&url=...)
// POST: inline content mode ({precog, kb, content_source, content, type, task})
app.get("/v1/run.ndjson", async (req, res) => {
  try {
    // Public endpoint - no auth required for GPT function calling
    // Auth is completely optional - allow all requests

    const precog = req.query.precog || "schema";
    const task = req.query.task || (precog === "schema" ? "validate" : `Run ${precog}`);
    const ctx = {
      kb: req.query.kb || (precog === "schema" ? "schema-foundation" : "general"),
      content_source: "url",
    };
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

// POST /v1/run.ndjson - Create job with inline content and stream events as NDJSON
app.post("/v1/run.ndjson", async (req, res) => {
  try {
    // Public endpoint - no auth required for GPT function calling
    // Auth is completely optional - allow all requests

    const {
      precog = "schema",
      kb = precog === "schema" ? "schema-foundation" : "general",
      content_source = "inline",
      content,
      url,
      type,
      task,
    } = req.body;

    // Validate content source requirements
    if (content_source === "inline" && !content) {
      return res.status(400).json({ ok: false, error: "content is required when content_source is 'inline'" });
    }
    if (content_source === "url" && !url) {
      return res.status(400).json({ ok: false, error: "url is required when content_source is 'url'" });
    }

    const ctx = {
      kb: kb || (precog === "schema" ? "schema-foundation" : precog.startsWith("home") ? "home-foundation" : "general"),
      content_source,
    };
    if (type) ctx.type = type;
    if (content_source === "inline" && content) {
      ctx.content = content;
    }
    if (content_source === "url" && url) {
      ctx.url = url;
    }
    // Home precog specific context
    if (precog.startsWith("home")) {
      if (req.body.region) ctx.region = req.body.region;
      if (req.body.domain) ctx.domain = req.body.domain;
      if (req.body.vertical) ctx.vertical = req.body.vertical;
    }
    // Bangkok Massage precog specific context
    if (precog === "bkk_massage") {
      if (req.body.region) ctx.region = req.body.region; // District name
    }

    const jobTask = task || (precog === "schema" ? "validate" : `Run ${precog}`);

    // Create job
    const job = await insertJob(precog, jobTask, ctx);
    
    // Enqueue job to Redis Stream
    if (process.env.REDIS_URL) {
      try {
        await enqueueJob(job.id, precog, jobTask, ctx);
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
      "X-Accel-Buffering": "no",
    });

    // Helper to write one NDJSON line
    const line = (obj) => {
      try {
        res.write(JSON.stringify(obj) + "\n");
      } catch (e) {
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
    console.error("[run.ndjson POST] Error:", e);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
});

// GET /run - Convenience redirect to NDJSON endpoint
app.get("/run", (req, res) => {
  const target = "/v1/run.ndjson";
  const q = new URLSearchParams(req.query).toString();
  res.redirect(`${target}?${q}`);
});

// GET /cli - Convenience redirect to CLI viewer
app.get("/cli", (req, res) => {
  const q = new URLSearchParams(req.query).toString();
  res.redirect(`/runtime/cli.html?${q}`);
});

// POST /v1/chat - OpenAI function calling with streaming
app.post("/v1/chat", requireAuth, rateLimit, async (req, res) => {
  try {
    // Log request for monitoring
    const startTime = Date.now();
    console.log("[chat] Request received:", {
      message: req.body.message?.substring(0, 100),
      hasHistory: !!req.body.history?.length,
    });

    const { message, history = [], model, temperature, max_tokens } = req.body;

    if (!message) {
      return res.status(400).json({ ok: false, error: "message is required" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ 
        ok: false, 
        error: "OpenAI integration not configured. OPENAI_API_KEY not set." 
      });
    }

    // Set up SSE headers
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Import dynamically (only if OPENAI_API_KEY is set)
    const { callWithFunctionCalling } = await import("./src/integrations/openai-chat.js");

    // Stream responses
    let functionCalled = false;
    let jobCreated = false;
    let firstChunkTime = null;
    
    try {
      for await (const chunk of callWithFunctionCalling(message, history, {
        model: model || "gpt-4",
        temperature: temperature || 0.7,
        maxTokens: max_tokens || 2000,
      })) {
        // Track first chunk time for latency monitoring
        if (!firstChunkTime) {
          firstChunkTime = Date.now();
          console.log("[chat] First chunk:", firstChunkTime - startTime, "ms");
        }
        
        // Track function calls for monitoring
        if (chunk.type === "function_call") {
          functionCalled = true;
          console.log("[chat] Function called:", chunk.name);
        }
        if (chunk.type === "function_result") {
          jobCreated = true;
          console.log("[chat] Job created:", chunk.result.job_id, "in", Date.now() - startTime, "ms");
        }
        
        // Send chunk as SSE
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);

        // Handle client disconnect
        if (req.aborted) {
          console.log("[chat] Client disconnected");
          break;
        }
      }
      
      // Log completion metrics
      const totalTime = Date.now() - startTime;
      console.log("[chat] Completed:", {
        functionCalled,
        jobCreated,
        totalTime: totalTime + "ms",
        firstChunkTime: firstChunkTime ? firstChunkTime - startTime + "ms" : "N/A",
      });
    } catch (streamError) {
      console.error("[chat] Stream error:", streamError);
      res.write(`data: ${JSON.stringify({ type: "error", error: streamError.message })}\n\n`);
    }

    res.end();
  } catch (e) {
    console.error("[chat] Error:", e);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: e.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: e.message })}\n\n`);
      res.end();
    }
  }
});

// Serve /runtime (static UI to run directives later)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use("/runtime", express.static(path.join(__dirname, "runtime")));

// Test database connection on startup
async function testDatabaseConnection() {
  try {
    const result = await pool.query("SELECT NOW()");
    console.log("[startup] Database connection OK:", result.rows[0].now);
    return true;
  } catch (error) {
    console.error("[startup] Database connection FAILED:", error.message);
    console.error("[startup] DATABASE_URL:", process.env.DATABASE_URL ? "SET" : "NOT SET");
    return false;
  }
}

// Test Redis connection on startup (optional)
async function testRedisConnection() {
  try {
    if (!process.env.REDIS_URL) {
      console.log("[startup] Redis: Not configured (REDIS_URL not set)");
      return true; // Redis is optional
    }
    const { testRedis } = await import("./src/redis.js");
    const result = await testRedis();
    console.log("[startup] Redis connection:", result ? "OK" : "FAILED");
    return result;
  } catch (error) {
    console.error("[startup] Redis connection error:", error.message);
    return false; // Non-fatal, continue anyway
  }
}

// Run verified_domains migration on startup
async function runVerifiedDomainsMigration() {
  try {
    console.log("[startup] Running verified_domains migration...");
    const { readFileSync } = await import("fs");
    const { fileURLToPath } = await import("url");
    const { dirname, join } = await import("path");
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const migrationPath = join(__dirname, "migrations", "002_add_verified_domains.sql");
    const sql = readFileSync(migrationPath, "utf8");
    
    await pool.query(sql);
    console.log("[startup] ✅ verified_domains migration applied");
  } catch (error) {
    // Don't fail startup if migration fails (might already be applied)
    console.error("[startup] Migration error (non-fatal):", error.message);
  }
}

// Run html_snapshots migration on startup
async function runHtmlSnapshotsMigration() {
  try {
    console.log("[startup] Running html_snapshots migration...");
    const { readFileSync } = await import("fs");
    const { fileURLToPath } = await import("url");
    const { dirname, join } = await import("path");
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const migrationPath = join(__dirname, "migrations", "003_add_html_snapshots.sql");
    const sql = readFileSync(migrationPath, "utf8");
    
    await pool.query(sql);
    console.log("[startup] ✅ html_snapshots migration applied");
  } catch (error) {
    // Don't fail startup if migration fails (might already be applied)
    console.error("[startup] html_snapshots migration error (non-fatal):", error.message);
  }
}

// Run discovered_pages migration on startup
async function runDiscoveredPagesMigration() {
  try {
    console.log("[startup] Running discovered_pages migration...");
    const { readFileSync } = await import("fs");
    const { fileURLToPath } = await import("url");
    const { dirname, join } = await import("path");
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const migrationPath = join(__dirname, "migrations", "015_add_discovered_pages.sql");
    const sql = readFileSync(migrationPath, "utf8");
    
    await pool.query(sql);
    console.log("[startup] ✅ discovered_pages migration applied");
  } catch (error) {
    // Don't fail startup if migration fails (might already be applied)
    console.error("[startup] discovered_pages migration error (non-fatal):", error.message);
  }
}

// Startup sequence
async function startServer() {
  console.log("[startup] Starting precogs-api...");
  console.log("[startup] NODE_ENV:", process.env.NODE_ENV || "development");
  console.log("[startup] PORT:", process.env.PORT || "8080");

  // Test database (required)
  const dbOk = await testDatabaseConnection();
  if (!dbOk) {
    console.error("[startup] FATAL: Database connection failed. Server will start but may fail on requests.");
    // Continue anyway - some endpoints might work
  } else {
    // Run migrations if database is connected
    await runVerifiedDomainsMigration();
    await runHtmlSnapshotsMigration();
    await runDiscoveredPagesMigration();
  }

  // Test Redis (optional)
  await testRedisConnection();

  const port = process.env.PORT || 8080;
  app.listen(port, "0.0.0.0", () => {
    console.log("[startup] ✅ precogs-api listening on port", port);
    console.log("[startup] Health check: http://localhost:" + port + "/health");
  });

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    console.error("[fatal] Uncaught exception:", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("[fatal] Unhandled rejection at:", promise, "reason:", reason);
    process.exit(1);
  });
}

startServer().catch((error) => {
  console.error("[fatal] Startup failed:", error);
  process.exit(1);
});
