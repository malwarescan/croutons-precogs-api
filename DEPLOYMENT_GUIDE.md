# Precogs API Deployment Guide

Complete step-by-step deployment instructions for Railway.

## Prerequisites

- Railway account connected to GitHub
- Cloudflare account with `precogs.croutons.ai` DNS configured
- Access to Railway dashboard

---

## Step 1: Deploy precogs-api

### 1.1 Create Railway Service

1. Railway → New Project → Deploy from GitHub
2. Select `precogs-api` repository
3. Railway will auto-detect Node.js and start deploying

### 1.2 Set Environment Variables

Railway → precogs-api → Variables → Add:

```
NODE_ENV=production
GRAPH_BASE=https://graph.croutons.ai
DATABASE_URL=<will be auto-set when you add Postgres>
REDIS_URL=<will be auto-set when you add Redis>
API_KEY=<generate-a-strong-random-token>
```

**Generate API_KEY:**
```bash
# Option 1: Using openssl
openssl rand -hex 32

# Option 2: Using node
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 1.3 Add PostgreSQL Database

1. Railway → precogs-api → New → Database → PostgreSQL
2. Railway automatically sets `DATABASE_URL`
3. Wait for database to be ready

### 1.4 Add Redis Database

1. Railway → precogs-api → New → Database → Redis
2. Railway automatically sets `REDIS_URL`
3. Wait for Redis to be ready

### 1.5 Run Migrations

**Option A: Via Railway Shell (Recommended)**
1. Railway → precogs-api → Deployments → Latest → Shell
2. Run:
```bash
npm run migrate
```

**Option B: Via Local Machine**
```bash
# Set DATABASE_URL from Railway dashboard
export DATABASE_URL="postgresql://..."
npm run migrate
```

**Expected output:**
```
[migrate] Running precogs migrations...
✅ Applied 001_init_precogs.sql
Migrations applied: 1
```

### 1.6 Verify API Deployment

```bash
# Health check
curl -sS https://precogs.croutons.ai/health
# Expected: {"ok":true,"ts":"..."}

# Runtime page
curl -I https://precogs.croutons.ai/runtime
# Expected: HTTP 200

# Metrics
curl -sS https://precogs.croutons.ai/metrics
# Expected: {"processed_total":0,"failed_total":0,"oldest_pending_age_seconds":null}

