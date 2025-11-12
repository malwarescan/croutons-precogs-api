# Inline Mode Verification Runbook

**Date:** December 2024  
**Purpose:** Verify inline + KB mode is working end-to-end  
**Status:** Ready for execution

---

## Pre-Deployment Checklist

### 0. Pull & Restart Services

#### Local Development (if running locally)
```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
git pull
npm install
```

#### Railway - API Service
```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
npx railway link              # select CROUTONS → production → precogs-api
npx railway up -s precogs-api # deploy latest
npx railway logs -s precogs-api
```

#### Railway - Worker Service
```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway link              # select CROUTONS → production → precogs-worker
npx railway up -s precogs-worker
npx railway logs -s precogs-worker
```

**Expected:** Both services deploy successfully, worker shows consumer group initialization.

---

## Automated Verification

Run the verification script:

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
PRECOGS_API=https://precogs.croutons.ai ./scripts/verify-inline-mode.sh
```

This script checks:
- ✅ POST inline endpoint responds with ack
- ✅ KB rules are applied (validation output)
- ✅ No hardcoded URLs in runtime code
- ✅ POST endpoint CORS/OPTIONS
- ✅ Metrics endpoint accessible
- ✅ Function schema defaults to inline

---

## Manual Verification Steps

### 1. Smoke Test: POST Inline (No URL Param)

**Test:** Direct POST to `/v1/run.ndjson` with inline content

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

**Expected Output:**
```
{"type":"ack","job_id":"<uuid>"}
{"type":"grounding.chunk","data":{"count":1,"source":"KB: schema-foundation","rules_loaded":true},"ts":"..."}
{"type":"answer.delta","data":{"text":"\n📋 Schema Validation Results for @type: Service\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"✅ Schema is valid!\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"\n💡 Recommendations:\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"  • Consider adding: description\n"},"ts":"..."}
{"type":"complete","status":"done"}
```

**Worker Logs Should Show:**
```
[worker] Processing job <uuid>: precog=schema, kb=schema-foundation, source=inline, retry=0
[worker] Completed job <uuid> in XYZms
```

---

### 2. CLI Helper Defaults to Inline

**Test:** CLI tool with inline mode (default)

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api

# Put snippet in clipboard first (cmd+c), then:
pbpaste | npm run schema:validate -- --inline --type Service
```

**Expected:** Same streamed result as step 1.

**Note:** `--url` flag should only be used when deliberately wanting crawl mode.

---

### 3. GET Path Regression Guard

**Test:** Search for accidental hardcoded URLs

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
rg -n "hoosiercladding|url=https?://" --hidden || true
```

**Expected:** 
- ✅ No hits in `runtime/`, `tools/`, or `src/` directories
- ✅ Documentation files may contain examples (OK)
- ✅ Test files may contain explicit URL examples marked "legacy URL mode" (OK)

**If found:** Remove or convert to inline POST.

---

### 4. Web Viewers Prefer Inline

**Test:** Open each viewer and confirm textarea → POST behavior

1. **`/runtime/auto.html`**
   - Should show textarea for pasting content
   - "Validate Schema" button POSTs inline content
   - No hardcoded URL in default view

2. **`/runtime/cli.html`**
   - Should show input prompt when no URL provided
   - Textarea appears for pasting content
   - Ctrl+Enter submits inline content

3. **`/runtime/ndjson.html`**
   - Should support inline mode (if implemented)

**Quick CORS Check:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS "https://precogs.croutons.ai/v1/run.ndjson" \
  -H "Origin: https://precogs.croutons.ai" \
  -H "Access-Control-Request-Method: POST"
# Expect: 200 or 204
```

---

### 5. Function Calling Path Uses Inline by Default

**Test:** `/v1/chat` endpoint with plain English request (no URL)

```bash
curl -N "https://precogs.croutons.ai/v1/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "message": "Validate this schema for a Service and suggest fixes: {\"@context\":\"https://schema.org\",\"@type\":\"Service\",\"name\":\"Gutter Repair\"}",
    "type": "Service"
  }'
```

**Expected Stream:**
```
data: {"type":"content","content":"I'll validate that schema..."}
data: {"type":"function_call_start","name":"invoke_precog"}
data: {"type":"function_call","name":"invoke_precog","arguments":{"precog":"schema","kb":"schema-foundation","content_source":"inline","content":"{...}","type":"Service","task":"validate"}}
data: {"type":"function_result","result":{"job_id":"...","stream_url":"..."}}
data: {"type":"content","content":"The schema has been validated..."}
```

**Key Check:** `arguments` should contain:
- ✅ `"content_source":"inline"`
- ✅ `"kb":"schema-foundation"`
- ✅ `"content":"{...}"` (the schema snippet)
- ❌ NO `"url"` field (unless explicitly provided)

---

### 6. Confirm KB Rules Are Applied

**Test:** Intentionally incomplete schema to trigger validation rules

```bash
BAD='{"@context":"https://schema.org","@type":"Service","name":"Thing"}'

curl -N "https://precogs.croutons.ai/v1/run.ndjson" \
  -H "Content-Type: application/json" \
  -d '{
    "precog":"schema",
    "kb":"schema-foundation",
    "task":"validate",
    "type":"Service",
    "content_source":"inline",
    "content": '"$BAD"'
  }'
```

**Expected Output:**
```
{"type":"answer.delta","data":{"text":"❌ Validation Issues Found:\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"  • Missing required field: provider\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"\n💡 Recommendations:\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"  • Consider adding: description\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"  • Consider adding: areaServed\n"},"ts":"..."}
{"type":"answer.delta","data":{"text":"\n📦 Validated JSON-LD:\n```json\n{...}\n```\n"},"ts":"..."}
```

**Key Checks:**
- ✅ Lists missing required fields per `schema-foundation.json` rules
- ✅ Suggests recommended properties
- ✅ Emits corrected/validated JSON-LD block

---

### 7. Metrics Sanity Check

**Test:** Check metrics endpoint

```bash
curl -s https://precogs.croutons.ai/metrics
```

**Expected:**
```json
{
  "processed_total": <increasing number>,
  "failed_total": 0,
  "inflight_jobs": 0,
  ...
}
```

**Key Checks:**
- ✅ `processed_total` increases after each successful run
- ✅ `failed_total` stays at 0 (or low)
- ✅ `inflight_jobs` returns to 0 after completion

---

### 8. Cursor Integration (One-Liner Flow)

**Test:** Daily workflow from Cursor terminal

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api

# Copy any schema block from the editor, then:
pbpaste | npm run schema:validate -- --inline --type Service
```

**Expected:** Streamed validation results with no URL references.

**This is your daily "summon @schema" muscle memory** - exercises the same API the function-calling path uses, but with zero URL baggage.

---

## Troubleshooting

### Only Heartbeats, No Output

**Symptoms:** Receive `{"type":"heartbeat"}` but no `answer.delta` events

**Checks:**
1. Worker logs: `npx railway logs -s precogs-worker`
2. Ensure worker is consuming from Redis Streams
3. Verify Redis URL and consumer group are set
4. Check job status in database: `SELECT * FROM precogs.jobs ORDER BY created_at DESC LIMIT 5;`
5. Ensure job types route to schema handler

**Fix:** Restart worker if needed: `npx railway up -s precogs-worker`

---

### Still Sees URL in Args

**Symptoms:** Function calling includes `"url"` field when not provided

**Checks:**
1. Audit the client call - check what's being sent
2. Verify system prompt in `src/integrations/openai-chat.js`
3. Check function schema defaults in `src/functions/invoke_precog.js`

**Fix:** Remove any URL parameters from the request

---

### No KB Behavior

**Symptoms:** Validation doesn't show KB rules or recommendations

**Checks:**
1. Confirm `rules/schema-foundation.json` exists in worker directory
2. Check worker logs for KB loading: `[worker] Could not load KB rules`
3. Verify `kb` parameter is set to `"schema-foundation"`
4. Check worker code loads rules: `loadKBRules(kb)`

**Fix:** Ensure rules file is packaged and worker can access it

---

### CORS/SSE Issues in Viewers

**Symptoms:** Browser console shows CORS errors or SSE connection fails

**Checks:**
1. Verify POST handler sets CORS headers
2. Check OPTIONS request responds correctly
3. Ensure SSE headers are set: `Content-Type: text/event-stream`
4. Check browser console for specific errors

**Fix:** Update CORS configuration in `server.js` if needed

---

## Quick Acceptance Criteria

Before marking as "verified", confirm:

- ✅ Inline POST returns streamed validation + suggested JSON-LD
- ✅ Worker logs show jobs complete quickly (<2s typical)
- ✅ `metrics.processed_total` increments and `failed_total` is zero
- ✅ Function calling (`/v1/chat`) shows `"content_source":"inline"`, no `url` unless explicitly provided
- ✅ No stray hoosiercladding URLs in default paths or UI
- ✅ CLI helper defaults to inline mode
- ✅ Web viewers show textarea for inline content
- ✅ KB rules provide validation feedback

---

## Success Criteria

**✅ Verified:** All 8 tests pass, no hardcoded URLs in runtime code, KB rules working, inline mode is default.

**Status:** Ready for production use

---

**Last Updated:** December 2024  
**Next Review:** After each deployment

