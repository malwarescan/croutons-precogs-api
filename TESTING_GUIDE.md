# Testing Guide: Precogs API

Complete guide for testing all endpoints and flows.

---

## Prerequisites

1. **API Running** - `precogs.croutons.ai` should be accessible
2. **Worker Running** - Check Railway logs for `precogs-worker`
3. **API Key** (if auth enabled):
   ```bash
   export API_KEY="your-api-key-here"
   ```

---

## Quick Test Commands

### 1. Health Check

```bash
curl https://precogs.croutons.ai/health
```

**Expected:** `{"ok":true,"ts":"..."}`

---

### 2. Create Job (`/v1/invoke`)

**Basic Test:**
```bash
curl -X POST https://precogs.croutons.ai/v1/invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "precog": "schema",
    "url": "https://example.com",
    "task": "Generate JSON-LD schema"
  }'
```

**Without Task (uses default):**
```bash
curl -X POST https://precogs.croutons.ai/v1/invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "precog": "schema",
    "url": "https://example.com"
  }'
```

**Expected Response:**
```json
{
  "ok": true,
  "job_id": "uuid-here",
  "stream": true
}
```

**Save Job ID:**
```bash
JOB_ID=$(curl -sS -X POST https://precogs.croutons.ai/v1/invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"precog":"schema","url":"https://example.com"}' | jq -r '.job_id')
echo "Job ID: $JOB_ID"
```

---

### 3. Stream Job Events (SSE)

**Using curl:**
```bash
curl -N "https://precogs.croutons.ai/v1/jobs/$JOB_ID/events"
```

**With Token (if auth required):**
```bash
curl -N "https://precogs.croutons.ai/v1/jobs/$JOB_ID/events?token=$API_KEY"
```

**Expected Events:**
```
data: {"type":"grounding.chunk","data":{...}}

data: {"type":"answer.delta","data":{"text":"..."}}

data: {"type":"answer.complete","data":{...}}
```

---

### 4. Test `/v1/chat` Endpoint (Function Calling)

**Using Integration Test Script:**
```bash
cd precogs-api
export PRECOGS_API_BASE="https://precogs.croutons.ai"
export API_KEY="your-api-key"
npm run test:chat
```

**Manual Test:**
```bash
curl -N -X POST https://precogs.croutons.ai/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "message": "Run schema audit on https://example.com"
  }'
```

**Expected Stream:**
```
data: {"type":"function_call_start","name":"invoke_precog"}

data: {"type":"function_call","name":"invoke_precog","arguments":{...}}

data: {"type":"function_result","result":{"job_id":"...","cli_url":"..."}}

data: {"type":"content","content":"Here's your job..."}

data: {"type":"complete"}
```

---

### 5. Test NDJSON Endpoint

**Create and Stream:**
```bash
curl -N "https://precogs.croutons.ai/v1/run.ndjson?precog=schema&url=https://example.com&task=Test"
```

**Expected Output (one JSON per line):**
```json
{"type":"ack","job_id":"..."}
{"type":"grounding.chunk","data":{...}}
{"type":"answer.delta","data":{"text":"..."}}
{"type":"complete","status":"done"}
```

---

### 6. Test CLI Viewer

**Open in Browser:**
```
https://precogs.croutons.ai/cli?precog=schema&url=https://example.com&task=Test
```

**Or with token:**
```
https://precogs.croutons.ai/cli?precog=schema&url=https://example.com&task=Test&token=$API_KEY
```

**Expected:** Terminal-style UI that auto-invokes and streams results

---

## End-to-End Test Flow

### Complete Flow Test

```bash
#!/bin/bash
# Complete end-to-end test

API_BASE="https://precogs.croutons.ai"
API_KEY="${API_KEY:-}"

echo "1. Health Check..."
curl -sS "$API_BASE/health" | jq .

echo ""
echo "2. Create Job..."
RESP=$(curl -sS -X POST "$API_BASE/v1/invoke" \
  -H "Content-Type: application/json" \
  ${API_KEY:+-H "Authorization: Bearer $API_KEY"} \
  -d '{"precog":"schema","url":"https://example.com","task":"Test job"}')
echo "$RESP" | jq .

JOB_ID=$(echo "$RESP" | jq -r '.job_id // empty')
if [ -z "$JOB_ID" ]; then
  echo "ERROR: No job_id returned"
  exit 1
fi

echo ""
echo "3. Job ID: $JOB_ID"
echo "4. Streaming events (first 10 seconds)..."
timeout 10 curl -N "$API_BASE/v1/jobs/$JOB_ID/events" || true

echo ""
echo "5. Check job status..."
curl -sS "$API_BASE/v1/jobs/$JOB_ID" 2>/dev/null || echo "Status endpoint not available"

echo ""
echo "Test complete!"
```

