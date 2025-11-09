# NDJSON Streaming Endpoint Usage

The `/v1/run.ndjson` endpoint creates a job and streams events as NDJSON (newline-delimited JSON).

## Features

- **Single endpoint:** Creates job and streams in one request
- **NDJSON format:** One JSON object per line (standard streaming format)
- **Browser + CLI:** Works with fetch() in browsers and curl in terminals
- **Token auth:** Supports `?token=` query param for EventSource compatibility

## Endpoints

### `/v1/run.ndjson` - NDJSON Stream

Creates a job and streams events as NDJSON.

**Query Parameters:**
- `precog` - Precog type (default: `schema`)
- `task` - Task description/prompt (default: `Run {precog}`)
- `url` - Optional. URL to process
- `type` - Optional. Type context
- `token` - Optional. API key for authentication

**Response:** NDJSON stream (one JSON object per line)

### `/run` - Convenience Redirect

Redirects to `/v1/run.ndjson` with query params preserved.

### `/runtime/ndjson.html` - Browser Viewer

HTML page that auto-invokes and displays the NDJSON stream.

## Usage Examples

### Browser Viewer (Pretty)

```
https://precogs.croutons.ai/runtime/ndjson.html
  ?precog=schema
  &url=https%3A%2F%2Fexample.com%2Fservice
  &type=Service
  &task=Generate%20%26%20validate%20JSON-LD
  &token=YOUR_API_KEY
```

Opens, auto-enqueues, and renders the live NDJSON stream in-page.

### Raw NDJSON (cURL / ChatGPT)

```
https://precogs.croutons.ai/v1/run.ndjson
  ?precog=schema
  &url=https%3A%2F%2Fexample.com%2Fservice
  &type=Service
  &task=Generate%20%26%20validate%20JSON-LD
  &token=YOUR_API_KEY
```

**cURL example:**
```bash
export API_KEY="your-api-key"
curl -N "https://precogs.croutons.ai/v1/run.ndjson?precog=schema&url=https://example.com/service&type=Service&task=Generate%20JSON-LD&token=$API_KEY"
```

### Convenience Redirect

```
https://precogs.croutons.ai/run?precog=schema&url=https://example.com&type=Service&task=Generate%20JSON-LD&token=YOUR_API_KEY
```

## NDJSON Format

Each line is a JSON object:

```json
{"type":"ack","job_id":"uuid-here"}
{"type":"grounding.chunk","data":{"count":1,"source":"..."},"ts":"2025-11-08T16:31:26.344Z"}
{"type":"answer.delta","data":{"text":"..."},"ts":"2025-11-08T16:31:27.123Z"}
{"type":"answer.delta","data":{"text":"..."},"ts":"2025-11-08T16:31:27.456Z"}
{"type":"heartbeat"}
{"type":"complete","status":"done","error":null}
```

**Event Types:**
- `ack` - Initial acknowledgment with `job_id`
- `grounding.chunk` - Grounding data chunks
- `reasoning.delta` - Reasoning text deltas
- `answer.delta` - Answer text deltas
- `complete` - Job completion (`status`: `done`, `error`, or `cancelled`)
- `error` - Error event
- `heartbeat` - Keep-alive (every 15 seconds)

## Browser Usage

The `ndjson.html` viewer uses `fetch()` with streaming:

```javascript
const resp = await fetch('/v1/run.ndjson?precog=schema&task=test');
const reader = resp.body.getReader();
const decoder = new TextDecoder();
let buf = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  
  // Parse lines
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    
    const obj = JSON.parse(line);
    // Handle event...
  }
}
```

## CLI Usage

**Pipe to jq for pretty output:**
```bash
curl -N "https://precogs.croutons.ai/v1/run.ndjson?precog=schema&task=test" | jq .
```

**Filter specific events:**
```bash
curl -N "https://precogs.croutons.ai/v1/run.ndjson?precog=schema&task=test" | \
  grep '"type":"answer.delta"' | \
  jq -r '.data.text'
```

**Save to file:**
```bash
curl -N "https://precogs.croutons.ai/v1/run.ndjson?precog=schema&task=test" > output.ndjson
```

## Authentication

If `API_KEY` is set in Railway:

- **Header:** `Authorization: Bearer <token>`
- **Query param:** `?token=<token>` (for browsers/EventSource)

Both methods are supported. The query param is useful because:
- EventSource can't set headers
- Browser fetch() can use either method
- cURL can use either method

## Advantages Over SSE

- **Universal:** Works in browsers (fetch) and CLI (curl)
- **Standard format:** NDJSON is a common streaming format
- **Flexible:** Can filter/parse with standard tools (jq, grep, etc.)
- **No headers needed:** Token can be in query param

## Notes

- **CORS:** Endpoint respects CORS settings (should allow browser access)
- **Cloudflare:** Bypass cache for `/v1/run.ndjson` (same as `/v1/jobs/*`)
- **Heartbeat:** Sends `{"type":"heartbeat"}` every 15 seconds to keep proxies alive
- **Streaming:** Uses chunked transfer encoding for real-time delivery

## Use Cases

- **Shareable links:** Single URL that auto-runs and streams
- **ChatGPT integration:** Paste URL, it opens and streams
- **CLI tools:** Pipe to jq, grep, or other tools
- **Monitoring:** Watch jobs stream in real-time
- **Debugging:** See all events as they happen

