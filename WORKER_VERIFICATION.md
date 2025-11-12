# Worker Service Verification

**Build Status:** ✅ Successful  
**Build Time:** 33.51 seconds  
**Packages Installed:** 25 packages, 0 vulnerabilities

---

## ✅ Build Completed Successfully

The Railway build logs show:
- ✅ Node.js 20.19.5 detected
- ✅ `npm ci` completed successfully
- ✅ All dependencies installed
- ✅ No vulnerabilities found
- ✅ Build completed successfully

---

## 🔍 Verify Worker is Running

### Check Railway Logs

Look for these log messages indicating the worker started:

```
[worker] Starting precogs-worker...
[worker] GRAPH_BASE=https://graph.croutons.ai
[redis] Connected
[worker] Created consumer group cg1 on precogs:jobs
[worker] Starting job consumption...
```

### If Logs Show Errors

**Common Issues:**

1. **Missing REDIS_URL or DATABASE_URL**
   - Check Railway → Settings → Variables
   - Ensure Redis and PostgreSQL are linked
   - Variables should be auto-set when databases are linked

2. **Redis Connection Failed**
   - Verify Redis database is running
   - Check REDIS_URL is correct
   - Ensure same Redis is linked to both API and worker

3. **Database Connection Failed**
   - Verify PostgreSQL database is running
   - Check DATABASE_URL is correct
   - Ensure migrations have been run

---

## 🧪 Test Worker Processing

### Step 1: Create a Test Job

```bash
curl -X POST https://precogs.croutons.ai/v1/invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "precog": "schema",
    "url": "https://example.com",
    "task": "Test worker processing"
  }'
```

**Expected Response:**
```json
{
  "ok": true,
  "job_id": "<uuid>",
  "stream": true
}
```

### Step 2: Check Worker Logs

In Railway → precogs-worker → Logs, you should see:

```
[worker] Processing job <job-id>: precog=schema, retry=0
[worker] Completed job <job-id> in <time>ms
```

### Step 3: Verify Job Events

```bash
curl https://precogs.croutons.ai/v1/jobs/<job-id>/events
```

**Expected Events:**
- `grounding.chunk`
- `answer.delta`
- `answer.complete`

---

## ✅ Success Indicators

- [x] Build completed successfully
- [ ] Worker logs show "Starting job consumption..."
- [ ] Worker processes test job
- [ ] Job events appear in database
- [ ] Job status updates to "done"

---

## 📊 Current Status

**Build:** ✅ Complete  
**Worker Running:** ⚠️ Check logs  
**Processing Jobs:** ⚠️ Test needed

---

**Next Steps:**
1. Check Railway logs for worker startup messages
2. Create a test job via API
3. Verify worker processes the job
4. Check job events are created

---

**Last Updated:** $(date)



