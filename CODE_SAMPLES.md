# Code Samples: Streaming + Function Calling

Real-world examples for reference and comparison with our Precogs implementation.

---

## Example 1: Official OpenAI Node.js Example

**Source:** 
- [openai-node repository](https://github.com/openai/openai-node) - `examples/function-call-stream.ts`
- GitHub gist: openai-node example "function-call-stream.ts"

**Key Pattern:** Basic streaming + function calling with argument accumulation

**Reference:** Demonstrates accumulating function call arguments while streaming

```typescript
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const completion = await openai.chat.completions.create({
  model: "gpt-4-0613",
  messages: [
    { role: "user", content: "Get weather for NYC" }
  ],
  functions: [
    {
      name: "getWeather",
      description: "Returns weather for given city",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" }
        },
        required: ["city"]
      }
    }
  ],
  stream: true
});

let funcName = "";
let funcArgs = "";

for await (const chunk of completion) {
  const delta = chunk.choices[0].delta;
  
  // Accumulate function call name and arguments
  if (delta.function_call?.name) funcName += delta.function_call.name;
  if (delta.function_call?.arguments) funcArgs += delta.function_call.arguments;
  
  // Execute when complete
  if (chunk.choices[0].finish_reason === "function_call") {
    const args = JSON.parse(funcArgs);
    
    // Call the function
    const result = await getWeather(args.city);
    
    // Feed back to model
    const resp2 = await openai.chat.completions.create({
      model: "gpt-4-0613",
      messages: [
        ...previousMessages,
        { 
          role: "assistant", 
          content: "", 
          function_call: { name: funcName, arguments: args }
        },
        { 
          role: "function", 
          name: funcName, 
          content: JSON.stringify(result)
        }
      ]
    });
    
    // Stream follow-up response
    for await (const c2 of resp2) {
      process.stdout.write(c2.choices[0].delta.content || "");
    }
    break;
  }
  
  // Stream regular content
  process.stdout.write(delta.content || "");
}
```

**Key Insights:**
- ✅ Accumulates `funcName` and `funcArgs` across chunks
- ✅ Only executes when `finish_reason === "function_call"`
- ✅ Feeds result back to model for follow-up response
- ✅ Continues streaming after function execution

**How We Use This Pattern:**
- Our `openai-chat.js` lines 75-100: Same accumulation pattern
- Our `openai-chat.js` lines 112-180: Same execution and follow-up pattern

---

## Example 2: Community Discussion - Chunk Accumulation

**Source:** 
- OpenAI Community Forum - "How to properly handle the function call in assistant streaming (Node.js)"
- Developer community thread: "Function calls and streaming"

**Key Pattern:** Event-based handling with tool call deltas

**Reference:** Covers edge-cases when using streaming + function calling

```javascript
.on('toolCallDelta', toolCallDelta => {
  if (toolCallDelta.type === 'function') {
    // toolCallDelta.function.name
    // toolCallDelta.function.arguments
  }
});
```

**Key Insights:**
- Event-driven approach (alternative to our async generator)
- Emphasizes handling deltas incrementally
- Validates that arguments arrive in chunks

**How We Use This Pattern:**
- Our implementation uses async generator (more flexible)
- Same underlying concept: accumulate deltas until complete
- Our `openai-chat.js` lines 88-99: Handle deltas incrementally

---

## Example 3: SSE Streaming Pattern

**Source:** 
- OpenFaaS blog - "Stream OpenAI responses from functions using Server Sent Events (SSE)"
- Blog article: "Streaming OpenAI Assistant API Asynchronously with Function Calling in FastAPI"

**Key Pattern:** SSE formatting for browser streaming

**Reference:** Real-world FastAPI + streaming integration

```python
def stream():
  for chunk in chat_model.stream(prompt):
    yield f'data: {chunk.content}\n\n'
return Response(stream(), mimetype='text/event-stream')
```

**Key Insights:**
- SSE format: `data: {json}\n\n`
- Proper content type: `text/event-stream`
- Streaming generator pattern

**How We Use This Pattern:**
- Our `server.js` lines 459-464: SSE headers
- Our `server.js` line 493: SSE format `data: ${JSON.stringify(chunk)}\n\n`
- Our `server.js` lines 132-223: Full SSE endpoint implementation

---

## Example 4: Basic Streaming Mechanics

**Source:** January.sh - "Real-time OpenAI Response Streaming with Node.js"

**Key Pattern:** Simple streaming loop

```javascript
const completion = await openai.chat.completions.create({
  model: "gpt-4",
  stream: true,
  messages: [{ role: "user", content: "Once upon a time" }]
});

for await (const chunk of completion) {
  const content = chunk.choices[0].delta.content;
  process.stdout.write(content);
}
```

**Key Insights:**
- Basic streaming loop structure
- Access `delta.content` for text chunks
- Simple async iteration pattern

**How We Use This Pattern:**
- Our `openai-chat.js` lines 79-109: Same loop structure
- Our `openai-chat.js` line 103: Access `delta.content`
- Foundation for our more complex function-calling logic

---

## Example 5: Non-Streaming Function Calling

**Source:** NodeJS-OpenAI-Function-Calling-Example by YAV-AI

**Key Pattern:** Simple function calling (can be adapted with `stream: true`)

**Key Insights:**
- Shows function definition structure
- Demonstrates function execution flow
- Can be adapted by adding `stream: true` parameter

**How We Use This Pattern:**
- Our `invoke_precog.js`: Function definition structure
- Our `openai-chat.js` lines 65-73: Function definition in API call
- Our `callWithFunctionCallingSync()`: Non-streaming fallback version

---

## Comparison: Our Implementation vs Examples

| Pattern | Example | Our Code | Status |
|---------|---------|----------|--------|
| **Argument Accumulation** | Example 1: `funcArgs += delta.function_call.arguments` | `openai-chat.js` lines 97-98 | ✅ Matches |
| **Function Execution** | Example 1: Execute when `finish_reason === "function_call"` | `openai-chat.js` lines 112-134 | ✅ Matches |
| **Result Integration** | Example 1: Append `role: "function"` message | `openai-chat.js` lines 150-154 | ✅ Matches |
| **Follow-up Streaming** | Example 1: Continue streaming after function | `openai-chat.js` lines 164-180 | ✅ Matches |
| **SSE Format** | Example 3: `data: {json}\n\n` | `server.js` line 493 | ✅ Matches |
| **Streaming Loop** | Example 4: `for await (const chunk)` | `openai-chat.js` line 79 | ✅ Matches |
| **Function Definition** | Example 5: Schema structure | `invoke_precog.js` | ✅ Matches |

---

## How to Adapt These to Precogs

### 1. Use Example 1's Pattern

**What to Adapt:**
- ✅ Accumulate `function_call.name` + `function_call.arguments` across chunks
- ✅ Execute `invoke_precog` when `finish_reason === "function_call"`
- ✅ Feed function result back into conversation
- ✅ Continue streaming model response

**Our Implementation:**
- Already matches this pattern exactly
- See `src/integrations/openai-chat.js` lines 75-194

### 2. Use Example 3's SSE Pattern

**What to Adapt:**
- ✅ Stream each event to browser/CLI
- ✅ Use proper SSE headers
- ✅ Format as `data: {json}\n\n`

**Our Implementation:**
- Already matches this pattern
- See `server.js` lines 459-464, 493

### 3. Handle Edge Cases (Example 2)

**What to Adapt:**
- ✅ Document chunk-accumulation edge case
- ✅ Test split arguments
- ✅ Handle partial function calls

**Our Implementation:**
- Already handles this
- See `openai-chat.js` lines 88-99 (accumulation)
- See `openai-chat.js` lines 114-124 (error handling)

### 4. Combine with Job System

**What to Adapt:**
- ✅ Create job → return `job_id` + URLs
- ✅ Stream job events via SSE/NDJSON
- ✅ Let worker process asynchronously

**Our Implementation:**
- Already implements this
- See `src/functions/invoke_precog.js` (job creation)
- See `server.js` lines 132-223 (SSE streaming)

---

## Key Learnings

### ✅ What We're Doing Right

1. **Argument Accumulation** - Correctly accumulating across chunks
2. **Function Execution** - Proper timing (only when `finish_reason === "function_call"`)
3. **Result Integration** - Feeding results back to model correctly
4. **SSE Format** - Proper headers and formatting
5. **Error Handling** - Handling parse errors and function failures

### 🔧 Potential Improvements

1. **Event-Based Alternative** - Could consider event-driven approach (Example 2)
2. **Simpler Fallback** - Non-streaming version already exists (`callWithFunctionCallingSync`)
3. **More Examples** - Could add more edge case handling from community discussions

---

## Testing Checklist

Based on these examples, verify:

- [x] Arguments accumulate correctly across chunks
- [x] Function executes only when complete
- [x] Result fed back to model
- [x] Follow-up response streams correctly
- [x] SSE format correct (`data: {json}\n\n`)
- [x] Error handling for parse failures
- [x] Error handling for function execution failures
- [x] Client can consume SSE stream
- [x] Job creation works correctly
- [x] URLs returned correctly

---

## Additional References

### Official Documentation

- **OpenAI Streaming API Docs:** https://platform.openai.com/docs/api-reference/streaming
  - Covers how streaming works
  - Chunk format and structure
  - Function calling with streaming

### Code Repositories (Pending)

**Status:** Awaiting download links for 5 full sample repositories

**What Will Be Included:**
- Complete working examples
- Annotated changes for Precogs workflow
- Production-ready patterns
- Error handling examples
- Client-side consumption examples

**When Available:**
- Download links will be added here
- Each repository will be documented with adaptation notes
- Code comparisons will be added to `ADAPTATION_GUIDE.md`

---

## References

1. **Official Example:** [openai-node function-call-stream.ts](https://github.com/openai/openai-node/blob/main/examples/function-call-stream.ts)
2. **GitHub Gist:** openai-node example "function-call-stream.ts" - Accumulating arguments while streaming
3. **Community Discussion:** Developer thread - "Function calls and streaming" - Edge-cases
4. **Blog Article:** "Streaming OpenAI Assistant API Asynchronously with Function Calling in FastAPI" - Real-world integration
5. **OpenAI Docs:** Streaming API responses - Official documentation
6. **SSE Pattern:** OpenFaaS blog - SSE streaming
7. **Basic Streaming:** January.sh - Real-time streaming
8. **Function Calling:** YAV-AI NodeJS-OpenAI-Function-Calling-Example

---

**Status:** Examples documented and compared, awaiting repository downloads  
**Last Updated:** $(date)

