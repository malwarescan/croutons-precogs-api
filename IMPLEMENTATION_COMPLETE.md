# Implementation Complete

All steps from the deployment checklist have been implemented.

## Step 4: API Real Flow Implementation ✅

### Updated `/v1/invoke` endpoint
- Now uses `insertJob()` to create job record in PostgreSQL
- Enqueues job to Redis Stream using `enqueueJob()`
- Returns job_id from database (UUID)
- Handles Redis failures gracefully (job still created in DB)

### Updated `/v1/jobs/:id/events` endpoint
- Polls database for events using `getJobEvents()`
- Streams events as Server-Sent Events (SSE)
- Tracks last sent event to avoid duplicates
- Stops polling when job status is `done` or `error`
- Includes timeout protection (5 minutes max)

## Step 5: Worker Service Created ✅

Created `precogs-worker` service with:

### Files Created
- `worker.js` - Main worker loop
- `src/redis.js` - Redis client helper
- `src/db.js` - Database helpers (shared with API)
- `package.json` - Dependencies and scripts
- `README.md` - Deployment instructions

### Features
- Creates consumer group `cg1` on boot (idempotent)
- Reads jobs from Redis Stream `precogs:jobs`
- Updates job status to `running` when processing starts
- Inserts events: `grounding.chunk`, `answer.delta`, `answer.complete`
- Updates job status to `done` on success, `error` on failure
- Acknowledges messages with `XACK`
- Graceful error handling and retries

### TODO: Implement Actual Processing
The worker currently has placeholder logic. You need to:
1. Implement actual precog processing based on precog type
2. Fetch real grounding from `GRAPH_BASE/api/triples` or `/feeds/graph.json`
3. Handle different precog types (`schema`, etc.)

## Step 7: Hardening ✅

### CORS Restriction
- In production (`NODE_ENV=production`), restricts CORS to:
  - `https://precogs.croutons.ai` (default)
  - Or custom origins from `CORS_ORIGIN` env var (comma-separated)
- In development, remains permissive

### Bearer Authentication
- Optional authentication via `API_KEY` environment variable
- If `API_KEY` is set, `/v1/invoke` requires `Authorization: Bearer <token>` header
- Returns 401 if missing, 403 if invalid
- If `API_KEY` is not set, authentication is skipped (backward compatible)

### Metrics Endpoint
- `GET /metrics` returns JSON with:
  - `processed_total` - Count of jobs with status `done`
  - `failed_total` - Count of jobs with status `error`
  - `oldest_pending_age_seconds` - Age of oldest pending job (or null)

## Environment Variables

### precogs-api
- `DATABASE_URL` - PostgreSQL connection (auto-set by Railway)
- `REDIS_URL` - Redis connection (auto-set by Railway)
- `PORT` - Server port (auto-set by Railway)
- `NODE_ENV` - Set to `production` for CORS restriction
- `CORS_ORIGIN` - Optional comma-separated origins (defaults to precogs.croutons.ai)
- `API_KEY` - Optional Bearer token for `/v1/invoke` authentication

### precogs-worker
- `DATABASE_URL` - PostgreSQL connection (auto-set by Railway)
- `REDIS_URL` - Redis connection (auto-set by Railway)
- `GRAPH_BASE` - Graph service URL (default: `https://graph.croutons.ai`)

## Next Steps

1. **Deploy precogs-api** with Redis and Postgres linked
2. **Run migrations**: `npm run migrate` (or via Railway shell)
3. **Deploy precogs-worker** as separate Railway service
4. **Test end-to-end**: Create job → worker processes → events stream
5. **Implement actual precog processing** in worker
6. **Set `API_KEY`** in production for authentication
7. **Configure Cloudflare**:
   - Bypass cache for `/v1/jobs/*` (SSE)
   - SSL mode = Full

## Testing

### Test API endpoints:
```bash
# Health check
curl https://precogs.croutons.ai/health

# Create job (with auth if API_KEY is set)
curl -X POST https://precogs.croutons.ai/v1/invoke \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{"precog":"schema","prompt":"demo","stream":true}'

# Stream events
curl https://precogs.croutons.ai/v1/jobs/JOB_ID/events

# Metrics
curl https://precogs.croutons.ai/metrics
```

### Test worker:
- Worker should start and create consumer group
- Create a job via API
- Worker should pick it up and process it
- Events should appear in SSE stream

## Files Modified

### precogs-api
- `server.js` - Wired real database/Redis flow, added auth, metrics
- `src/db.js` - Updated `getJobEvents()` to return `id` field

### precogs-worker (new)
- `worker.js` - Main worker implementation
- `src/redis.js` - Redis client
- `src/db.js` - Database helpers
- `package.json` - Dependencies
- `README.md` - Documentation

