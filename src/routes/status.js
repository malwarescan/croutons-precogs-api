// src/routes/status.js
// Protocol v1.1: Status endpoint with QA tiering
//
// GET /v1/status/{domain} - Returns comprehensive domain status including:
// - Verification status
// - Protocol versions
// - Counts (pages, facts, entities)
// - Nonempty flags
// - QA tier (best_effort | citation_grade | full_protocol)
// - Discovery proof

import { pool } from '../db.js';

/**
 * GET /v1/status/:domain
 * Returns comprehensive status for a domain
 */
export async function getStatus(req, res) {
  try {
    const { domain } = req.params;
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain required' });
    }
    
    // 1. Check verification status
    const verifiedQuery = await pool.query(
      `SELECT 
        verified_at, 
        protocol_version,
        last_ingested_at,
        qa_tier,
        qa_pass
      FROM verified_domains 
      WHERE domain = $1`,
      [domain]
    );
    
    const isVerified = verifiedQuery.rows.length > 0 && verifiedQuery.rows[0].verified_at !== null;
    const verifiedRow = verifiedQuery.rows[0] || {};
    
    if (!isVerified) {
      return res.json({
        domain,
        verified: false,
        protocol_version: null,
        message: 'Domain not verified'
      });
    }
    
    // Compute last_ingested_at if null (from latest html_snapshots.fetched_at)
    let lastIngestedAt = verifiedRow.last_ingested_at;
    if (!lastIngestedAt) {
      const ingestQuery = await pool.query(
        `SELECT MAX(fetched_at) as last_ingested_at
         FROM public.html_snapshots
         WHERE domain = $1`,
        [domain]
      );
      lastIngestedAt = ingestQuery.rows[0]?.last_ingested_at || null;
    }
    
    // 2. Check markdown versions (mirrors) - PHASE D: Detect markdown_version from content
    const markdownQuery = await pool.query(
      `SELECT 
        protocol_version,
        markdown_version,
        content,
        COUNT(*) as count
      FROM public.markdown_versions 
      WHERE domain = $1 AND is_active = true
      GROUP BY protocol_version, markdown_version, content`,
      [domain]
    );
    
    // PHASE D: Detect markdown_version from frontmatter if present
    let markdownVersion = '1.0';
    if (markdownQuery.rows.length > 0 && markdownQuery.rows[0].content) {
      const content = markdownQuery.rows[0].content;
      // Check for markdown_version in frontmatter
      const versionMatch = content.match(/markdown_version:\s*["']?([0-9.]+)["']?/);
      if (versionMatch) {
        markdownVersion = versionMatch[1];
      } else {
        // Fallback to protocol_version or default
        markdownVersion = markdownQuery.rows[0]?.protocol_version || markdownQuery.rows[0]?.markdown_version || '1.0';
      }
    }
    
    const mirrorsNonempty = markdownQuery.rows.length > 0 && markdownQuery.rows[0].count > 0;
    const pagesCount = markdownQuery.rows[0]?.count || 0;
    
    // 3. Check facts (croutons table) - PHASE C: Count by evidence_type
    const factsQuery = await pool.query(
      `SELECT 
        COUNT(*) as count,
        COUNT(CASE WHEN evidence_type = 'text_extraction' THEN 1 END) as text_extraction_count,
        COUNT(CASE WHEN evidence_type = 'structured_data' THEN 1 END) as structured_data_count,
        COUNT(CASE WHEN evidence_type = 'text_extraction' AND evidence_anchor IS NOT NULL AND COALESCE(anchor_missing, false) = false THEN 1 END) as anchored_text_count,
        COUNT(CASE WHEN slot_id IS NOT NULL AND fact_id IS NOT NULL THEN 1 END) as v11_count
      FROM public.croutons
      WHERE domain = $1`,
      [domain]
    );
    
    const factsCount = parseInt(factsQuery.rows[0]?.count || 0);
    const textExtractionCount = parseInt(factsQuery.rows[0]?.text_extraction_count || 0);
    const structuredDataCount = parseInt(factsQuery.rows[0]?.structured_data_count || 0);
    const anchoredTextCount = parseInt(factsQuery.rows[0]?.anchored_text_count || 0);
    const v11FactsCount = parseInt(factsQuery.rows[0]?.v11_count || 0);
    const factsNonempty = factsCount > 0;
    const factsVersion = v11FactsCount > 0 ? '1.1' : '1.0';
    
    // 4. Check graph (estimate based on html_snapshots existence)
    // For now, assume graph is non-empty if we have ingested pages
    const graphQuery = await pool.query(
      `SELECT COUNT(*) as count
      FROM public.html_snapshots
      WHERE domain = $1`,
      [domain]
    );
    
    const graphNonempty = parseInt(graphQuery.rows[0]?.count || 0) > 0;
    const graphVersion = '1.0'; // TODO: implement graph v1.1 when needed
    
    // 5. Check discovery proof
    const discoveryQuery = await pool.query(
      `SELECT 
        discovered_mirror_url,
        discovery_method,
        discovery_checked_at
      FROM discovered_pages
      WHERE domain = $1
      LIMIT 1`,
      [domain]
    );
    
    const discoveryProof = discoveryQuery.rows[0] || {
      discovered_mirror_url: null,
      discovery_method: 'none',
      discovery_checked_at: null
    };
    
    // 6. Extract extraction_method from html_snapshots
    const extractionQuery = await pool.query(
      `SELECT extraction_method
      FROM public.html_snapshots
      WHERE domain = $1 AND extraction_method IS NOT NULL
      LIMIT 1`,
      [domain]
    );
    
    const extractionMethod = extractionQuery.rows[0]?.extraction_method || 'unknown';
    
    // 7. Determine QA tier - PHASE C: Based on TEXT EXTRACTION ONLY
    const qaFailReasons = [];
    let qaTier = 'best_effort';
    let qaPass = false;
    
    // Citation grade requires (TEXT EXTRACTION ONLY):
    // - At least 10 text_extraction facts
    // - High anchor coverage (>= 95% of text_extraction facts have valid anchors)
    const anchorCoverageText = textExtractionCount > 0 ? anchoredTextCount / textExtractionCount : 0;
    
    if (textExtractionCount >= 10 && anchorCoverageText >= 0.95) {
      qaTier = 'citation_grade';
      qaPass = true;
    } else {
      if (textExtractionCount < 10) qaFailReasons.push(`Not enough text_extraction facts: ${textExtractionCount} (need >= 10)`);
      if (anchorCoverageText < 0.95) qaFailReasons.push(`Low text anchor coverage: ${(anchorCoverageText * 100).toFixed(1)}% (need >= 95%)`);
    }
    
    // Full protocol requires:
    // - citation_grade
    // - mirrors v1.1
    // - facts v1.1
    // - graph non-empty
    if (qaTier === 'citation_grade' && 
        markdownVersion === '1.1' && 
        factsVersion === '1.1' && 
        graphNonempty) {
      qaTier = 'full_protocol';
      qaPass = true;
    } else if (qaTier === 'citation_grade') {
      if (markdownVersion !== '1.1') qaFailReasons.push('Markdown not v1.1');
      if (factsVersion !== '1.1') qaFailReasons.push('Facts not v1.1');
      if (!graphNonempty) qaFailReasons.push('Graph empty');
    }
    
    // 8. Count unique entities (estimate from structured_data)
    const entitiesCount = graphNonempty ? 3 : 0; // Rough estimate: org, website, page
    
    // Compute protocol_version based on actual tier + versions (not hardcoded)
    const protocol_version = 
      (factsVersion === '1.1' && markdownVersion === '1.1' && qaTier === 'full_protocol')
        ? '1.1'
        : '1.0';
    
    // Build response
    const status = {
      domain,
      verified: true,
      last_ingested_at: lastIngestedAt,
      protocol_version: protocol_version,
      
      versions: {
        markdown: markdownVersion,
        facts: factsVersion,
        graph: graphVersion
      },
      
      extraction_method: extractionMethod,
      
      counts: {
        pages: pagesCount,
        facts_total: factsCount,
        facts_text_extraction: textExtractionCount,
        facts_structured_data: structuredDataCount,
        entities: entitiesCount
      },
      
      nonempty: {
        mirrors: mirrorsNonempty,
        facts: factsNonempty,
        graph: graphNonempty
      },
      
      qa: {
        tier: qaTier,
        pass: qaPass,
        fail_reasons: qaFailReasons.length > 0 ? qaFailReasons : undefined,
        anchor_coverage_text: anchorCoverageText
      },
      
      discovery: discoveryProof
    };
    
    res.json(status);
    
  } catch (error) {
    console.error('[status] Error:', error);
    res.status(500).json({ error: error.message });
  }
}
