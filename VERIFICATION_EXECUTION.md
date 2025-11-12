# Verification Execution Guide

**Complete copy-paste verification run for INLINE + KB mode**

---

## Quick Execution

Run the complete deployment and verification script:

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
./scripts/deploy-and-verify.sh
```

This will:
1. Deploy API and Worker to Railway
2. Run automated verification
3. Execute manual smoke tests
4. Check all verification points

---

## Manual Step-by-Step Execution

If you prefer to run steps manually:

### 0) Deploy Latest

```bash
# API
cd ~/Desktop/croutons.ai/precogs/precogs-api
npx railway link && npx railway up -s precogs-api
npx railway logs -s precogs-api

# WORKER
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway link && npx railway up -s precogs-worker
npx railway logs -s precogs-worker
```

**Wait:** 10-15 seconds for services to start

---

### 1) Automated Verification

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
PRECOGS_API=https://precogs.croutons.ai ./scripts/verify-inline-mode.sh
```

**Expected:** All tests pass ✅

---

### 2) Manual Smoke Test (INLINE, no URL)

```bash
API="https://precogs.croutons.ai"
SNIPPET='{"@context":"https://schema.org","@type":"Service","name":"Siding Installation","provider":{"@type":"Organization","name":"Hoosier Cladding"}}'

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

**Expected Stream:**
```
{"type":"ack","job_id":"..."}
{"type":"grounding.chunk","data":{"count":1,"source":"KB: schema-foundation","rules_loaded":true},"ts":"..."}
{"type":"answer.delta","data":{"text":"\n📋 Schema Validation Results for @type: Service\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"✅ Schema is valid!\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"\n💡 Recommendations:\n"},"ts":"..."}
{"type":"complete","status":"done"}
```

---

### 3) Worker Log Confirmation

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway logs -s precogs-worker
```

**Expected:**
```
[worker] Processing job <uuid>: precog=schema, kb=schema-foundation, source=inline, retry=0
[worker] Completed job <uuid> in <X>ms
```

---

### 4) Metrics Sanity

```bash
curl -s https://precogs.croutons.ai/metrics | jq '.processed_total, .failed_total'
```

**Expected:** `processed_total` incremented, `failed_total == 0`

---

### 5) /v1/chat Function-Calling Path (INLINE by default)

```bash
API="https://precogs.croutons.ai"

curl -N "$API/v1/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "message": "Validate this Service schema and suggest fixes: {\"@context\":\"https://schema.org\",\"@type\":\"Service\",\"name\":\"Gutter Repair\"}",
    "type": "Service"
  }'
```

**Expected:** Function call with `content_source=inline`, `kb=schema-foundation`, no `url` field

---

### 6) Cursor One-Liner Summon (@schema inline)

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api

# Copy any JSON-LD/HTML to clipboard, then:
pbpaste | npm run schema:validate -- --inline --type Service
```

**Expected:** Same streamed validation as step 2

---

### 7) Hardcoded URL Guard

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
rg -n "hoosiercladding|url=https?://" runtime/ tools/ src/ || echo "✅ No hardcoded URLs"
```

**Expected:** No hits in runtime/handlers/tools. Hits only allowed in docs/tests.

---

### 8) Web Viewers POST Path Check

```bash
API="https://precogs.croutons.ai"
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS "$API/v1/run.ndjson" \
  -H "Origin: https://precogs.croutons.ai" \
  -H "Access-Control-Request-Method: POST"
```

**Expected:** `200` or `204` with proper CORS headers

---

## Troubleshooting

### Only Heartbeats, No Results

**Symptoms:** Receive `{"type":"heartbeat"}` but no `answer.delta` events

**Fix:**
1. Check worker logs: `npx railway logs -s precogs-worker`
2. Ensure worker is connected to Redis
3. Verify consumer group is initialized
4. Confirm job type routes to schema handler
5. Redeploy worker: `npx railway up -s precogs-worker`

---

### Args Still Show URL

**Symptoms:** Function calling includes `"url"` field when not provided

**Fix:**
1. Check what's being sent in the request
2. Verify system prompt in `src/integrations/openai-chat.js`
3. Ensure function schema defaults to inline
4. Remove any URL parameters from the request

---

### No KB Rule Output

**Symptoms:** Validation doesn't show KB rules or recommendations

**Fix:**
1. Confirm `rules/schema-foundation.json` exists in worker directory
2. Check worker logs for KB loading errors
3. Verify `kb` parameter is set to `"schema-foundation"`
4. Add log line: `console.log('[worker] KB:', kb, 'Rules loaded:', !!rules)`
5. Redeploy worker

---

### CORS or Viewer Issues

**Symptoms:** Browser console shows CORS errors or SSE connection fails

**Fix:**
1. Verify POST handler sets CORS headers
2. Check OPTIONS request responds correctly
3. Ensure SSE headers: `Content-Type: text/event-stream`
4. Update CORS configuration in `server.js` if needed

---

## Success Criteria

✅ All 8 verification steps pass  
✅ Inline POST returns streamed validation + suggested JSON-LD  
✅ Worker logs show jobs complete quickly (<2s typical)  
✅ `metrics.processed_total` increments and `failed_total` is zero  
✅ Function calling (`/v1/chat`) shows `content_source=inline`, no `url` unless explicitly provided  
✅ No stray hoosiercladding URLs in default paths or UI  
✅ CLI helper defaults to inline mode  
✅ Web viewers show textarea for inline content  

---

**Status:** Ready for execution  
**Last Updated:** December 2024

