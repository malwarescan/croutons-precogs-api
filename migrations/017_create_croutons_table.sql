-- migrations/017_create_croutons_table.sql
-- Create the croutons table for storing all extracted facts/units

CREATE TABLE IF NOT EXISTS croutons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crouton_id VARCHAR(64) UNIQUE NOT NULL, -- legacy ID field
  domain VARCHAR(255) NOT NULL,
  source_url TEXT NOT NULL,
  
  -- Core fact data
  text TEXT NOT NULL, -- The fact text / object value
  triple JSONB, -- {subject, predicate, object} for structured facts
  confidence REAL DEFAULT 0.5,
  
  -- Protocol v1.1: Fact identity
  slot_id VARCHAR(64), -- sha256(entity_id|predicate|source_url|char_start|char_end|extraction_text_hash)
  fact_id VARCHAR(64), -- sha256(slot_id|object|fragment_hash)
  previous_fact_id VARCHAR(64),
  revision INTEGER DEFAULT 1,
  
  -- Protocol v1.1: Evidence anchors
  supporting_text TEXT,
  evidence_anchor JSONB, -- {char_start, char_end, fragment_hash, extraction_text_hash}
  extraction_text_hash VARCHAR(64), -- Links to html_snapshots.extraction_text_hash
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_croutons_domain ON croutons(domain);
CREATE INDEX IF NOT EXISTS idx_croutons_source_url ON croutons(source_url);
CREATE INDEX IF NOT EXISTS idx_croutons_slot_id ON croutons(slot_id);
CREATE INDEX IF NOT EXISTS idx_croutons_fact_id ON croutons(fact_id);
CREATE INDEX IF NOT EXISTS idx_croutons_previous_fact_id ON croutons(previous_fact_id);
CREATE INDEX IF NOT EXISTS idx_croutons_revision ON croutons(revision);
CREATE INDEX IF NOT EXISTS idx_croutons_extraction_hash ON croutons(extraction_text_hash);
CREATE INDEX IF NOT EXISTS idx_croutons_created_at ON croutons(created_at);

-- Unique constraint: one revision per slot per source
CREATE UNIQUE INDEX IF NOT EXISTS idx_croutons_slot_latest_revision 
  ON croutons(source_url, slot_id, revision) 
  WHERE slot_id IS NOT NULL AND revision IS NOT NULL;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_croutons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_croutons_updated_at
  BEFORE UPDATE ON croutons
  FOR EACH ROW
  EXECUTE FUNCTION update_croutons_updated_at();

-- Comments for documentation
COMMENT ON COLUMN croutons.evidence_anchor IS 'JSONB with char_start, char_end, fragment_hash, extraction_text_hash, optional source_selector';
COMMENT ON COLUMN croutons.slot_id IS 'Stable identity: sha256(entity_id|predicate|source_url|char_start|char_end|extraction_text_hash)';
COMMENT ON COLUMN croutons.fact_id IS 'Versioned identity: sha256(slot_id|object|fragment_hash)';
COMMENT ON COLUMN croutons.revision IS 'Increments when object changes for same slot_id';
