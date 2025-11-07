import express from "express";

const app = express();

// basic health endpoint for Railway/Cloudflare checks
app.get("/health", (_req, res) => res.json({ ok: true }));

// optional: root message
app.get("/", (_req, res) => res.json({ service: "precogs-api", status: "ok" }));

// IMPORTANT: respect Railway's dynamic PORT
const port = process.env.PORT || 4000;
app.listen(port, () => console.log("precogs-api listening on", port));

