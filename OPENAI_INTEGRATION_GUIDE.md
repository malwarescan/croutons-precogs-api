# OpenAI Function Calling Integration Guide

Complete implementation guide for integrating OpenAI function calling with streaming into Precogs.

---

## References

1. **OpenAI Function Calling Docs:** https://platform.openai.com/docs/guides/function-calling
2. **GitHub Gist:** Streaming + function calls implementation
3. **OpenAI Forum:** "Function calls and streaming" discussion
4. **FastAPI Article:** "Streaming OpenAI Assistant API Asynchronously with Function Calling"

---

## Key Takeaways

### 1. Streaming + Function Calls Work Together

- Use `stream=true` in API call
- Parse chunks to detect function calls
- Handle normal content vs function call events distinctly
- Execute function when detected
- Feed results back into conversation

### 2. Chunk Parsing Logic

When streaming with function calls, chunks can contain:
- **Content chunks:** `delta.content` - regular text
- **Function call chunks:** `delta.function_call` - function name and arguments
- **Finish reason:** `finish_reason: "function_call"` - indicates function call complete

### 3. Architecture Pattern

```
User Input
    ↓
OpenAI API (stream=true, functions=[...])
    ↓
Parse chunks:
  - Content → stream to client
  - Function call → accumulate arguments
  - Finish reason → execute function
    ↓
Execute function (invoke_precog)
    ↓
Return result to conversation
    ↓
Continue streaming model response
```

---

## Implementation

### Step 1: Install Dependencies

```bash
npm install openai
```

### Step 2: Environment Variables

```bash
OPENAI_API_KEY=sk-...
```

### Step 3: Production-Ready Implementation

See `src/integrations/openai-chat.js` for complete implementation.

---

## Code Structure

### Function Definition

Already implemented in `src/functions/invoke_precog.js`:
- Function schema
- Parameter definitions
- Execution handler

### Streaming Handler

Implementation in `src/integrations/openai-chat.js`:
- Chunk parsing
- Function call detection
- Function execution
- Result streaming

### HTTP Endpoint

Add to `server.js`:
- `/v1/chat` endpoint
- SSE streaming
- Error handling

---

## Usage Examples

### Example 1: Simple Function Call

```javascript
const result = await callWithFunctionCallingSync(
  "Run schema audit on https://example.com/service"
);
```

### Example 2: Streaming Function Call

```javascript
for await (const chunk of callWithFunctionCalling(
  "Run schema audit on https://example.com/service"
)) {
  if (chunk.type === "content") {
    console.log(chunk.content);
  } else if (chunk.type === "function_call") {
    console.log("Calling:", chunk.name);
  }
}
```

### Example 3: HTTP Endpoint

```bash
curl -X POST https://precogs.croutons.ai/v1/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Run schema audit on https://example.com"}'
```

---

## Edge Cases Handled

1. **Partial function arguments:** Accumulate across multiple chunks
2. **Multiple function calls:** Handle sequentially
3. **Streaming errors:** Graceful error handling
4. **Client disconnection:** Clean up resources
5. **Function execution errors:** Return error to model

---

## Testing

See `FUNCTION_CALLING_INTEGRATION.md` for testing strategies.

---

**Status:** Implementation guide  
**Phase:** Phase 3 (Dev Tooling)  
**Last Updated:** $(date)

