# Precogs Worker

Worker service that consumes jobs from Redis Streams and processes them.

## Environment Variables

- `REDIS_URL` - Redis connection string (required)
- `DATABASE_URL` - PostgreSQL connection string (required)
- `GRAPH_BASE` - Base URL for graph service (default: `https://graph.croutons.ai`)

## Railway Deployment

1. Create new Railway service: `precogs-worker`
2. Link Redis database (same as precogs-api)
3. Link PostgreSQL database (same as precogs-api)
4. Set environment variables:
   - `REDIS_URL` (auto-set by Railway)
   - `DATABASE_URL` (auto-set by Railway)
   - `GRAPH_BASE=https://graph.croutons.ai`
5. Set start command: `npm start`

## How It Works

1. On boot, creates consumer group `cg1` on stream `precogs:jobs` (if not exists)
2. Continuously reads jobs from Redis Stream using `XREADGROUP`
3. For each job:
   - Updates job status to `running`
   - Fetches grounding from graph service
   - Processes the precog
   - Inserts events (`grounding.chunk`, `answer.delta`, `answer.complete`)
   - Updates job status to `done` (or `error` on failure)
   - Acknowledges the message with `XACK`

## Local Development

```bash
npm install
export REDIS_URL="redis://..."
export DATABASE_URL="postgresql://..."
export GRAPH_BASE="https://graph.croutons.ai"
npm start
```

## Implementation Notes

The current implementation is a skeleton. You'll need to:

1. Implement actual precog processing logic based on precog type
2. Fetch real grounding data from `GRAPH_BASE/api/triples` or `/feeds/graph.json`
3. Handle different precog types (`schema`, etc.)
4. Add proper error handling and retries
5. Add metrics/logging

