// src/routes/audit.js
// LLM Readiness Audit endpoint for Protocol v1.1 compliance

import { pool } from '../db.js';

// POST /v1/audit
export async function auditPage(req, res) {
  try {
    const { url, mode = 'page' } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        ok: false,
        error: 'URL is required' 
      });
    }

    // Parse domain from URL
    let domain;
    try {
      const urlObj = new URL(url);
      domain = urlObj.hostname;
    } catch (e) {
      return res.status(400).json({ 
        ok: false,
        error: 'Invalid URL format' 
      });
    }

    const checks = {};
    let score = 0;
    const maxScore = 100;
    const checkWeight = maxScore / 6; // 6 checks total

    // Check 1: Discovery (alternate link tags)
    try {
      const htmlResponse = await fetch(url, {
        headers: { 'User-Agent': 'Croutons-Audit/1.0' },
        signal: AbortSignal.timeout(10000)
      });

      if (!htmlResponse.ok) {
        checks.discovery = {
          pass: false,
          message: `Failed to fetch HTML (${htmlResponse.status})`
        };
      } else {
        const html = await htmlResponse.text();
        
        // Look for markdown alternate link
        const hasMarkdownLink = html.includes('rel="alternate"') && 
                               html.includes('type="text/markdown"');
        
        checks.discovery = {
          pass: hasMarkdownLink,
          message: hasMarkdownLink 
            ? 'Found markdown alternate link tag'
            : 'Missing <link rel="alternate" type="text/markdown"> tag'
        };
        
        if (hasMarkdownLink) score += checkWeight;
      }
    } catch (error) {
      checks.discovery = {
        pass: false,
        message: `Error fetching page: ${error.message}`
      };
    }

    // Check 2: Mirror (Markdown with Protocol v1.1 frontmatter)
    try {
      // Try to find markdown mirror URL
      const mirrorUrl = url.replace(/\.html?$/, '.md');
      const mirrorResponse = await fetch(mirrorUrl, {
        headers: { 'User-Agent': 'Croutons-Audit/1.0' },
        signal: AbortSignal.timeout(10000)
      });

      if (!mirrorResponse.ok) {
        checks.mirror = {
          pass: false,
          message: 'Markdown mirror not found or not accessible'
        };
      } else {
        const markdown = await mirrorResponse.text();
        
        // Check for Protocol v1.1 frontmatter
        const hasFrontmatter = markdown.startsWith('---');
        const hasProtocolVersion = markdown.includes('protocol_version:');
        const hasSourceUrl = markdown.includes('source_url:');
        const hasCanonicalUrl = markdown.includes('canonical_url:');
        
        const isValid = hasFrontmatter && hasProtocolVersion && hasSourceUrl && hasCanonicalUrl;
        
        checks.mirror = {
          pass: isValid,
          message: isValid 
            ? 'Valid Protocol v1.1 markdown mirror'
            : 'Markdown mirror missing required frontmatter fields'
        };
        
        if (isValid) score += checkWeight;
      }
    } catch (error) {
      checks.mirror = {
        pass: false,
        message: `Error checking mirror: ${error.message}`
      };
    }

    // Check 3: Evidence Anchors (check database for deterministic anchors)
    try {
      const anchorResult = await pool.query(`
        SELECT COUNT(*) as count,
               COUNT(CASE WHEN evidence_anchor IS NOT NULL THEN 1 END) as with_anchors
        FROM public.croutons
        WHERE domain = $1
        LIMIT 1000
      `, [domain]);

      if (anchorResult.rows.length > 0) {
        const { count, with_anchors } = anchorResult.rows[0];
        const totalCount = parseInt(count);
        const anchorsCount = parseInt(with_anchors);
        
        if (totalCount === 0) {
          checks.evidence_anchors = {
            pass: false,
            message: 'No facts found for this domain'
          };
        } else {
          const percentage = (anchorsCount / totalCount) * 100;
          const pass = percentage > 80;
          
          checks.evidence_anchors = {
            pass,
            message: pass 
              ? `${percentage.toFixed(0)}% of facts have evidence anchors`
              : `Only ${percentage.toFixed(0)}% of facts have evidence anchors (need >80%)`
          };
          
          if (pass) score += checkWeight;
        }
      } else {
        checks.evidence_anchors = {
          pass: false,
          message: 'No facts found in database'
        };
      }
    } catch (error) {
      checks.evidence_anchors = {
        pass: false,
        message: `Error checking anchors: ${error.message}`
      };
    }

    // Check 4: Facts Stream (NDJSON endpoint)
    try {
      const factsUrl = `https://precogs.croutons.ai/v1/facts/${domain}.ndjson`;
      const factsResponse = await fetch(factsUrl, {
        headers: { 'User-Agent': 'Croutons-Audit/1.0' },
        signal: AbortSignal.timeout(10000)
      });

      if (!factsResponse.ok) {
        checks.facts_stream = {
          pass: false,
          message: 'Facts stream endpoint not accessible'
        };
      } else {
        const factsText = await factsResponse.text();
        const lines = factsText.trim().split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
          checks.facts_stream = {
            pass: false,
            message: 'Facts stream is empty'
          };
        } else {
          // Validate first line is valid NDJSON
          try {
            const firstFact = JSON.parse(lines[0]);
            const hasRequiredFields = firstFact.text && firstFact.crouton_id;
            
            checks.facts_stream = {
              pass: hasRequiredFields,
              message: hasRequiredFields 
                ? `Facts stream accessible (${lines.length} facts)`
                : 'Facts stream missing required fields'
            };
            
            if (hasRequiredFields) score += checkWeight;
          } catch (e) {
            checks.facts_stream = {
              pass: false,
              message: 'Facts stream contains invalid NDJSON'
            };
          }
        }
      }
    } catch (error) {
      checks.facts_stream = {
        pass: false,
        message: `Error checking facts stream: ${error.message}`
      };
    }

    // Check 5: Entity Graph (JSON-LD)
    try {
      const graphUrl = `https://precogs.croutons.ai/v1/graph/${domain}.jsonld`;
      const graphResponse = await fetch(graphUrl, {
        headers: { 'User-Agent': 'Croutons-Audit/1.0' },
        signal: AbortSignal.timeout(10000)
      });

      if (!graphResponse.ok) {
        checks.entity_graph = {
          pass: false,
          message: 'Entity graph endpoint not accessible'
        };
      } else {
        const graph = await graphResponse.json();
        const hasContext = graph['@context'] !== undefined;
        const hasGraph = graph['@graph'] !== undefined || Array.isArray(graph);
        
        checks.entity_graph = {
          pass: hasContext || hasGraph,
          message: (hasContext || hasGraph)
            ? 'Entity graph endpoint accessible and valid'
            : 'Entity graph missing @context or @graph'
        };
        
        if (hasContext || hasGraph) score += checkWeight;
      }
    } catch (error) {
      checks.entity_graph = {
        pass: false,
        message: `Error checking entity graph: ${error.message}`
      };
    }

    // Check 6: Status (Protocol version reporting)
    try {
      const statusUrl = `https://precogs.croutons.ai/v1/status/${domain}`;
      const statusResponse = await fetch(statusUrl, {
        headers: { 'User-Agent': 'Croutons-Audit/1.0' },
        signal: AbortSignal.timeout(10000)
      });

      if (!statusResponse.ok) {
        checks.status = {
          pass: false,
          message: 'Status endpoint not accessible'
        };
      } else {
        const status = await statusResponse.json();
        const hasProtocolVersion = status.protocol_version !== undefined;
        const hasFactCount = status.fact_count !== undefined;
        
        checks.status = {
          pass: hasProtocolVersion,
          message: hasProtocolVersion 
            ? `Status endpoint reports protocol ${status.protocol_version}`
            : 'Status endpoint missing protocol_version'
        };
        
        if (hasProtocolVersion) score += checkWeight;
      }
    } catch (error) {
      checks.status = {
        pass: false,
        message: `Error checking status: ${error.message}`
      };
    }

    // Determine tier based on score
    let tier = 'Not Connected';
    if (score >= 90) tier = 'Tier 1: Full Protocol';
    else if (score >= 70) tier = 'Tier 2: Core Features';
    else if (score >= 50) tier = 'Tier 3: Basic Integration';
    else if (score >= 30) tier = 'Tier 4: Partial Support';

    // Generate fix pack (basic recommendations)
    const fix_pack = {
      recommendations: []
    };

    if (!checks.discovery?.pass) {
      fix_pack.recommendations.push({
        check: 'discovery',
        action: 'Add <link rel="alternate" type="text/markdown" href="/page.md"> to HTML head',
        priority: 'high'
      });
    }

    if (!checks.mirror?.pass) {
      fix_pack.recommendations.push({
        check: 'mirror',
        action: 'Create markdown mirror with Protocol v1.1 frontmatter (protocol_version, source_url, canonical_url)',
        priority: 'high'
      });
    }

    if (!checks.evidence_anchors?.pass) {
      fix_pack.recommendations.push({
        check: 'evidence_anchors',
        action: 'Ensure facts have deterministic character offsets and fragment hashes',
        priority: 'medium'
      });
    }

    if (!checks.facts_stream?.pass) {
      fix_pack.recommendations.push({
        check: 'facts_stream',
        action: 'Implement /v1/facts/domain.ndjson endpoint with properly formatted facts',
        priority: 'high'
      });
    }

    if (!checks.entity_graph?.pass) {
      fix_pack.recommendations.push({
        check: 'entity_graph',
        action: 'Implement /v1/graph/domain.jsonld endpoint with JSON-LD format',
        priority: 'medium'
      });
    }

    if (!checks.status?.pass) {
      fix_pack.recommendations.push({
        check: 'status',
        action: 'Implement /v1/status/domain endpoint reporting protocol_version',
        priority: 'low'
      });
    }

    res.json({
      ok: true,
      url,
      domain,
      tier,
      score: Math.round(score),
      checks,
      fix_pack: fix_pack.recommendations.length > 0 ? fix_pack : null,
      audited_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Audit error:', error);
    res.status(500).json({ 
      ok: false,
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
}
