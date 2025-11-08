# Precogs API

Express API service for Precogs domain oracles.

## Status

✅ Infrastructure ready - Database migrations, Redis helpers, and verification scripts are in place.

## Endpoints

- `GET /health` - Health check endpoint
- `GET /health/redis` - Redis connection test
- `GET /runtime` - Static runtime page for testing
- `POST /v1/invoke` - Create a new precog job (stub implementation)
- `GET /v1/jobs/:id/events` - Server-Sent Events stream for job events (stub implementation)

## Local Development

```bash
npm install
npm start
```

Service runs on `http://localhost:8080` (or `PORT` env var).

## Database Setup

Run migrations to set up the database schema:

```bash
export DATABASE_URL="postgresql://..."
npm run migrate
```

## Verification

Test Railway deployment:

```bash
npm run verify
# Or manually:
curl -i https://precogs-api-production.up.railway.app/health
```

## Railway Deployment

See `RAILWAY_SETUP.md` for detailed setup instructions.

Quick steps:
1. Connect Railway to GitHub repository
2. Add Redis database and link to service
3. Add PostgreSQL database and link to service
4. Run migrations: `npm run migrate`
5. Add custom domain: `precogs.croutons.ai`

## Project Structure

- `server.js` - Main Express server
- `src/db.js` - PostgreSQL database helpers
- `src/redis.js` - Redis client and job queue helpers
- `migrations/` - Database migration files
- `scripts/migrate.js` - Migration runner
- `scripts/verify-railway.sh` - Deployment verification script
- `runtime/` - Static UI for testing

## Next Steps

- [x] Database migration scripts
- [x] Redis helpers
- [x] Verification scripts
- [ ] Wire `/v1/invoke` to use real database and Redis
- [ ] Wire `/v1/jobs/:id/events` to read from database
- [ ] Deploy worker service to consume Redis Streams
- [ ] Add authentication
- [ ] Add rate limiting

