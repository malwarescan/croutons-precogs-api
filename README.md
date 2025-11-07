# Precogs API

Minimal Express API service for Precogs domain oracles.

## Status

✅ Bootstrap complete - ready for Railway deployment

## Endpoints

- `GET /health` - Health check endpoint
- `GET /` - Service status
- `GET /runtime` - Static runtime page

## Local Development

```bash
npm install
npm start
```

Service runs on `http://localhost:4000` (or `PORT` env var).

## Railway Deployment

1. Connect Railway to `github.com/malwarescan/precogs-api`
2. Set start command: `npm start`
3. Add environment variables (for future use):
   - `GRAPH_BASE=https://graph.croutons.ai`
   - `DATABASE_URL=...`
   - `REDIS_URL=...`
4. Deploy
5. Add custom domain: `precogs.croutons.ai`

## Testing

```bash
curl https://precogs.croutons.ai/health
curl https://precogs.croutons.ai/
curl https://precogs.croutons.ai/runtime
```

## Next Steps

- [ ] Add `/v1/invoke` endpoint
- [ ] Add `/v1/jobs/:id/events` SSE endpoint
- [ ] Add `/v1/registry` endpoint
- [ ] Set up Postgres schema
- [ ] Set up Redis Streams
- [ ] Add authentication
- [ ] Add rate limiting

