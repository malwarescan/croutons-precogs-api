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
    
    // 2. Check markdown versions (mirrors)
    const markdownQuery = await pool.query(
      `SELECT 
        protocol_version,
        markdown_version,
        COUNT(*) as count
      FROM markdown_versions 
      WHERE domain = $1 AND is_active = true
      GROUP BY protocol_version, markdown_version`,
      [domain]
    );
    
    const markdownVersion = markdownQuery.rows[0]?.protocol_version || markdownQuery.rows[0]?.markdown_version || '1.0';
    const mirrorsNonempty = markdownQuery.rows.length > 0 && markdownQuery.rows[0].count > 0;
    const pagesCount = markdownQuery.rows[0]?.count || 0;
    
    // 3. Check facts (croutons table)
    const factsQuery = await pool.query(
      `SELECT COUNT(*) as count,
        COUNT(CASE WHEN slot_id IS NOT NULL AND fact_id IS NOT NULL THEN 1 END) as v11_count,
        COUNT(CASE WHEN evidence_anchor IS NOT NULL THEN 1 END) as anchored_count
      FROM croutons
      WHERE domain = $1`,
      [domain]
    );
    
    const factsCount = parseInt(factsQuery.rows[0]?.count || 0);
    const v11FactsCount = parseInt(factsQuery.rows[0]?.v11_count || 0);
    const anchoredCount = parseInt(factsQuery.rows[0]?.anchored_count || 0);
    const factsNonempty = factsCount > 0;
    const factsVersion = v11FactsCount > 0 ? '1.1' : '1.0';
    
    // 4. Check graph (structured_data from html_snapshots or separate graph table)
    const graphQuery = await pool.query(
      `SELECT COUNT(*) as count
      FROM html_snapshots
      WHERE domain = $1 AND structured_data IS NOT NULL AND structured_data::text != '[]'`,
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
      FROM html_snapshots
      WHERE domain = $1 AND extraction_method IS NOT NULL
      LIMIT 1`,
      [domain]
    );
    
    const extractionMethod = extractionQuery.rows[0]?.extraction_method || 'unknown';
    
    // 7. Determine QA tier
    const qaFailReasons = [];
    let qaTier = 'best_effort';
    let qaPass = false;
    
    // Citation grade requires:
    // - v1.1 facts with evidence anchors
    // - High anchor coverage (>= 80% of facts have anchors)
    const anchorRate = factsCount > 0 ? anchoredCount / factsCount : 0;
    
    if (v11FactsCount > 0 && anchorRate >= 0.8) {
      qaTier = 'citation_grade';
      qaPass = true;
    } else {
      if (v11FactsCount === 0) qaFailReasons.push('No v1.1 facts with slot_id/fact_id');
      if (anchorRate < 0.8) qaFailReasons.push(`Low anchor coverage: ${(anchorRate * 100).toFixed(1)}% (need >= 80%)`);
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
    
    // Build response
    const status = {
      domain,
      verified: true,
      last_ingested_at: verifiedRow.last_ingested_at || null,
      protocol_version: verifiedRow.protocol_version || markdownVersion,
      
      versions: {
        markdown: markdownVersion,
        facts: factsVersion,
        graph: graphVersion
      },
      
      extraction_method: extractionMethod,
      
      counts: {
        pages: pagesCount,
        facts: factsCount,
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
        anchor_coverage: anchorRate
      },
      
      discovery: discoveryProof
    };
    
    res.json(status);
    
  } catch (error) {
    console.error('[status] Error:', error);
    res.status(500).json({ error: error.message });
  }
}
