-- migrations/018_fix_croutons_schema.sql
-- Fix croutons table schema - add missing columns from v1.1 spec

-- Add domain column if missing
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS domain VARCHAR(255);

-- Add all other v1.1 columns that might be missing
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS text TEXT;
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS triple JSONB;
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS confidence REAL DEFAULT 0.5;
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS slot_id VARCHAR(64);
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS fact_id VARCHAR(64);
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS previous_fact_id VARCHAR(64);
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS revision INTEGER DEFAULT 1;
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS supporting_text TEXT;
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS evidence_anchor JSONB;
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS extraction_text_hash VARCHAR(64);
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Add crouton_id if missing (unique constraint will be added separately if needed)
ALTER TABLE croutons ADD COLUMN IF NOT EXISTS crouton_id VARCHAR(64);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_croutons_domain_v2 ON croutons(domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_croutons_source_url_v2 ON croutons(source_url) WHERE source_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_croutons_slot_id_v2 ON croutons(slot_id) WHERE slot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_croutons_fact_id_v2 ON croutons(fact_id) WHERE fact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_croutons_extraction_hash_v2 ON croutons(extraction_text_hash) WHERE extraction_text_hash IS NOT NULL;
