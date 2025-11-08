-- migrations/001_init_precogs.sql
-- Creates precogs schema and tables for job/event audit

CREATE SCHEMA IF NOT EXISTS precogs;

CREATE TYPE precogs.job_status AS ENUM ('pending','running','done','error','cancelled');

CREATE TABLE IF NOT EXISTS precogs.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  precog TEXT NOT NULL,
  prompt TEXT NOT NULL,
  context JSONB DEFAULT '{}'::jsonb,
  status precogs.job_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT
);

CREATE TABLE IF NOT EXISTS precogs.events (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES precogs.jobs(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ DEFAULT NOW(),
  type TEXT NOT NULL,
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS precogs_events_job_ts_idx ON precogs.events(job_id, ts);
CREATE INDEX IF NOT EXISTS precogs_events_job_id_idx ON precogs.events(job_id, id);
CREATE INDEX IF NOT EXISTS precogs_jobs_status_idx ON precogs.jobs(status);
CREATE INDEX IF NOT EXISTS precogs_jobs_precog_idx ON precogs.jobs(precog);

