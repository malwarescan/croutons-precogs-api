-- migrations/020_add_evidence_type.sql
-- Add evidence_type to distinguish anchorable text from metadata

-- Add evidence_type column
ALTER TABLE public.croutons 
  ADD COLUMN IF NOT EXISTS evidence_type VARCHAR(50) DEFAULT 'unknown';

-- Index for filtering by evidence type
CREATE INDEX IF NOT EXISTS idx_croutons_evidence_type 
  ON public.croutons(evidence_type) 
  WHERE evidence_type IS NOT NULL;

-- Add source_path for structured_data facts (schema.org path)
ALTER TABLE public.croutons 
  ADD COLUMN IF NOT EXISTS source_path TEXT;

-- Update existing rows to categorize them
-- If has evidence_anchor and supporting_text is substantial, likely text_extraction
UPDATE public.croutons
SET evidence_type = CASE
  WHEN evidence_anchor IS NOT NULL 
    AND supporting_text IS NOT NULL 
    AND length(supporting_text) > 50 
    THEN 'text_extraction'
  WHEN triple IS NOT NULL 
    AND (supporting_text IS NULL OR length(supporting_text) < 50)
    THEN 'structured_data'
  ELSE 'unknown'
END
WHERE evidence_type = 'unknown';

-- Add constraint for valid evidence types
ALTER TABLE public.croutons
  ADD CONSTRAINT check_evidence_type 
  CHECK (evidence_type IN ('structured_data', 'text_extraction', 'unknown'));

-- Comment for documentation
COMMENT ON COLUMN public.croutons.evidence_type IS 'Type of evidence: structured_data (schema.org, not anchorable) or text_extraction (quoted from page text, anchorable)';
COMMENT ON COLUMN public.croutons.source_path IS 'For structured_data: JSON path like "Organization.name" or "WebPage.description"';
