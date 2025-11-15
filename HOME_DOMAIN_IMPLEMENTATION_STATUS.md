# Home Domain Implementation Status

**Date:** December 2024  
**Status:** Foundation Complete - Ready for Croutons Team Integration

---

## ✅ Completed (Precogs Side)

### 1. Home-Foundation KB Structure
- ✅ Created `kb/home-foundation/` folder
- ✅ `kb.json` - Core KB configuration
- ✅ `types/Home.json` - Home type definitions with all tasks
- ✅ `patterns/risk-scoring.md` - Risk scoring guidelines
- ✅ `ndjson_home_factlet.schema.json` - Validation schema for partners

### 2. Home Precog Handler
- ✅ Created `src/homePrecog.js` with all 7 tasks:
  - `diagnose`
  - `assess_risk`
  - `recommend_fixes`
  - `local_context` (Casa-specific)
  - `timing`
  - `cost_band`
  - `risk_projection`
- ✅ Integrated into `worker.js` routing
- ✅ Supports all home namespaces: `home`, `home.hvac`, `home.plumbing`, `home.electrical`, `home.safety`, `home.safety.mold`, `home.flood`

### 3. Query Hooks
- ✅ Implemented `queryHooks` object with:
  - `byDomain(factlets, domain)`
  - `byRegion(factlets, region)`
  - `byVertical(factlets, vertical)`
- ✅ Integrated into home precog processing

### 4. NDJSON Ingestion Worker
- ✅ Created `src/ndjsonIngestion.js` with:
  - `fetchNDJSON(url)` - Fetches and parses NDJSON
  - `validateFactlet(factlet, schema)` - Validates against schema
  - `normalizeFactlet(rawFactlet, metadata)` - Normalizes with domain/vertical/region tags
  - `upsertFactlet(factlet)` - Upserts to Croutons graph
  - `processNDJSONSource(source)` - Full ingestion pipeline

### 5. Function Schema Updates
- ✅ Updated `invoke_precog` function schema to include all home namespaces
- ✅ Home namespaces now available in GPT function calling

---

## ⏳ Pending (Croutons Team)

### 1. Admin UI - "AI Sitemap Sources"
**Location:** Croutons dashboard  
**Status:** Not started

**Required:**
- Database table for NDJSON sources
- Admin UI with CRUD operations
- "Fetch Now" button
- Preview last 50 factlets
- Status tracking (last_fetch_at, last_fetch_status, last_error_message)

**Files to create:**
- Database migration for `ndjson_sources` table
- Admin UI component (React/Vue/etc.)
- API endpoints for source management

---

### 2. Background Ingestion Job
**Location:** Croutons service  
**Status:** Not started

**Required:**
- Scheduled job that runs every `polling_interval`
- Iterates active sources
- Calls `processNDJSONSource()` from Precogs worker
- Updates source status in admin UI

**Files to create:**
- Background job scheduler (cron/queue worker)
- Integration with Precogs ingestion module

---

### 3. Croutons Graph Extension
**Location:** `graph-service/`  
**Status:** Not started

**Required:**
- Support for home-domain entity types:
  - HVAC system
  - Plumbing system
  - Electrical components
  - Flood barrier systems
  - Roofing, siding, foundation
  - Local climate/environmental factors
  - Regional cost bands

- Support for relationship types:
  - `CAUSES`
  - `IS_SYMPTOM_OF`
  - `REQUIRES_PRO`
  - `COMMON_FIX`
  - `HAZARD_LEVEL`
  - `OPTIMAL_WINDOW_FOR`
  - `TYPICAL_COST_BAND_IN`
  - `MORE_LIKELY_IN_CLIMATE`

**Files to update:**
- Graph schema/migrations
- Query API to support domain/region/vertical filtering

---

### 4. Graph Query Integration
**Location:** `precogs-worker/src/homePrecog.js`  
**Status:** Placeholder implemented

**Required:**
- Implement actual Croutons graph query in `queryCroutonsGraph()`
- Connect to graph service API
- Support filtering by domain/region/vertical

**Current:** Placeholder function returns empty array  
**Needs:** Actual graph API integration

---

## 📋 Implementation Checklist

### Precogs Side (✅ Complete)
- [x] Create home-foundation KB folder
- [x] Create NDJSON validation schema
- [x] Implement home precog handler
- [x] Implement all 7 tasks
- [x] Add query hooks
- [x] Integrate into worker routing
- [x] Update function schema

### Croutons Side (⏳ Pending)
- [ ] Build admin UI for NDJSON sources
- [ ] Create database table for sources
- [ ] Implement background ingestion job
- [ ] Extend graph for home-domain entities
- [ ] Add relationship types
- [ ] Implement graph query API with filtering
- [ ] Connect Precogs to graph query API

---

## 🚀 Next Steps

1. **Croutons team** implements admin UI and ingestion job
2. **Croutons team** extends graph schema for home domain
3. **Precogs team** connects `queryCroutonsGraph()` to actual graph API
4. **Test** end-to-end: Casa → `invoke_precog(home.local_context)` → NDJSON
5. **Onboard** first partner (FloodBarrierPros)

---

## 📁 Files Created

### KB Structure
```
precogs-worker/kb/home-foundation/
├── kb.json
├── types/Home.json
├── patterns/risk-scoring.md
└── ndjson_home_factlet.schema.json
```

### Code Files
```
precogs-worker/src/
├── homePrecog.js (home precog handler)
└── ndjsonIngestion.js (ingestion worker)

precogs-api/src/functions/
└── invoke_precog.js (updated with home namespaces)

precogs-worker/
└── worker.js (updated with home routing)
```

---

## 🔗 Integration Points

1. **Admin UI** → Calls Precogs ingestion API
2. **Background Job** → Calls `processNDJSONSource()` from Precogs
3. **Home Precog** → Queries Croutons graph API
4. **Graph API** → Returns factlets filtered by domain/region/vertical

---

**Status:** Foundation ready - Waiting for Croutons team to implement admin UI, ingestion job, and graph extensions.




