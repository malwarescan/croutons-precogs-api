# Deployment Status

**Date:** December 2024  
**Issue:** POST `/v1/run.ndjson` endpoint not deployed

---

## Current Status

### ✅ What's Working
- API service is healthy (`/health` returns OK)
- Metrics endpoint accessible
- OPTIONS preflight works (CORS headers present)
- GET `/v1/run.ndjson` works (legacy URL mode)
- Services linked correctly to Railway

### ❌ What's Not Working
- POST `/v1/run.ndjson` returns "Cannot POST /v1/run.ndjson"
- Inline mode not accessible via POST endpoint

---

## Root Cause

The POST route exists in `server.js` (line 427) but hasn't been deployed to production yet.

---

## Fix: Deploy Latest Code

```bash
# Deploy API service
cd ~/Desktop/croutons.ai/precogs/precogs-api
npx railway up -s precogs-api

# Wait 10-15 seconds for deployment
sleep 15

# Verify POST endpoint works
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

**Expected after deployment:**
```
{"type":"ack","job_id":"..."}
{"type":"grounding.chunk",...}
{"type":"answer.delta",...}
{"type":"complete","status":"done"}
```

---

## Verification Checklist After Deployment

- [ ] POST `/v1/run.ndjson` accepts inline content
- [ ] Returns `{"type":"ack","job_id":"..."}`
- [ ] Streams `grounding.chunk` with KB source
- [ ] Streams `answer.delta` with validation output
- [ ] Completes with `{"type":"complete","status":"done"}`
- [ ] Worker logs show job processing
- [ ] Metrics increment (`processed_total` increases)

---

**Next Step:** Deploy API service to make POST endpoint available

