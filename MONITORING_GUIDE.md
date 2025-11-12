# Deployment Monitoring & Troubleshooting Guide

**Real-time monitoring and recovery steps for inline + KB mode deployment**

---

## A) While Script is Running

### 1) Monitor API Logs (Terminal 2)

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
npx railway logs -s precogs-api
```

**Expected Output:**
```
Starting Container
precogs-api listening on 8080
[ingest] POST /v1/run.ndjson received
GET /v1/run.ndjson 200
POST /v1/run.ndjson 200
```

**Good Signs:**
- ✅ Container starts successfully
- ✅ Server listening on port 8080
- ✅ POST requests return 200
- ✅ No error stack traces

**Bad Signs:**
- ❌ "Cannot find module" errors
- ❌ Port already in use
- ❌ Database connection errors
- ❌ 500 status codes

---

### 2) Monitor Worker Logs (Terminal 3)

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway logs -s precogs-worker
```

**Expected Output:**
```
[worker] Starting precogs-worker...
[worker] GRAPH_BASE=https://graph.croutons.ai
[worker] Consumer: c1-<pid>
[worker] Created consumer group cg1 on precogs:jobs
[worker] Starting job consumption...
[worker] Processing job <uuid>: precog=schema, kb=schema-foundation, source=inline, retry=0
[worker] Completed job <uuid> in 1234ms
```

**Good Signs:**
- ✅ Worker starts successfully
- ✅ Redis connection established
- ✅ Consumer group created
- ✅ Jobs processed and completed
- ✅ Completion times < 2 seconds

**Bad Signs:**
- ❌ "Redis connection failed"
- ❌ "Consumer group BUSYGROUP" (may be OK if already exists)
- ❌ Jobs stuck in "Processing" state
- ❌ "Could not load KB rules" errors
- ❌ Jobs failing with errors

---

## B) If Script Appears to Hang

### 3) Check Service Status

```bash
# API Service
cd ~/Desktop/croutons.ai/precogs/precogs-api
npx railway status
```

**Expected:**
```
Project: CROUTONS
Environment: production
Service: precogs-api
Status: Active
```

```bash
# Worker Service
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway status
```

**Expected:**
```
Project: CROUTONS
Environment: production
Service: precogs-worker
Status: Active
```

**If Wrong Environment:**
```bash
npx railway link
# Select: CROUTONS → production → <service-name>
```

---

### 4) Manual Redeploy (If Needed)

```bash
# API
cd ~/Desktop/croutons.ai/precogs/precogs-api
npx railway up -s precogs-api

# Wait 10-15 seconds, then:
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway up -s precogs-worker
```

---

## C) Manual Verification (If Script Doesn't Finish)

### 5) Quick Health + Metrics Check

```bash
# Health endpoint
curl -s https://precogs.croutons.ai/health
# Expected: {"ok":true,"ts":"..."}

# Metrics endpoint
curl -s https://precogs.croutons.ai/metrics
# Expected: {"processed_total":N,"failed_total":0,...}
```

**Good:** Both return JSON, no errors  
**Bad:** 404, 500, or connection refused

---

### 6) INLINE + KB Smoke Test

```bash
API="https://precogs.croutons.ai"
SNIPPET='{"@context":"https://schema.org","@type":"Service","name":"Siding Installation","provider":{"@type":"Organization","name":"Example Co"}}'

curl -N "$API/v1/run.ndjson" \
  -H "Content-Type: application/json" \
  -d '{
    "precog": "schema",
    "kb": "schema-foundation",
    "task": "validate",
    "type": "Service",
    "content_source": "inline",
    "content": '"$SNIPPET"'
  }'
```

**Expected Stream (in order):**
```
{"type":"ack","job_id":"<uuid>"}
{"type":"grounding.chunk","data":{"count":1,"source":"KB: schema-foundation","rules_loaded":true},"ts":"..."}
{"type":"answer.delta","data":{"text":"\n📋 Schema Validation Results for @type: Service\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"✅ Schema is valid!\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"\n💡 Recommendations:\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"  • Consider adding: description\n"},"ts":"..."}
{"type":"complete","status":"done"}
```

**Good:** All event types appear, validation output present  
**Bad:** Only heartbeats, no answer.delta, errors in stream

---

### 7) Verify Worker Consumed Job

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway logs -s precogs-worker | tail -20
```

**Expected:**
```
[worker] Processing job <uuid>: precog=schema, kb=schema-foundation, source=inline, retry=0
[worker] Completed job <uuid> in 1234ms
```

**Good:** Job processed and completed  
**Bad:** No processing logs, job stuck, errors

---

### 8) Metrics Increment Check

```bash
curl -s https://precogs.croutons.ai/metrics | jq '.processed_total, .failed_total'
```

**Expected:**
- `processed_total` increases after each successful job
- `failed_total` remains 0

**Good:** Metrics increment correctly  
**Bad:** Metrics don't change, failed_total > 0

---

## D) Common Failures & Quick Fixes

### Only Heartbeats in curl

**Symptoms:** Receive `{"type":"heartbeat"}` but no `answer.delta` events

**Diagnosis:**
```bash
# Check worker logs
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway logs -s precogs-worker
```

**Fix:**
```bash
# Worker isn't consuming - redeploy worker
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway up -s precogs-worker

