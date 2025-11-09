# `/v1/chat` Endpoint Usage

Production-ready OpenAI function calling integration for Precogs.

---

## Setup

### 1. Install OpenAI SDK

```bash
npm install openai
```

### 2. Set Environment Variable

```bash
OPENAI_API_KEY=sk-...
```

### 3. Endpoint Ready

The `/v1/chat` endpoint is already implemented in `server.js`.

---

## Usage

### Basic Request

```bash
curl -X POST https://precogs.croutons.ai/v1/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Run schema audit on https://example.com/service"
  }'
```

### With Authentication

```bash
curl -X POST https://precogs.croutons.ai/v1/chat \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{
    "message": "Run schema audit on https://example.com/service"
  }'
```

### With Options

```bash
curl -X POST https://precogs.croutons.ai/v1/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Run schema audit on https://example.com/service",
    "model": "gpt-4",
    "temperature": 0.7,
    "max_tokens": 2000,
    "history": []
  }'
```

---

## Response Format (SSE Stream)

The endpoint streams Server-Sent Events (SSE) with JSON chunks:

### Content Chunk

```json
{"type":"content","content":"I'll help you run a schema audit..."}
```

### Function Call Start

```json
{"type":"function_call_start","name":"invoke_precog"}
```

### Function Call

```json
{
  "type":"function_call",
  "name":"invoke_precog",
  "arguments":{
    "precog":"schema",
    "url":"https://example.com/service"
  }
}
```

### Function Result

```json
{
  "type":"function_result",
  "result":{
    "job_id":"uuid",
    "stream_url":"https://precogs.croutons.ai/v1/jobs/uuid/events",
    "cli_url":"https://precogs.croutons.ai/cli?precog=schema&url=...",
    "message":"Precog job created. Job ID: uuid..."
  }
}
```

### Complete

```json
{"type":"complete"}
```

### Error

```json
{"type":"error","error":"Error message here"}
```

---

## Client-Side Usage

### JavaScript (Fetch API)

```javascript
const response = await fetch('/v1/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    message: 'Run schema audit on https://example.com/service'
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buf = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  buf += decoder.decode(value, { stream: true });
  let idx;
  
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 2);
    
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      
      if (data.type === 'content') {
        console.log(data.content);
      } else if (data.type === 'function_call') {
        console.log('Calling function:', data.name);
      } else if (data.type === 'function_result') {
        console.log('Job created:', data.result.job_id);
        console.log('Stream URL:', data.result.cli_url);
      }
    }
  }
}
```

### EventSource (Simpler)

Note: EventSource doesn't support POST, so use fetch API above.

---

## How It Works

1. **User sends message** → "Run schema audit on https://example.com"
2. **OpenAI processes** → Decides to call `invoke_precog` function
3. **Function called** → `executeInvokePrecog()` creates job
4. **Result returned** → Job ID + stream URLs sent back to model
5. **Model responds** → Provides link to user
6. **User clicks link** → Streams results in CLI viewer

---

## Integration with ChatGPT

### Custom GPT Configuration

1. Create Custom GPT in ChatGPT
2. Add function:
   - Name: `invoke_precog`
   - Description: "Invoke Precogs oracle..."
   - Parameters: (from `invokePrecogFunction`)
3. Set API endpoint: `https://precogs.croutons.ai/v1/chat`
4. Test: "Run schema audit on https://example.com"

### Cursor Integration

Similar setup - configure Cursor to use `/v1/chat` endpoint.

---

## Error Handling

### Missing OPENAI_API_KEY

```json
{
  "ok": false,
  "error": "OpenAI integration not configured. OPENAI_API_KEY not set."
}
```

### Invalid Message

```json
{
  "ok": false,
  "error": "message is required"
}
```

### Function Execution Error

Streamed as:
```json
{"type":"error","error":"Function execution failed: ..."}
```

---

## Testing

### Test Function Call Detection

```bash
curl -X POST http://localhost:8080/v1/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Run schema audit on https://example.com"}' \
  | grep function_call
```

### Test Complete Flow

1. Send message requesting precog
2. Verify function call detected
3. Verify job created
4. Verify URLs returned
5. Verify follow-up response

---

## Performance

- **Function call detection:** ~100-500ms
- **Job creation:** ~50-100ms
- **Function result return:** Immediate
- **Model follow-up:** ~1-3s

---

## Security

- Optional authentication via `API_KEY`
- Rate limiting (inherits from `/v1/invoke`)
- Input validation
- Error messages don't leak sensitive info

---

## References

- OpenAI Function Calling: https://platform.openai.com/docs/guides/function-calling
- Implementation: `src/integrations/openai-chat.js`
- Function Definition: `src/functions/invoke_precog.js`

---

**Status:** Production-ready  
**Phase:** Phase 3 (Dev Tooling)  
**Last Updated:** $(date)

