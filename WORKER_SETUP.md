# Worker Service Setup

**Quick Answer:** Yes, you need to create a **separate Railway service** for the worker.

---

## Why Separate Service?

The worker needs to run continuously to consume jobs from Redis Streams. It's separate from the API service so:
- API can scale independently
- Worker can restart without affecting API
- Better resource management
- Easier monitoring

---

## Railway Setup Steps

### 1. Create New Service

1. Go to Railway Dashboard
2. Click **"New"** → **"Service"**
3. Name it: `precogs-worker`
4. Connect to the **same GitHub repository** as `precogs-api`

### 2. Set Root Directory

**Important:** Railway needs to know to build from the worker subdirectory.

1. Go to `precogs-worker` service → **Settings**
2. **Build & Deploy** → **Root Directory**
3. Set to: `precogs-worker`
4. Save

### 3. Link Databases

1. **Settings** → **Variables**
2. Click **"Add Variable"** → **"Add Reference"**
3. Link the **same Redis** database used by `precogs-api`
4. Link the **same PostgreSQL** database used by `precogs-api`
5. Railway will auto-set `REDIS_URL` and `DATABASE_URL`

### 4. Set Environment Variables

Add manually:
- `GRAPH_BASE=https://graph.croutons.ai`
- `NODE_ENV=production`

### 5. Verify Start Command

- **Settings** → **Deploy** → **Start Command**
- Should be: `npm start` (or leave blank - Railway auto-detects)

### 6. Deploy

Railway will automatically:
- Detect `package.json` in `precogs-worker/`
- Run `npm ci` to install dependencies
- Start the worker with `npm start`

---

## Verify It's Working

### Check Logs

After deployment, Railway logs should show:

```
[worker] Starting precogs-worker...
[worker] GRAPH_BASE=https://graph.croutons.ai
[redis] Connected
[worker] Created consumer group cg1 on precogs:jobs
[worker] Starting job consumption...
```

### Test Job Processing

1. Create a job:
   ```bash
   curl -X POST https://precogs.croutons.ai/v1/invoke \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{"precog":"schema","url":"https://example.com"}'
   ```

2. Check worker logs - should process the job

3. Check job events:
   ```bash
   curl https://precogs.croutons.ai/v1/jobs/<job-id>/events
   ```

---

## Troubleshooting

### Build Fails

- **Issue:** Railway can't find `package.json`
- **Fix:** Verify Root Directory is set to `precogs-worker`

### Worker Not Starting

- **Issue:** Missing environment variables
- **Fix:** Check `REDIS_URL` and `DATABASE_URL` are linked

### No Jobs Processing

- **Issue:** Consumer group not created
- **Fix:** Check logs for Redis connection errors

---

## Architecture

```
┌──────────────┐
│ precogs-api  │ → Creates jobs → Redis Stream
└──────────────┘

┌──────────────┐
│ Redis Stream │ ← precogs-worker consumes
└──────────────┘

┌──────────────┐
│precogs-worker│ → Processes → Updates PostgreSQL
└──────────────┘
```

---

**See Also:**
- `precogs-worker/RAILWAY_DEPLOYMENT.md` - Detailed deployment guide
- `precogs-worker/README.md` - Worker documentation

---

**Status:** Ready to deploy  
**Last Updated:** $(date)









