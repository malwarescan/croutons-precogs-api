# Test Home Precog - Production Ready Checklist

**Goal:** Get a working end-to-end test with real NDJSON and real Precog answers

---

## Quick Test Command

Once everything is wired, test with:

```bash
API="https://precogs.croutons.ai"
curl -N "$API/v1/run.ndjson" \
  -H "Content-Type: application/json" \
  -d '{
    "precog": "home.safety",
    "task": "diagnose",
    "content": "I live near a canal in Fort Myers (33908). My garage floods when it rains. What should I be looking at for protection?",
    "region": "33908",
    "domain": "floodbarrierpros.com",
    "vertical": "flood_protection"
  }'
```

---

## What Needs to Be Working

### ✅ Precogs Side (Already Done)
- [x] Home precog handler (`src/homePrecog.js`)
- [x] Worker routing for home precogs
- [x] Function schema includes home namespaces
- [x] POST `/v1/run.ndjson` accepts home precog calls
- [x] Query hooks implemented

### ⏳ Croutons Side (Needs Implementation)
- [ ] Graph API endpoint for querying factlets by domain/region/vertical
- [ ] NDJSON ingestion worker running
- [ ] Factlets from `floodbarrierpros.com` in graph
- [ ] Graph query returns factlets when filtering by domain

---

## Expected Response Shape

```json
{
  "type": "ack",
  "job_id": "..."
}
{
  "type": "grounding.chunk",
  "data": {
    "source": "KB: home-foundation",
    "namespace": "home.safety",
    "task": "diagnose"
  }
}
{
  "type": "answer.delta",
  "data": {
    "text": "\n📋 Assessment:\nHome in a high flood-risk zone..."
  }
}
{
  "type": "answer.delta",
  "data": {
    "text": "\n⚠️ Risk Score: 0.82\n"
  }
}
{
  "type": "answer.delta",
  "data": {
    "text": "\n✅ Recommended Steps:\n  • Install removable flood barrier..."
  }
}
{
  "type": "complete",
  "status": "done"
}
```

---

## Troubleshooting

### If you get "No factlets found"
- Check graph API is returning data for domain/region
- Verify ingestion worker has run
- Check factlets are in graph with correct domain tag

### If you get "Precog not found"
- Verify worker.js routes `precog.startsWith("home")` correctly
- Check function schema includes home namespaces

### If response is empty
- Check `queryCroutonsGraph()` is calling graph API correctly
- Verify graph API endpoint exists and returns data
- Check worker logs for errors

---

**Status:** Ready to test once Croutons graph integration is complete




