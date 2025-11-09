# Cheat-Sheet: Streaming + Function-Calling with OpenAI APIs

**For the Precogs Invocation Workflow**

Quick reference for common pitfalls, patterns, and best practices.

---

## ⚠️ Common Pitfalls & How to Avoid Them

| Pitfall | What Happens | How to Mitigate |
|---------|--------------|-----------------|
| **Function call arguments arrive split across streaming chunks** | The model sends a function call in multiple parts (e.g., first chunk has `delta.function_call.name`, later chunks `delta.function_call.arguments`) | **Accumulate** `name` and `arguments` across chunks until `finish_reason == "function_call"`, then execute the function. |
| **Not handling both normal content and function call content in same stream** | Either you treat all output as plain text and miss function calls, or you crash when `function_*` keys appear. | In your streaming loop, inspect each chunk: if `msg["delta"].get("function_call")` or `msg["finish_reason"] == "function_call"`, handle accordingly. |
| **Streaming but forgetting to set proper headers or content type for SSE/NDJSON** | Client doesn't process event stream; connection may drop. | Use `Content-Type: text/event-stream` + `Cache-Control: no-cache`, send data as `data: {...}\n\n` per message. |
| **Function returns but not incorporated back into conversation** | Model doesn't know the result of the function and produces incomplete response. | When function executes, append `role: "function"` message with `name` & `content`, then send a new assistant call (or resume streaming) so the model can respond using that data. |
| **Missing fallback/default for new params** | E.g., `kb` parameter not present, worker logic fails. | Define defaults (e.g., `kb="general"`) so extension/future domains don't break Phase 1. |
| **Latency too high → poor UX** | Job creation + first event delayed → user perceives slowness. | Return `job_id` + URLs immediately, start streaming without heavy blocking work; worker can process asynchronously. |
| **Rate limiting/auth missing on function endpoint** | Abuse or unexpected usage. | Ensure `/v1/chat` or function invocation path uses `requireAuth` or `rate-limit` middleware. |

---

## 🎯 Streaming + Function-Calling Basic Flow

### 1. Client sends message to `/v1/chat` or similar

### 2. Server calls OpenAI ChatCompletion with parameters:

```javascript
{
  "model": "gpt-4-0613",
  "messages": [...],
  "functions": [ /* definitions */ ],
  "stream": true
}
```

### 3. Server receives streaming chunks. For each chunk:

- **If `delta` includes `content`**, send `{"type":"content","content":"..."}`
- **If `delta` includes `function_call.name` or `function_call.arguments`**, accumulate
- **If chunk has `finish_reason == "function_call"`**, then:
  - Execute the function (e.g., `invoke_precog`)
  - Append to messages: `{ role:"function", name:..., content:JSON.stringify(result) }`
  - Send `{"type":"function_result",...}` event with result info
  - Then call model again (continuation) to let it reply post-function
  - Continue streaming until `finish_reason == "stop"`

### 4. At end, send `{"type":"complete"}`

### 5. Client receives events; e.g., `job_id`, `stream_url`, `cli_url`

---

## 🛠 Best Practices for Precogs Workflow

### Define Functions Clearly

Provide accurate names, descriptions, parameter schemas. Example:

```json
{
  "name": "invoke_precog",
  "description": "Create a precog job for URL analysis",
  "parameters": {
    "type": "object",
    "properties": {
      "kb": { "type": "string", "description": "Knowledge base id" },
      "precog": { "type": "string", "description": "Precog type e.g. schema" },
      "url": { "type": "string" },
      "type": { "type": "string" },
      "task": { "type": "string" },
      "token": { "type": "string" }
    },
    "required": ["precog","url"]
  }
}
```

### Streaming First, Heavy Work Later

- Return job metadata fast
- Let worker do heavy URL fetching/KB queries
- Ensures low latency to first user feedback

### Use Event Types in Stream

Standardize event type values:
- `content` - Model text output
- `function_call_start` - Function call beginning
- `function_call` - Complete function call with arguments
- `function_result` - Function execution result
- `complete` - Stream finished
- `error` - Error occurred
- `heartbeat` - Keep-alive (optional)

