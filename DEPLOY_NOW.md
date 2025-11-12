# Deploy Now - Inline Mode POST Endpoint

**Status:** POST route exists in code but needs deployment  
**Action Required:** Commit changes and deploy to Railway

---

## Quick Deploy Steps

### 1. Commit Changes

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api

# Review changes
git status

# Commit inline mode changes
git add .
git commit -m "feat: Add inline + KB mode support

- Add POST /v1/run.ndjson endpoint for inline content
- Update function schema to default to inline mode
- Update CLI helper to use inline by default
- Update web viewers to support inline content
- Add schema-foundation KB rules
- Update worker to validate against KB rules"

# Push to remote
git push
```

### 2. Deploy API Service

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
npx railway up -s precogs-api
```

**Wait:** 15-20 seconds for deployment to complete

### 3. Deploy Worker Service

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway up -s precogs-worker
```

**Wait:** 10-15 seconds for deployment to complete

### 4. Verify POST Endpoint

```bash
API="https://precogs.croutons.ai"
SNIPPET='{"@context":"https://schema.org","@type":"Service","name":"Test Service"}'

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

**Expected:** Stream with ack → grounding.chunk → answer.delta → complete

---

## Files Changed (Need Deployment)

- `server.js` - Added POST `/v1/run.ndjson` endpoint
- `src/functions/invoke_precog.js` - Updated to support inline mode
- `tools/summon-schema.mjs` - Updated to default to inline
- `runtime/*.html` - Updated viewers for inline content
- `precogs-worker/worker.js` - Added KB rules support
- `precogs-worker/rules/schema-foundation.json` - New KB rules file

---

## After Deployment Verification

Run the full verification sequence:

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
./scripts/deploy-and-verify.sh
```

Or manually:

```bash
# Quick status
./scripts/quick-status.sh

# Smoke test
API="https://precogs.croutons.ai"
SNIPPET='{"@context":"https://schema.org","@type":"Service","name":"Test"}'
curl -N "$API/v1/run.ndjson" \
  -H "Content-Type: application/json" \
  -d '{"precog":"schema","kb":"schema-foundation","task":"validate","type":"Service","content_source":"inline","content":'"$SNIPPET"'}'
```

---

**Ready to deploy!** 🚀

