# Quick Verification Checklist

**Run this after deploying to verify inline + KB mode is working.**

---

## 1. Automated Check (30 seconds)

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
PRECOGS_API=https://precogs.croutons.ai ./scripts/verify-inline-mode.sh
```

**Expected:** All tests pass ✅

---

## 2. Manual Smoke Test (1 minute)

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

**Expected:** 
- `{"type":"ack","job_id":"..."}`
- `{"type":"grounding.chunk",...}` (KB loaded)
- `{"type":"answer.delta",...}` (validation output)
- `{"type":"complete","status":"done"}`

---

## 3. CLI Test (10 seconds)

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
# Copy snippet to clipboard, then:
pbpaste | npm run schema:validate -- --inline --type Service
```

**Expected:** Streamed validation results

---

## 4. Check for Hardcoded URLs (5 seconds)

```bash
cd ~/Desktop/croutons.ai/precogs/precogs-api
rg -n "hoosiercladding|url=https" runtime/ tools/ src/ || echo "✅ No hardcoded URLs"
```

**Expected:** No matches (documentation files are OK)

---

## 5. Web Viewers (30 seconds)

Open in browser:
- `https://precogs.croutons.ai/runtime/auto.html`
- `https://precogs.croutons.ai/runtime/cli.html`
- `https://precogs.croutons.ai/runtime/ndjson.html`

**Expected:** Each shows textarea for pasting content, POSTs inline by default

---

## 6. Metrics Check (5 seconds)

```bash
curl -s https://precogs.croutons.ai/metrics | jq '.processed_total, .failed_total'
```

**Expected:** `processed_total` increases, `failed_total` is 0

---

## Success Criteria

✅ All 6 checks pass  
✅ No hardcoded URLs in runtime code  
✅ Inline mode is default everywhere  
✅ KB rules provide validation feedback  

**Status:** Ready for production ✅

---

**Full details:** See `VERIFICATION_RUNBOOK.md`

