#!/usr/bin/env node
// Precogs Schema Summoner
// This CLI script "summons" the @schema precog to analyze, generate, or validate JSON-LD
// using your live Precogs NDJSON streaming endpoint.
// Default mode: inline content (paste HTML/JSON-LD from clipboard)
// URL mode: use --url flag to analyze a web page

import readline from "node:readline";
import { Readable } from "node:stream";

const API = process.env.PRECOGS_API || "https://precogs.croutons.ai";

function parseArgs(argv) {
  const args = { content_source: "inline" }; // Default to inline
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") {
      args.content_source = "url";
      args.url = argv[++i];
    } else if (a === "--inline") {
      args.content_source = "inline";
    } else if (a === "--type") {
      args.type = argv[++i];
    }
  }
  return args;
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
  });
}

async function streamNDJSON(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop();

    for (const line of parts) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.type === "ack") console.log(`🔮 Job ID: ${data.job_id}`);
        if (data.type === "grounding.chunk")
          console.log(`📚 Grounding: ${JSON.stringify(data.data)}`);
        if (data.type === "answer.delta")
          process.stdout.write(data.data.text || "");
        if (data.type === "complete") console.log("\n✅ Done");
      } catch {
        console.error("⚠️  Invalid NDJSON line:", line);
      }
    }
  }
}

async function run() {
  const mode = process.argv[2]; // validate | generate_and_validate | url
  const args = parseArgs(process.argv.slice(3));

  const type = args.type || "Service";
  const task = mode === "validate" ? "validate" : "Generate & validate JSON-LD";

  let res;
  
  if (args.content_source === "inline") {
    // Read content from stdin
    const content = await readStdin();
    if (!content.trim()) {
      console.error("Error: No content provided via stdin. Pipe content or use --url flag.");
      process.exit(1);
    }

    // POST to /v1/run.ndjson with inline content
    const body = {
      precog: "schema",
      kb: "schema-foundation",
      content_source: "inline",
      content: content,
      type: type,
      task: task,
    };

    console.log("🔗 POSTing inline content to:", `${API}/v1/run.ndjson`);
    res = await fetch(`${API}/v1/run.ndjson`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify(body),
    });
  } else {
    // URL mode (legacy, use --url flag)
    if (!args.url) {
      console.error("Usage: npm run schema:url -- --url <URL> --type <Type>");
      process.exit(1);
    }

    const q = new URLSearchParams({
      precog: "schema",
      kb: "schema-foundation",
      url: args.url,
      type,
      task,
    });

    const full = `${API}/v1/run.ndjson?${q.toString()}`;
    console.log("🔗 Calling:", full);
    res = await fetch(full, { headers: { Accept: "application/x-ndjson" } });
  }

  if (!res.ok) {
    const error = await res.text();
    console.error(`❌ Error ${res.status}:`, error);
    process.exit(1);
  }

  await streamNDJSON(res);
}

run().catch(e => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});