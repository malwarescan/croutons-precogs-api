// server.js
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Optional Redis test endpoint (remove after verification)
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

// Minimal /v1/invoke + /v1/jobs/:id/events stubs
const jobs = new Map(); // in-memory for now
app.post("/v1/invoke", (req, res) => {
  const { precog, prompt, context, stream } = req.body || {};
  if (!precog) return res.status(400).json({ ok: false, error: "precog required" });

  const id = cryptoRandom();
  jobs.set(id, { precog, prompt, context, startedAt: Date.now() });

  res.json({ ok: true, job_id: id, stream: !!stream });
});

app.get("/v1/jobs/:id/events", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Demo stream
  sse(res, "grounding.chunk", { count: 1 });
  sse(res, "answer.delta", { text: "Hello from Precogs stub…" });
  setTimeout(() => {
    sse(res, "answer.complete", { ok: true });
    res.end();
  }, 500);
});

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// Serve /runtime (static UI to run directives later)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use("/runtime", express.static(path.join(__dirname, "runtime")));

const port = process.env.PORT || 8080;
app.listen(port, "0.0.0.0", () => console.log("precogs-api listening on", port));
