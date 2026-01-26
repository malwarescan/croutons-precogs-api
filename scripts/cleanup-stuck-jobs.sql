-- Cleanup stuck pending jobs older than 1 day
-- Run this in Railway PostgreSQL service (via any method you have access to)

-- First, see what will be cleaned:
SELECT 
  id, 
  precog, 
  prompt,
  created_at, 
  EXTRACT(EPOCH FROM (NOW() - created_at))/86400 as age_days
FROM precogs.jobs
WHERE status = 'pending'
  AND created_at < NOW() - INTERVAL '1 day'
ORDER BY created_at ASC;

-- Then clean them up:
UPDATE precogs.jobs
SET 
  status = 'error',
  error = 'Stuck job cleaned up - older than 1 day',
  completed_at = NOW()
WHERE status = 'pending'
  AND created_at < NOW() - INTERVAL '1 day';

-- Verify cleanup:
SELECT COUNT(*) as remaining_stuck_jobs
FROM precogs.jobs
WHERE status = 'pending'
  AND created_at < NOW() - INTERVAL '1 day';
