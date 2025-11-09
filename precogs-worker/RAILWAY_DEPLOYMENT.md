# Railway Deployment: Precogs Worker

Step-by-step guide to deploy the worker as a separate Railway service.

---

## Quick Setup

### Option 1: Separate Service (Recommended)

1. **Create New Railway Service**
   - Railway Dashboard → New → Service
   - Name: `precogs-worker`
   - Connect to same GitHub repository as `precogs-api`

2. **Configure Root Directory**
   - Settings → Build & Deploy → Root Directory
   - Set to: `precogs-worker`
   - This tells Railway to build from the worker subdirectory

3. **Link Databases**
   - Settings → Variables
   - Click "Add Variable" → "Add Reference"
   - Link the same Redis database used by `precogs-api`
   - Link the same PostgreSQL database used by `precogs-api`
   - Railway will auto-set `REDIS_URL` and `DATABASE_URL`

4. **Set Environment Variables**
   - `GRAPH_BASE=https://graph.croutons.ai`
   - `NODE_ENV=production`

5. **Set Start Command**
   - Settings → Deploy → Start Command
   - Set to: `npm start`
   - (Or leave blank - Railway will auto-detect from package.json)

6. **Deploy**
   - Railway will automatically detect the build
   - Watch logs to verify worker starts correctly

---

### Option 2: Monorepo Setup (Alternative)

If Railway doesn't support root directory easily:

1. Create a separate GitHub repository for the worker
2. Copy `precogs-worker/` contents to the new repo
3. Deploy as a separate Railway service

---

## Verification

### Check Worker Logs

After deployment, check Railway logs for:

```
[worker] Starting precogs-worker...
[worker] GRAPH_BASE=https://graph.croutons.ai
[worker] Consumer: c1-<pid>
[worker] Created consumer group cg1 on precogs:jobs
[worker] Starting job consumption...
```

### Test Job Processing

1. Create a job via API:
   ```bash
   curl -X POST https://precogs.croutons.ai/v1/invoke \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{"precog":"schema","url":"https://example.com","task":"Test"}'
   ```

2. Check worker logs - should show:
   ```
   [worker] Processing job <job-id>: precog=schema, retry=0
   [worker] Completed job <job-id> in <time>ms
   ```

3. Check job events:
   ```bash
   curl https://precogs.croutons.ai/v1/jobs/<job-id>/events
   ```

---

## Troubleshooting

### Worker Not Starting

- Check `REDIS_URL` and `DATABASE_URL` are set
- Verify root directory is set to `precogs-worker`
- Check build logs for errors

### Worker Not Processing Jobs

- Verify Redis Stream exists: `precogs:jobs`
- Check consumer group was created: `cg1`
- Verify worker logs show "Starting job consumption..."

### Build Fails

- Ensure `package.json` exists in `precogs-worker/`
- Check `package-lock.json` is up to date
- Verify Node.js version matches (>=20.0.0)

---

## Environment Variables Summary

| Variable | Source | Required |
|----------|--------|----------|
| `REDIS_URL` | Railway (linked Redis) | Yes |
| `DATABASE_URL` | Railway (linked PostgreSQL) | Yes |
| `GRAPH_BASE` | Manual | No (defaults to https://graph.croutons.ai) |
| `NODE_ENV` | Manual | No (set to `production`) |

---

## Architecture

```
┌─────────────────┐
│  precogs-api    │  Creates jobs → Redis Stream
│  (Railway)      │
└────────┬────────┘
         │
         │ enqueueJob()
         ▼
┌─────────────────┐
│  Redis Stream   │  precogs:jobs
│  (Railway DB)   │
└────────┬────────┘
         │
         │ XREADGROUP
         ▼
┌─────────────────┐
│ precogs-worker  │  Consumes jobs → Processes → Updates DB
│  (Railway)      │
└─────────────────┘
         │
         │ insertEvent()
         ▼
┌─────────────────┐
│  PostgreSQL     │  Stores events
│  (Railway DB)   │
└─────────────────┘
```

---

**Status:** Ready for deployment  
**Last Updated:** $(date)