# Redis health
curl -sS https://precogs.croutons.ai/health/redis
# Expected: {"ok":true,"redis":"configured"}
```

### 1.7 Configure Networking

Railway → precogs-api → Settings → Networking:
- **Target Port:** `8080`
- **Public Networking:** ON

---

## Step 2: Deploy precogs-worker

### 2.1 Create Worker Service

1. Railway → New Project → Deploy from GitHub
2. Select `precogs-worker` repository (or same repo, different service)
3. Railway will auto-detect Node.js

### 2.2 Set Environment Variables

Railway → precogs-worker → Variables → Add:

```
NODE_ENV=production
DATABASE_URL=<same-as-precogs-api>
REDIS_URL=<same-as-precogs-api>
GRAPH_BASE=https://graph.croutons.ai
```

**Note:** Use the same `DATABASE_URL` and `REDIS_URL` from precogs-api service.

### 2.3 Verify Worker Startup

Railway → precogs-worker → Deployments → Latest → Logs

**Expected logs:**
```
[worker] Starting precogs-worker...
[worker] GRAPH_BASE=https://graph.croutons.ai
[worker] Consumer: c1-<pid>
[redis] Connected
[worker] Created consumer group cg1 on precogs:jobs
[worker] Starting job consumption...
```

### 2.4 Initialize Consumer Group (Optional)

If worker fails to create consumer group, initialize manually:

Railway → precogs-worker → Deployments → Latest → Shell

```javascript
import { createClient } from 'redis';
const r = createClient({url:process.env.REDIS_URL});
await r.connect();
try {
  await r.xGroupCreate('precogs:jobs','cg1','$',{MKSTREAM:true});
  console.log('Consumer group created');
} catch(e){
  console.log('Group already exists or error:', e.message);
}
await r.quit();
```

---

## Step 3: Configure Cloudflare

### 3.1 SSL Mode

Cloudflare → SSL/TLS → Overview:
- Set SSL mode to **Full** (not Flexible)

### 3.2 Cache Bypass for SSE

Cloudflare → Rules → Cache Rules → Create Rule:

**Rule Name:** Bypass SSE endpoints
**URL:** `precogs.croutons.ai/v1/jobs/*`
**Cache Status:** Bypass

**Alternative:** Page Rules (legacy)
- URL: `precogs.croutons.ai/v1/jobs/*`
- Cache Level: Bypass

### 3.3 Disable Rocket Loader (Optional)

Cloudflare → Speed → Optimization:
- Disable Rocket Loader for `precogs.croutons.ai` subdomain

---

## Step 4: End-to-End Test

### 4.1 Create a Job

```bash
export API_KEY="<your-api-key-from-railway>"

curl -sS https://precogs.croutons.ai/v1/invoke \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $API_KEY" \
  -d '{
    "precog":"schema",
    "prompt":"Generate & validate JSON-LD",
    "context":{
      "url":"https://www.hoosiercladding.com/services/siding-installation",
      "type":"Service"
    },
    "stream":true
  }'
```

**Expected response:**
```json
{"ok":true,"job_id":"<uuid>","stream":true}
```

### 4.2 Stream Events

**Option A: Browser**
Open in browser:
```
https://precogs.croutons.ai/v1/jobs/<JOB_ID>/events
```

**Option B: curl**
```bash
export JOB_ID="<paste-job-id-from-step-4.1>"

curl -N https://precogs.croutons.ai/v1/jobs/$JOB_ID/events
```

**Expected events:**
```
event: grounding.chunk
data: {"count":1,"source":"https://graph.croutons.ai/api/triples"}

event: answer.delta
data: {"text":"Processing precog \"schema\"..."}

event: answer.complete
data: {"ok":true}
```

### 4.3 Verify Worker Processing

Railway → precogs-worker → Logs should show:
```
[worker] Processing job <uuid>: precog=schema
[worker] Completed job <uuid>
[worker] Acknowledged message <id> for job <uuid>
```

### 4.4 Check Metrics

```bash
curl -sS https://precogs.croutons.ai/metrics | jq .
```

After processing a job:
```json
{
  "processed_total": 1,
  "failed_total": 0,
  "oldest_pending_age_seconds": null
}
```

---

## Step 5: Router Integration (Optional)

If you have a router script locally:

```bash
export PRECOGS_API_BASE="https://precogs.croutons.ai"
export PRECOGS_API_TOKEN="$API_KEY"

./router.js '/crtns:precog:@schema: --url https://www.hoosiercladding.com/services/siding-installation --type Service -- Generate & validate JSON-LD'
```

---

## Step 6: Troubleshooting

### Issue: API returns job_id but no events stream

**Diagnosis:**
1. Check worker logs for `XREADGROUP` activity
2. Verify worker is calling `insertEvent()` and `updateJobStatus()`
3. Check database: `SELECT * FROM precogs.events WHERE job_id = '<job_id>';`

**Fix:**
- Ensure worker is running and connected to Redis
- Verify `DATABASE_URL` and `REDIS_URL` are set correctly
- Check worker logs for errors

### Issue: API returns 401 on `/v1/invoke`

**Diagnosis:**
- `API_KEY` is set but request missing `Authorization` header

**Fix:**
```bash
# Add auth header
curl -H "authorization: Bearer $API_KEY" ...
```

**Or temporarily disable auth:**
- Railway → Variables → Remove `API_KEY` (not recommended for production)

### Issue: SSE stalls or doesn't stream

**Diagnosis:**
- Cloudflare caching SSE endpoints
- Nginx/proxy buffering

**Fix:**
1. Verify Cloudflare cache bypass rule for `/v1/jobs/*`
2. Test directly via Railway domain:
   ```bash
   curl -N https://precogs-api-production.up.railway.app/v1/jobs/$JOB_ID/events
   ```
3. Check server logs for polling activity

### Issue: Port/ingress mismatch

**Diagnosis:**
- Railway shows deployment but requests fail

**Fix:**
1. Railway → Settings → Networking → Target Port = `8080`
2. Verify app binds to `0.0.0.0` on `process.env.PORT || 8080`
3. Check deployment logs for "listening on" message

### Issue: Worker not picking up jobs

**Diagnosis:**
- Jobs created but worker logs show no activity

**Fix:**
1. Verify consumer group exists:
   ```bash
   # In Railway shell for worker
   redis-cli -u $REDIS_URL XINFO GROUPS precogs:jobs
   ```
2. Check Redis connection in worker logs
3. Verify `REDIS_URL` matches between API and worker
4. Check stream has messages:
   ```bash
   redis-cli -u $REDIS_URL XINFO STREAM precogs:jobs
   ```

### Issue: Database connection errors

**Diagnosis:**
- Migration fails or API can't connect

**Fix:**
1. Verify `DATABASE_URL` is set correctly
2. Check Railway PostgreSQL service is running
3. For Railway internal connections, SSL should be disabled (handled automatically)
4. Test connection:
   ```bash
   # In Railway shell
   psql $DATABASE_URL -c "SELECT 1;"
   ```

---

## Step 7: Production Hardening Checklist

- [x] CORS restricted to `https://precogs.croutons.ai` (via `NODE_ENV=production`)
- [x] Bearer authentication on `/v1/invoke` (via `API_KEY`)
- [x] Metrics endpoint at `/metrics`
- [ ] Consider per-team API tokens (future enhancement)
- [ ] Set up monitoring/alerts on `failed_total` and `oldest_pending_age_seconds`
- [ ] Configure log aggregation (Railway → Logs → Export)
- [ ] Set up health check monitoring
- [ ] Review and implement rate limiting (future enhancement)
- [ ] Add request ID tracking for debugging

---

## Environment Variables Reference

### precogs-api
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | - | Set to `production` |
| `DATABASE_URL` | Yes | - | Auto-set by Railway PostgreSQL |
| `REDIS_URL` | Yes | - | Auto-set by Railway Redis |
| `GRAPH_BASE` | Yes | - | Graph service URL |
| `API_KEY` | No | - | Bearer token for auth (optional) |
| `CORS_ORIGIN` | No | `precogs.croutons.ai` | Comma-separated origins |
| `PORT` | No | `8080` | Server port (auto-set by Railway) |

### precogs-worker
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | - | Set to `production` |
| `DATABASE_URL` | Yes | - | Same as precogs-api |
| `REDIS_URL` | Yes | - | Same as precogs-api |
| `GRAPH_BASE` | Yes | `https://graph.croutons.ai` | Graph service URL |

---

## Quick Reference Commands

```bash
# Health checks
curl https://precogs.croutons.ai/health
curl https://precogs.croutons.ai/health/redis
curl https://precogs.croutons.ai/metrics

# Create job
curl -X POST https://precogs.croutons.ai/v1/invoke \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"precog":"schema","prompt":"test","stream":true}'

# Stream events
curl -N https://precogs.croutons.ai/v1/jobs/<JOB_ID>/events

# Run migrations
npm run migrate

# Verify database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM precogs.jobs;"
```

---

## Support

- Railway Logs: Railway → Service → Deployments → Logs
- Database Shell: Railway → PostgreSQL → Connect → psql
- Redis Shell: Railway → Redis → Connect → redis-cli

