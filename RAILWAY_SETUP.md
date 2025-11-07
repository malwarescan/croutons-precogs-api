# Railway Setup & Verification Guide

## A) Verify Railway App is Answering

### 1) Health endpoint (default Railway domain)

```bash
curl -i https://precogs-api-production.up.railway.app/health
```

**Expected:** HTTP 200 with `{"ok": true, "ts": "..."}`

**If NOT 200:**
- Railway → Service → Networking → Target port MUST be **8080**
- Remove any `PORT` env var override; let Railway inject `PORT`
- Confirm code binds `0.0.0.0` on `process.env.PORT || 8080`

### 2) Runtime page (should load HTML)

```bash
curl -I https://precogs-api-production.up.railway.app/runtime
```

**Expected:** HTTP 200 with `Content-Type: text/html`

### 3) Invoke stub → get job_id

```bash
curl -sS https://precogs-api-production.up.railway.app/v1/invoke \
  -H 'content-type: application/json' \
  -d '{"precog":"schema","prompt":"demo","stream":true}'
```

**Expected:** `{"ok":true,"job_id":"...","stream":true}`

### 4) Open the UI tester

In a browser: https://precogs-api-production.up.railway.app/runtime

Click "Invoke stub" and confirm you see:
- `[grounding 1]`
- `Hello from Precogs stub…`
- `[complete]`

**Or use the verification script:**
```bash
npm run verify
```

---

## B) Attach Custom Domain

1. Railway → precogs-api → Settings → Domains → Add Domain → `precogs.croutons.ai`
2. Cloudflare: keep CNAME `precogs -> precogs-api-production.up.railway.app` proxied (orange cloud)

### Re-test through the subdomain:

```bash
curl -i https://precogs.croutons.ai/health
curl -I https://precogs.croutons.ai/runtime
```

**If 404 with `x-railway-fallback: true`:**
- Custom domain isn't attached to THIS service → re-add in Railway

**If 525/SSL issues:**
- Temporarily set Cloudflare SSL mode to "Full" (not "Flexible")
- Purge cache: Cloudflare → Caching → Purge Everything

---

## C) Lock in Minimal Prod Settings

✅ **Already configured:**
- `package.json` has `"engines": { "node": ">=20.0.0" }`
- Start Command is `npm start` (Railway auto-detects)
- CORS is currently permissive for bring-up

**After domain works, restrict CORS:**
```javascript
app.use(cors({ 
  origin: ['https://precogs.croutons.ai'], 
  credentials: true 
}));
```

---

## D) Add Redis (Job Queue Backbone)

1. Railway → New → Database → Redis → link to `precogs-api` service
2. Verify `REDIS_URL` is auto-added: `redis://default:***@host:6379`

### Test Redis connection:

```bash
curl https://precogs-api-production.up.railway.app/health/redis
```

**Or add temporary test code to server.js:**
```javascript
import { testRedis } from './src/redis.js';
await testRedis(); // Should log "Connection test: PONG"
```

---

## E) Add Postgres (Job/Event Audit)

1. Railway → New → PostgreSQL → link to `precogs-api` service
2. Verify `DATABASE_URL` environment variable is present

### Run migrations:

```bash
# Set DATABASE_URL in Railway or locally
export DATABASE_URL="postgresql://..."
npm run migrate
```

**Or manually run SQL:**
```sql
-- See migrations/001_init_precogs.sql
CREATE SCHEMA IF NOT EXISTS precogs;
CREATE TYPE precogs.job_status AS ENUM ('pending','running','done','error','cancelled');
-- ... (full SQL in migrations/001_init_precogs.sql)
```

---

## F) Swap Stubs → Real Flow

### Update `/v1/invoke`:

```javascript
import { insertJob } from './src/db.js';
import { enqueueJob } from './src/redis.js';

// Insert job row (status=pending)
const job = await insertJob(precog, prompt, context);

// XADD precogs:jobs
await enqueueJob(job.id, precog, prompt, context);

// Return job_id
res.json({ ok: true, job_id: job.id, stream: !!stream });
```

### Update `/v1/jobs/:id/events`:

```javascript
import { getJobEvents } from './src/db.js';

// Read events from DB
const events = await getJobEvents(jobId);

// Stream as SSE
for (const event of events) {
  sse(res, event.type, event.data);
}
```

### Deploy `precogs-worker` (separate Railway service):

- `XREADGROUP` from `precogs:jobs`
- Set job status=running
- Fetch grounding from `GRAPH_BASE` (`/api/triples`, `/feeds/graph.json`)
- INSERT events progressively: `grounding.chunk`, `answer.delta`, `answer.complete`
- Set status=done (or error)

---

## G) Router Smoke Test

```bash
export PRECOGS_API_BASE="https://precogs.croutons.ai"
./router.js '/crtns:precog:@schema: --url https://www.hoosiercladding.com/services/siding-installation --type Service -- Generate & validate JSON-LD'
```

**Expected:** Streaming stub output now; once worker is hooked, you'll see real events.

---

## H) Troubleshooting Quick Refs

**If Railway default domain works but custom domain 404s:**
- Re-attach custom domain to THIS service; wait for "Active"

**If default domain fails to respond:**
- Networking → Target port must equal your listen port (8080); Public Networking ON

**If SSE seems dead behind Cloudflare:**
- Cloudflare → Caching → set "Cache Level: Standard" for `/v1/jobs/*` and disable Rocket Loader
- Or add a page rule to bypass cache for `/v1/jobs/*`

---

## Current Status

✅ **Complete:**
- Server scaffold with CORS
- `/v1/invoke` stub endpoint
- `/v1/jobs/:id/events` SSE stub
- `/runtime` interactive test page
- Database helpers (`src/db.js`)
- Redis helpers (`src/redis.js`)
- Migration script (`scripts/migrate.js`)
- Verification script (`scripts/verify-railway.sh`)

⏳ **Next Steps:**
1. Verify Railway deployment (Step A)
2. Attach custom domain (Step B)
3. Add Redis (Step D)
4. Add Postgres (Step E)
5. Wire real flow (Step F)
6. Deploy worker service
7. Test router end-to-end

