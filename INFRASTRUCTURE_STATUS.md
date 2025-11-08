# Infrastructure Status

**Date:** $(date)
**Status:** Infrastructure files ready, awaiting Railway deployment verification

## Completed Components

### 1. Database Migration (`migrations/001_init_precogs.sql`)
- Creates `precogs` schema
- Creates `jobs` table with status enum (pending, running, done, error, cancelled)
- Creates `events` table for job event audit trail
- Adds indexes for performance

### 2. Database Helpers (`src/db.js`)
- `insertJob()` - Create new job record
- `getJob()` - Retrieve job by ID
- `updateJobStatus()` - Update job status and timestamps
- `insertEvent()` - Insert event into audit trail
- `getJobEvents()` - Retrieve events for a job (for SSE streaming)

### 3. Redis Helpers (`src/redis.js`)
- `getRedis()` - Get or create Redis client connection
- `enqueueJob()` - Add job to Redis Stream (`precogs:jobs`)
- `testRedis()` - Test Redis connection

### 4. Migration Script (`scripts/migrate.js`)
- Automatically creates schema if missing
- Tracks applied migrations in `precogs.schema_migrations`
- Idempotent - skips already-applied migrations
- Transactional - rolls back on error

### 5. Verification Script (`scripts/verify-railway.sh`)
- Tests health endpoint
- Tests runtime page
- Tests invoke stub endpoint
- Tests custom domain (if attached)
- Works without `jq` dependency

### 6. Server Endpoints (`server.js`)
- `GET /health` - Basic health check
- `GET /health/redis` - Redis connection test
- `POST /v1/invoke` - Stub implementation (in-memory)
- `GET /v1/jobs/:id/events` - Stub SSE implementation
- `GET /runtime` - Static UI for testing

## Fixed Issues

1. **Migration script** - Now ensures `precogs` schema exists before creating migrations table
2. **Verification script** - Made `jq` optional for better compatibility

## Next Steps

### Step A: Verify Railway Deployment
```bash
curl -i https://precogs-api-production.up.railway.app/health
npm run verify
```

**Expected:** HTTP 200 with `{"ok": true, "ts": "..."}`

### Step B: Attach Custom Domain
- Railway → Settings → Domains → Add `precogs.croutons.ai`
- Verify: `curl -i https://precogs.croutons.ai/health`

### Step C: Add Redis Database
- Railway → New → Database → Redis → Link to `precogs-api` service
- Verify: `curl https://precogs-api-production.up.railway.app/health/redis`
- Expected: `{"ok": true, "redis": "configured"}`

### Step D: Add PostgreSQL Database
- Railway → New → PostgreSQL → Link to `precogs-api` service
- Run migrations: `npm run migrate` (or set DATABASE_URL locally)
- Verify: Check that tables exist in `precogs` schema

### Step E: Wire Real Flow
Update `/v1/invoke` endpoint:
```javascript
import { insertJob } from './src/db.js';
import { enqueueJob } from './src/redis.js';

const job = await insertJob(precog, prompt, context);
await enqueueJob(job.id, precog, prompt, context);
res.json({ ok: true, job_id: job.id, stream: !!stream });
```

Update `/v1/jobs/:id/events` endpoint:
```javascript
import { getJobEvents } from './src/db.js';

const events = await getJobEvents(jobId);
for (const event of events) {
  sse(res, event.type, event.data);
}
```

### Step F: Deploy Worker Service
- Create separate Railway service for worker
- Consume from Redis Stream: `XREADGROUP` from `precogs:jobs`
- Process jobs and insert events into database
- Update job status as work progresses

## Files Created

1. `migrations/001_init_precogs.sql` - Database schema
2. `src/db.js` - PostgreSQL helpers
3. `src/redis.js` - Redis helpers
4. `scripts/migrate.js` - Migration runner
5. `scripts/verify-railway.sh` - Verification script
6. `RAILWAY_SETUP.md` - Detailed setup guide
7. `INFRASTRUCTURE_STATUS.md` - This file

## Environment Variables Needed

- `DATABASE_URL` - PostgreSQL connection string (auto-set by Railway)
- `REDIS_URL` - Redis connection string (auto-set by Railway)
- `PORT` - Server port (auto-set by Railway)

## Testing Checklist

- [ ] Health endpoint returns 200
- [ ] Runtime page loads HTML
- [ ] Invoke stub returns job_id
- [ ] Custom domain works
- [ ] Redis connection test passes
- [ ] Database migrations run successfully
- [ ] Jobs table exists
- [ ] Events table exists
- [ ] Schema migrations table exists

