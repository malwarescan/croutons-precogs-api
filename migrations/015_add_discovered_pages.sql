-- migrations/015_add_discovered_pages.sql
-- Track discovered pages with <link rel="alternate"> tags

CREATE TABLE IF NOT EXISTS discovered_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR(255) NOT NULL,
  page_url TEXT NOT NULL,
  alternate_href TEXT NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_scanned_at TIMESTAMPTZ,
  ingestion_id VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(domain, page_url)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_discovered_pages_domain ON discovered_pages(domain);
CREATE INDEX IF NOT EXISTS idx_discovered_pages_discovered_at ON discovered_pages(discovered_at);
CREATE INDEX IF NOT EXISTS idx_discovered_pages_last_scanned_at ON discovered_pages(last_scanned_at);
CREATE INDEX IF NOT EXISTS idx_discovered_pages_is_active ON discovered_pages(is_active);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_discovered_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_discovered_pages_updated_at
  BEFORE UPDATE ON discovered_pages
  FOR EACH ROW
  EXECUTE FUNCTION update_discovered_pages_updated_at();