This helps clients parse easily.

### Default Fallback Domain (kb)

Use `kb="general"` until full KB integration. This allows Phase 1 to work without blocking on KB implementation.

### Robust Logging and Metrics

Track:
- Job creation time
- First chunk time
- Total time
- Error counts
- Rate limit breaches

**Example:**
```javascript
console.log("[chat] Request received:", { message: "...", hasHistory: false });
console.log("[chat] First chunk:", firstChunkTime - startTime, "ms");
console.log("[chat] Function called:", functionName);
console.log("[chat] Job created:", jobId, "in", jobCreationTime, "ms");
console.log("[chat] Completed:", { functionCalled, jobCreated, totalTime });
```

### Client-Friendly Links

Provide multiple URL formats:
- `cli_url` - Human-readable terminal viewer
- `ndjson_url` - Developer-friendly NDJSON stream
- `stream_url` - SSE endpoint

### Rate Limit and Auth

Even for function endpoint, apply:
- Rate limiting (60 req/min per IP)
- Optional authentication (via `API_KEY`)
- Token in header or query param

### Test Edge Cases

1. **No function required** - User asks simple question
2. **Function with arguments split across chunks** - Multi-chunk arguments
3. **Model chooses not to call any function** - Normal conversation
4. **Job fails in worker** - Error handling
5. **Streaming interruption/disconnect** - Client cleanup

---

## ✅ Quick Reference Summary

| Topic | Note |
|-------|------|
| **Function call detection** | Accumulate `delta.function_call.name` + `delta.function_call.arguments` until `finish_reason == "function_call"`. |
| **Streaming header** | `Content-Type: text/event-stream` + newline formatting (`data: {...}\n\n`). |
| **Early feedback to user** | Return metadata (`job_id`, URLs) immediately. |
| **Fallback defaults** | Use `kb="general"` until domain KBs ready. |
| **Rate limit** | Ensure `/v1/chat` enforces rate & auth. |
| **Logging** | Capture: request start, function call start, job enqueue time, first event time, job complete. |

---

## Code Patterns

### Accumulating Function Arguments

```javascript
let functionCallName = null;
let functionCallArguments = "";

for await (const chunk of stream) {
  const delta = chunk.choices[0].delta;
  
  if (delta.function_call) {
    if (delta.function_call.name) {
      functionCallName = delta.function_call.name;
    }
    // CRITICAL: Accumulate arguments across chunks
    if (delta.function_call.arguments) {
      functionCallArguments += delta.function_call.arguments;
    }
  }
  
  // Only execute when complete
  if (chunk.choices[0].finish_reason === "function_call") {
    const args = JSON.parse(functionCallArguments);
    // Execute function...
  }
}
```

### SSE Format

```javascript
res.set({
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
});

// Send each event
res.write(`data: ${JSON.stringify(chunk)}\n\n`);
```

### Function Result Format

```javascript
{
  type: "function_result",
  result: {
    job_id: "uuid",
    status: "pending",
    stream_url: "...",
    cli_url: "...",
    ndjson_url: "...",
    message: "..."
  }
}
```

---

## Testing Checklist

- [ ] Function call detected correctly
- [ ] Arguments accumulated across chunks
- [ ] Function executes successfully
- [ ] Job created in database
- [ ] URLs returned correctly
- [ ] Model receives function result
- [ ] Model continues streaming
- [ ] Client can parse all event types
- [ ] Error handling works
- [ ] Rate limiting works
- [ ] Authentication works

---

## References

- **Implementation:** `src/integrations/openai-chat.js`
- **Function Definition:** `src/functions/invoke_precog.js`
- **Usage Guide:** `CHAT_ENDPOINT_USAGE.md`
- **Monitoring:** `MONITORING.md`
- **Test Script:** `scripts/test-chat-endpoint.js`

---

**Last Updated:** $(date)  
**Status:** Quick reference for dev team