**Save as `test-e2e.sh` and run:**
```bash
chmod +x test-e2e.sh
./test-e2e.sh
```

---

## Verify Worker Processing

### Check Worker Logs

1. Go to Railway → `precogs-worker` → Logs
2. Look for:
   ```
   [worker] Processing job <job-id>: precog=schema, retry=0
   [worker] Completed job <job-id> in <time>ms
   ```

### Verify Job Events in Database

**Using Railway PostgreSQL Shell:**
```sql
SELECT id, type, data, ts 
FROM precogs.events 
WHERE job_id = '<job-id>' 
ORDER BY ts ASC;
```

**Or check via API:**
```bash
curl -N "https://precogs.croutons.ai/v1/jobs/$JOB_ID/events"
```

---

## Test Scenarios

### Scenario 1: Basic Job Creation

```bash
curl -X POST https://precogs.croutons.ai/v1/invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"precog":"schema","url":"https://example.com"}'
```

**Verify:**
- ✅ Returns `job_id`
- ✅ Job appears in database
- ✅ Worker processes job
- ✅ Events stream correctly

---

### Scenario 2: Function Calling (`/v1/chat`)

```bash
curl -N -X POST https://precogs.croutons.ai/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"message":"Run schema audit on https://example.com"}'
```

**Verify:**
- ✅ Function call detected
- ✅ Job created
- ✅ URLs returned
- ✅ Model provides follow-up

---

### Scenario 3: KB Fallback

```bash
# Without kb parameter
curl -X POST https://precogs.croutons.ai/v1/invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"precog":"schema","url":"https://example.com"}'

# Check job context has kb="general"
```

**Verify:**
- ✅ Job created successfully
- ✅ Context includes `kb: "general"`

---

### Scenario 4: Error Handling

**Missing Required Field:**
```bash
curl -X POST https://precogs.croutons.ai/v1/invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"url":"https://example.com"}'
```

**Expected:** `{"ok":false,"error":"precog required"}`

---

## Browser Testing

### 1. CLI Viewer
```
https://precogs.croutons.ai/cli?precog=schema&url=https://example.com
```

### 2. NDJSON Viewer
```
https://precogs.croutons.ai/runtime/ndjson.html?precog=schema&url=https://example.com
```

### 3. Auto-Run Page
```
https://precogs.croutons.ai/runtime/auto.html?precog=schema&url=https://example.com
```

---

## Monitoring Tests

### Check Metrics

```bash
curl -sS https://precogs.croutons.ai/metrics | jq .
```

**Expected:**
```json
{
  "processed_total": 0,
  "failed_total": 0,
  "inflight_jobs": 0,
  "oldest_pending_age_seconds": null,
  "redis_lag_ms": null
}
```

### Check Redis Health

```bash
curl -sS https://precogs.croutons.ai/health/redis | jq .
```

**Expected:** `{"ok":true,"redis":"configured"}`

---

## Troubleshooting

### Job Created But No Events

1. **Check Worker Logs:**
   - Is worker running?
   - Any errors in logs?
   - Is Redis connected?

2. **Check Redis Stream:**
   - Is job in Redis Stream?
   - Is consumer group created?

3. **Check Database:**
   - Is job in database?
   - Are events being inserted?

### Function Call Not Detected

1. **Check `/v1/chat` logs:**
   - Is `OPENAI_API_KEY` set?
   - Any errors in stream?

2. **Check Function Definition:**
   - Is function schema correct?
   - Are parameters valid?

### Authentication Errors

1. **Check API_KEY:**
   ```bash
   echo $API_KEY
   ```

2. **Test Without Auth:**
   - If `API_KEY` not set, auth is optional
   - Try request without `Authorization` header

---

## Quick Test Checklist

- [ ] Health endpoint works
- [ ] Job creation works
- [ ] Job events stream
- [ ] Worker processes jobs
- [ ] `/v1/chat` function calling works
- [ ] CLI viewer works
- [ ] NDJSON endpoint works
- [ ] KB fallback works
- [ ] Error handling works
- [ ] Metrics endpoint works

---

**Status:** Ready for testing  
**Last Updated:** $(date)



