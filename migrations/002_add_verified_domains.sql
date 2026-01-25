-- migrations/002_add_verified_domains.sql
-- Add verified domains table for publisher verification

-- Drop and recreate to ensure correct schema (if table exists with wrong schema)
DROP TABLE IF EXISTS verified_domains CASCADE;

CREATE TABLE verified_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR(255) UNIQUE NOT NULL,
  verification_token VARCHAR(64) NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast domain lookups
CREATE INDEX IF NOT EXISTS idx_verified_domains_domain ON verified_domains(domain);
CREATE INDEX IF NOT EXISTS idx_verified_domains_verified_at ON verified_domains(verified_at);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_verified_domains_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_verified_domains_updated_at
  BEFORE UPDATE ON verified_domains
  FOR EACH ROW
  EXECUTE FUNCTION update_verified_domains_updated_at();
