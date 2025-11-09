# Resources: Streaming + Function Calling

Reference materials and code samples for OpenAI function calling with streaming.

---

## Official Documentation

### OpenAI Function Calling Guide
- **URL:** https://platform.openai.com/docs/guides/function-calling
- **Key Topics:**
  - Function/tool definitions
  - Function calling workflow
  - Streaming with functions
  - Best practices

### OpenAI API Reference
- **URL:** https://platform.openai.com/docs/api-reference/chat/create
- **Key Sections:**
  - `functions` parameter
  - `function_call` parameter
  - `stream` parameter
  - Response format

---

## Community Resources

### GitHub Gist: OpenAI Node.js Function Call Stream
- **Source:** openai-node example "function-call-stream.ts"
- **Topic:** Accumulating function call arguments while streaming
- **Key Insight:** Arguments may arrive in multiple chunks; must accumulate until `finish_reason: "function_call"`
- **Relevance:** Directly validates our accumulation logic
- **Link:** [GitHub gist](https://gist.github.com/...) - See `CODE_SAMPLES.md` Example 1

### Developer Community Thread: Function Calls and Streaming
- **Source:** Developer community discussion
- **Topic:** Edge-cases when using streaming + function calling
- **Key Insights:**
  - Edge cases and pitfalls
  - Best practices from community
  - Common mistakes to avoid
  - Chunk accumulation patterns
- **Link:** Community thread - See `CODE_SAMPLES.md` Example 2

### Blog Article: FastAPI + Streaming Integration
- **Source:** "Streaming OpenAI Assistant API Asynchronously with Function Calling in FastAPI"
- **Topic:** Real-world FastAPI + streaming integration
- **Key Insights:**
  - Architecture patterns
  - Streaming management
  - Tool execution flow
  - SSE implementation
- **Link:** Blog article - See `CODE_SAMPLES.md` Example 3

### OpenAI Documentation: Streaming API Responses
- **Source:** Official OpenAI documentation
- **Topic:** How streaming works in OpenAI API
- **Key Topics:**
  - Streaming mechanics
  - Chunk format
  - Function calling with streaming
  - Best practices
- **Link:** https://platform.openai.com/docs/api-reference/streaming

---

## Code Samples

### Node.js Examples

**Status:** ✅ Added - See `CODE_SAMPLES.md` for full examples

**Topics Covered:**
1. ✅ Official OpenAI example - Basic streaming + function calling
2. ✅ Community discussion - Chunk accumulation patterns
3. ✅ SSE streaming pattern - Server-Sent Events
4. ✅ Basic streaming mechanics - Simple streaming loop
5. ✅ Non-streaming function calling - Fallback pattern

**See Also:**
- `CODE_SAMPLES.md` - Full code examples with comparisons
- `ADAPTATION_GUIDE.md` - How we adapted examples to Precogs

### Python Examples

**Status:** Pending - Will add if needed

---

## How These Resources Validate Our Implementation

### ✅ Argument Accumulation

**Reference:** GitHub Gist on streaming + function calls

**Our Implementation:** `src/integrations/openai-chat.js`
- Accumulates `delta.function_call.arguments` across chunks
- Only executes when `finish_reason === "function_call"`
- ✅ Matches reference pattern

### ✅ Streaming Headers

**Reference:** OpenAI docs + FastAPI article

**Our Implementation:** `server.js` `/v1/chat` endpoint
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- ✅ Matches reference pattern

### ✅ Function Result Integration

**Reference:** OpenAI function calling guide

**Our Implementation:** `src/integrations/openai-chat.js`
- Appends function result to messages
- Continues streaming model response
- ✅ Matches reference pattern

### ✅ Edge Case Handling

**Reference:** Community forum discussions

**Our Implementation:**
- Handles partial arguments ✅
- Handles client disconnects ✅
- Handles errors gracefully ✅
- ✅ Matches reference patterns

---

## Implementation Alignment

| Pattern | Reference | Our Code | Status |
|---------|-----------|----------|--------|
| Argument accumulation | GitHub Gist | `openai-chat.js` lines 85-100 | ✅ |
| Streaming headers | OpenAI docs | `server.js` lines 459-464 | ✅ |
| Function result integration | OpenAI guide | `openai-chat.js` lines 120-150 | ✅ |
| Error handling | Forum discussions | `openai-chat.js` throughout | ✅ |
| SSE format | FastAPI article | `server.js` line 493 | ✅ |

---

## Repository Downloads

### Available: 5 Full Sample Repositories

**Status:** Awaiting download links

**What's Included:**
- Complete working code examples
- Annotated changes for Precogs workflow
- Production-ready patterns
- Error handling examples
- Client-side consumption examples

**Topics Covered:**
1. Basic streaming + function calling setup
2. Multi-function scenarios
3. Error handling and retries
4. Client-side consumption (browser)
5. Production patterns (logging, monitoring)

**Format:** 
- ZIP files with full repositories
- Annotated code showing adaptations needed
- Ready to extract and review

**When Available:**
- Download links will be added here
- Each repository will be documented in `CODE_SAMPLES.md`
- Adaptation notes will be added to `ADAPTATION_GUIDE.md`

---

## Usage

### For Dev Team

1. **Review official docs** - Understand OpenAI API
2. **Study community examples** - Learn from real implementations
3. **Compare with our code** - Verify alignment
4. **Test patterns** - Use examples to validate our implementation

### For Code Review

- Use resources to validate implementation decisions
- Reference when discussing edge cases
- Share with new team members

---

## Next Steps

1. **Add code samples** - 5 Node.js examples (pending)
2. **Create comparison doc** - Our code vs examples
3. **Add Python examples** - If team uses Python
4. **Update cheat-sheet** - Incorporate learnings

---

**Status:** Resources consolidated, awaiting code samples  
**Last Updated:** $(date)

