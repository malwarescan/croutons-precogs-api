# DEPLOYMENT FIX: Root Cause Found & Fixed

**Time**: 2026-01-28 16:55 UTC  
**Status**: 🔧 BUILD IN PROGRESS

---

## ROOT CAUSE IDENTIFIED ✅

The Railway build failure was caused by an incorrect Nix package name in `nixpacks.toml`:

**WRONG**:
```toml
nixPkgs = ["nodejs-20_x"]
```

**CORRECT**:
```toml
nixPkgs = ["nodejs_20"]
```

**Error from logs**:
```
error: undefined variable 'nodejs-20_x'
at /app/.nixpacks/nixpkgs-ffeebf0acf3ae8b29f8c7049cd911b9636efd7e7.nix:19:9
```

---

## FIX DEPLOYED ✅

**Commit**: `27b9216` - "Fix nixpacks.toml: nodejs_20 instead of nodejs-20_x"  
**Pushed**: 16:55 UTC  
**Deployment**: Triggered via `railway up`

---

## CURRENT STATUS

**Build**: In progress (~2-3 minutes expected)  
**Health Check**: Scheduled for 16:58 UTC (3 minutes from trigger)  
**Next**: Once healthy, capture proof bundle

---

## WHAT HAPPENS NEXT

### 1. Build Completes (16:57-16:58 UTC)
Railway should now successfully:
- ✅ Install Node.js 20 via Nix
- ✅ Run `npm ci` (install dependencies)
- ✅ Run migrations via `npm run prestart`
- ✅ Start server via `npm run start`

### 2. Health Check (16:58 UTC)
Automated check will hit:
```bash
curl https://precogs.croutons.ai/health
```

Expected response:
```json
{
  "ok": true,
  "timestamp": "2026-01-28T16:58:00.000Z"
}
```

### 3. Proof Bundle Capture (16:59 UTC)
Once healthy, run from repo root:
```bash
./FINAL_GO_LIVE_PROOF.sh
```

Or manually:
```bash
# 1. Evidence type counts
curl -s "https://precogs.croutons.ai/v1/facts/nrlc.ai.ndjson" | jq -r '.evidence_type' | sort | uniq -c

# 2. Sample text_extraction fact
curl -s "https://precogs.croutons.ai/v1/facts/nrlc.ai.ndjson?evidence_type=text_extraction" | head -1 | jq '{slot_id,fact_id,evidence_type,object,supporting_text,evidence_anchor,anchor_missing}'

# 3. Extract validator
curl -s "https://precogs.croutons.ai/v1/extract/nrlc.ai?url=https%3A%2F%2Fnrlc.ai%2F" | jq '{extraction_text_hash,facts_validated,facts_passed,pass_rate,citation_grade}'

# 4. Mirror sections
curl -s "https://md.croutons.ai/nrlc.ai/index.md" | sed -n '1,140p'

# 5. Status endpoint
curl -s "https://precogs.croutons.ai/v1/status/nrlc.ai" | jq '{domain,verified,versions,counts,nonempty,qa}'

# 6. Graph length
curl -s "https://precogs.croutons.ai/v1/graph/nrlc.ai.jsonld" | jq '.["@graph"] | length'
```

---

## ACCEPTANCE CRITERIA

All must be true before claiming "full_protocol live":
- [ ] structured_data > 0 AND text_extraction > 0
- [ ] Text fact has real supporting_text, valid evidence_anchor, anchor_missing=false
- [ ] Extract pass_rate = 1.0, citation_grade = true, facts_validated >= 10
- [ ] Mirror has both section headers + v1.1 fact blocks
- [ ] Status shows facts_v=1.1, markdown_v=1.1, anchor_coverage_text >= 0.95
- [ ] Graph length > 0
- [ ] Status tier = "full_protocol"

---

## TIMELINE

- **13:45 UTC**: First nixpacks.toml added (wrong package name)
- **13:47 UTC**: Multiple failed build attempts
- **16:52 UTC**: Railway logs showed actual error
- **16:55 UTC**: Fixed nixpacks.toml, redeployed
- **16:58 UTC**: Expected build completion ⏳
- **16:59 UTC**: Proof bundle capture ⏳

---

## WHAT TO SAY NOW

**Current statement**:
> "Root cause identified: incorrect Nix package name in nixpacks.toml. Fix deployed at 16:55 UTC. Build in progress. Health check scheduled for 16:58 UTC. Proof bundle capture follows once service is healthy."

**STILL DO NOT SAY** (until proof bundle captured):
> ~~"Full Protocol v1.1 is live"~~

---

**Last Updated**: 2026-01-28 16:55 UTC  
**Next Check**: 16:58 UTC (health endpoint)  
**Blocker**: Build in progress (expected resolution: 16:58 UTC)
