# Precogs API Deployment Checklist

## ✅ Step 1: Verify Service Reachable

```bash
# Default Railway domain
curl -sS https://precogs-api-production.up.railway.app/health | jq .

# After custom domain is attached
curl -sS https://precogs.croutons.ai/health | jq .
```

## ✅ Step 2: Enhanced Server Scaffold (COMPLETE)

- ✅ CORS middleware added
- ✅ `/v1/invoke` stub endpoint (in-memory jobs)
- ✅ `/v1/jobs/:id/events` SSE stub endpoint
- ✅ `/runtime` interactive test page
- ✅ Binds to `0.0.0.0` for Railway
- ✅ Default port changed to 8080

**Test locally:**
```bash
curl -sS http://localhost:8080/v1/invoke -X POST \
  -H 'content-type: application/json' \
  -d '{"precog":"schema","prompt":"demo","stream":true}' | jq .
```

## ⏳ Step 3: Attach Custom Domain

1. Railway → Settings → Domains → Add Domain → `precogs.croutons.ai`
2. Update Cloudflare CNAME: `precogs` → `<your-service>.up.railway.app` (proxied)
3. Test:
   ```bash
   curl -sS https://precogs.croutons.ai/health | jq .
   open https://precogs.croutons.ai/runtime
   ```

## ⏳ Step 4: Add Redis (Queue Backbone)

1. Railway → New → Redis
2. Link to `precogs-api` service
3. Verify `REDIS_URL` environment variable is set
4. Test connection (add to server.js temporarily):
   ```javascript
   import { createClient } from "redis";
   const redis = createClient({ url: process.env.REDIS_URL });
   redis.on("error", e => console.error("redis error", e));
   await redis.connect();
   await redis.ping();
   await redis.quit();
   ```

## ⏳ Step 5: Add Postgres (Job/Event Audit)

1. Railway → Add Postgres
2. Set `DATABASE_URL` environment variable
3. Run migration:
   ```sql
   CREATE SCHEMA IF NOT EXISTS precogs;
   
   CREATE TYPE precogs.job_status AS ENUM ('pending','running','done','error','cancelled');
   
   CREATE TABLE IF NOT EXISTS precogs.jobs (
     id UUID PRIMARY KEY,
     precog TEXT NOT NULL,
     prompt TEXT NOT NULL,
     context JSONB DEFAULT '{}'::jsonb,
     status precogs.job_status NOT NULL DEFAULT 'pending',
     created_at TIMESTAMPTZ DEFAULT NOW(),
     started_at TIMESTAMPTZ,
     completed_at TIMESTAMPTZ,
     error TEXT
   );
   
   CREATE TABLE IF NOT EXISTS precogs.events (
     id BIGSERIAL PRIMARY KEY,
     job_id UUID NOT NULL,
     ts TIMESTAMPTZ DEFAULT NOW(),
     type TEXT NOT NULL,
     data JSONB NOT NULL
   );
   
   CREATE INDEX ON precogs.events(job_id, ts);
   ```

## ⏳ Step 6: Wire Real Flow (Replace Stubs)

- `/v1/invoke`: Insert job row → `XADD precogs:jobs * payload` → return job_id
- `/v1/jobs/:id/events`: Read events from DB (or push via pub/sub)
- Deploy `precogs-worker` service that:
  - `XREADGROUP` from `precogs:jobs`
  - Sets job running
  - Fetches grounding from `GRAPH_BASE` (`/api/triples`, `/feeds/graph.json`)
  - Emits events (`INSERT INTO precogs.events`)
  - Sets job done

## ⏳ Step 7: Hook Router

Create `router.js` locally:
```bash
export PRECOGS_API_BASE="https://precogs.croutons.ai"
./router.js '/crtns:precog:@schema: --url https://hoosiercladding.com/services/siding-installation --type Service -- Generate & validate JSON-LD'
```

## ⏳ Step 8: Production Hardening

- [ ] CORS: Restrict to your domains
- [ ] Rate-limit `/v1/invoke`
- [ ] Require Bearer token
- [ ] Add `/metrics` endpoint:
  - `processed_total`
  - `failed_total`
  - `oldest_pending_age`

## Current Status

✅ **Complete:**
- Basic Express server with health endpoint
- CORS middleware
- `/v1/invoke` stub (in-memory)
- `/v1/jobs/:id/events` SSE stub
- `/runtime` interactive test page
- Pushed to GitHub

⏳ **Next Steps:**
- Deploy to Railway
- Attach custom domain
- Add Redis
- Add Postgres
- Wire real queue flow
- Deploy worker service