# Wait 10 seconds, then check logs again
npx railway logs -s precogs-worker
```

**Root Causes:**
- Worker not connected to Redis
- Consumer group not initialized
- Worker crashed/stopped

---

### getaddrinfo EINVAL / *.railway.internal

**Symptoms:** Database or Redis connection errors

**Diagnosis:**
```bash
# Check environment variables
npx railway variables -s precogs-api
npx railway variables -s precogs-worker
```

**Fix:**
1. Verify `DATABASE_URL` and `REDIS_URL` exist on both services
2. Check URLs are valid (not malformed)
3. Set via Railway dashboard if missing
4. Redeploy both services:
   ```bash
   cd ~/Desktop/croutons.ai/precogs/precogs-api
   npx railway up -s precogs-api
   
   cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
   npx railway up -s precogs-worker
   ```

---

### Inline Still Triggers URL Mode

**Symptoms:** Worker processes as URL mode even with inline content

**Diagnosis:**
Check the request payload includes:
- ✅ `"content_source":"inline"`
- ✅ `"content":"{...}"`
- ❌ NO `"url"` field

**Fix:**
```bash
# Re-run POST exactly as shown (no url field)
API="https://precogs.croutons.ai"
SNIPPET='{"@context":"https://schema.org","@type":"Service","name":"Test"}'

curl -N "$API/v1/run.ndjson" \
  -H "Content-Type: application/json" \
  -d '{
    "precog": "schema",
    "kb": "schema-foundation",
    "task": "validate",
    "type": "Service",
    "content_source": "inline",
    "content": '"$SNIPPET"'
  }'
```

---

### CORS/POST Blocked from Web Viewer

**Symptoms:** Browser console shows CORS errors

**Diagnosis:**
```bash
# Test OPTIONS preflight
curl -i -X OPTIONS https://precogs.croutons.ai/v1/run.ndjson \
  -H "Origin: https://precogs.croutons.ai" \
  -H "Access-Control-Request-Method: POST"
```

**Expected:**
```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://precogs.croutons.ai
Access-Control-Allow-Methods: POST, GET, OPTIONS
```

**Fix:**
- Ensure API sets CORS headers for POST
- Check `server.js` CORS configuration
- Redeploy API if CORS was patched:
  ```bash
  cd ~/Desktop/croutons.ai/precogs/precogs-api
  npx railway up -s precogs-api
  ```

---

### Script Permission Error

**Symptoms:** `Permission denied` when running script

**Fix:**
```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
chmod +x ./scripts/deploy-and-verify.sh
./scripts/deploy-and-verify.sh
```

---

### KB Rules Not Loading

**Symptoms:** No validation output, worker logs show "Could not load KB rules"

**Diagnosis:**
```bash
# Check worker logs
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway logs -s precogs-worker | grep -i "kb\|rules"
```

**Fix:**
1. Verify `rules/schema-foundation.json` exists in worker directory
2. Check file is included in deployment (not gitignored)
3. Add debug logging:
   ```javascript
   console.log('[worker] KB:', kb, 'Rules loaded:', !!rules);
   ```
4. Redeploy worker

---

## What "Done" Looks Like

### ✅ Success Indicators

**API Logs:**
- Shows POST `/v1/run.ndjson` requests
- Returns 200 status codes
- No errors or stack traces

**Worker Logs:**
- "Processing job ..." for each posted job
- "Completed job ... in <X>ms" (typically < 2s)
- No errors or retries

**Curl Stream:**
- `{"type":"ack","job_id":"..."}`
- `{"type":"grounding.chunk",...}` (KB loaded)
- `{"type":"answer.delta",...}` (validation output)
- `{"type":"answer.complete",...}`
- `{"type":"complete","status":"done"}`

**Metrics:**
- `processed_total` increments
- `failed_total` remains 0
- `inflight_jobs` returns to 0 after completion

---

## Quick Status Check

Run this to get a quick overview:

```bash
echo "=== Health ==="
curl -s https://precogs.croutons.ai/health | jq '.'

echo ""
echo "=== Metrics ==="
curl -s https://precogs.croutons.ai/metrics | jq '{processed: .processed_total, failed: .failed_total, inflight: .inflight_jobs}'

echo ""
echo "=== API Status ==="
cd ~/Desktop/croutons.ai/precogs/precogs-api
npx railway status

echo ""
echo "=== Worker Status ==="
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway status
```

---

**Last Updated:** December 2024  
**Use This Guide:** During deployment, monitoring, and troubleshooting

