// src/routes/discover.js
// Webhook-first discovery system for Croutons Protocol
// Primary trigger: Partner sites call this when they add <link rel="alternate">

import { pool } from '../db.js';
import { parse } from 'node-html-parser';
import dns from 'dns/promises';

/**
 * Verify domain ownership (DNS TXT or HTTP well-known fallback)
 */
async function verifyDomain(domain) {
  // Check if domain is verified in database
  const verified = await pool.query(
    'SELECT verified_at, verification_token FROM verified_domains WHERE domain = $1',
    [domain]
  );

  if (verified.rows.length === 0 || !verified.rows[0].verified_at) {
    return { verified: false, error: 'Domain not verified. Call /v1/verify/initiate first.' };
  }

  const { verification_token } = verified.rows[0];

  // Try DNS TXT first
  try {
    const txtRecords = await dns.resolveTxt(domain);
    const flatRecords = txtRecords.flat();
    const expectedRecord = `croutons-verification=${verification_token}`;
    
    if (flatRecords.some(record => record === expectedRecord)) {
      return { verified: true, method: 'dns' };
    }
  } catch (dnsError) {
    // DNS failed, try HTTP well-known fallback
  }

  // HTTP well-known fallback
  try {
    const wellKnownUrl = `https://${domain}/.well-known/croutons-verification.txt`;
    const response = await fetch(wellKnownUrl, {
      headers: { 'User-Agent': 'Croutons-Verifier/1.0' },
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const content = await response.text();
      if (content.trim() === verification_token) {
        return { verified: true, method: 'http' };
      }
    }
  } catch (httpError) {
    // HTTP fallback failed
  }

  return { verified: false, error: 'Verification failed. Check DNS TXT or /.well-known/croutons-verification.txt' };
}

/**
 * Extract <link rel="alternate" type="text/markdown"> from HTML
 */
function extractAlternateLink(html) {
  try {
    const root = parse(html);
    const head = root.querySelector('head');
    if (!head) return null;

    const links = head.querySelectorAll('link');
    for (const link of links) {
      const rel = link.getAttribute('rel');
      const type = link.getAttribute('type');
      const href = link.getAttribute('href');

      if (rel === 'alternate' && type === 'text/markdown' && href) {
        return {
          rel: 'alternate',
          type: 'text/markdown',
          href: href
        };
      }
    }
    return null;
  } catch (error) {
    console.error('[discover] Error parsing HTML:', error);
    return null;
  }
}

/**
 * Normalize URL for comparison
 */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * POST /v1/discover - Primary webhook trigger
 * Partner sites call this when they add <link rel="alternate">
 */
export async function discoverPage(req, res) {
  try {
    const { domain, page, alternate } = req.body;

    if (!domain || !page) {
      return res.status(400).json({ 
        error: 'domain and page are required',
        example: {
          domain: 'example.com',
          page: 'https://example.com/page',
          alternate: 'https://md.croutons.ai/example.com/page.md'
        }
      });
    }

    console.log(`[discover] Webhook received: domain=${domain}, page=${page}`);

    // Step 1: Verify domain ownership (hard gate)
    const verification = await verifyDomain(domain);
    if (!verification.verified) {
      return res.status(403).json({
        error: 'Domain not verified',
        details: verification.error,
        instructions: 'Call POST /v1/verify/initiate to start verification'
      });
    }

    console.log(`[discover] Domain verified via ${verification.method}`);

    // Step 2: Fetch page
    let html;
    try {
      const response = await fetch(page, {
        headers: { 'User-Agent': 'Croutons-Discovery/1.0' },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        return res.status(400).json({
          error: 'Failed to fetch page',
          status: response.status,
          url: page
        });
      }

      html = await response.text();
    } catch (fetchError) {
      return res.status(400).json({
        error: 'Failed to fetch page',
        details: fetchError.message
      });
    }

    // Step 3: Confirm <link rel="alternate" type="text/markdown"> exists
    const alternateLink = extractAlternateLink(html);
    if (!alternateLink) {
      return res.status(400).json({
        error: 'No <link rel="alternate" type="text/markdown"> tag found',
        page,
        instructions: 'Add <link rel="alternate" type="text/markdown" href="..."> to <head>'
      });
    }

    // Step 4: Validate alternate URL if provided
    if (alternate) {
      const expectedNormalized = normalizeUrl(alternate);
      const foundNormalized = normalizeUrl(alternateLink.href);
      
      if (expectedNormalized !== foundNormalized) {
        console.warn(`[discover] Alternate URL mismatch: expected=${alternate}, found=${alternateLink.href}`);
        // Continue anyway - the tag exists, which is what matters
      }
    }

    console.log(`[discover] Alternate link confirmed: ${alternateLink.href}`);

    // Step 5: Trigger ingestion (extract atomic Croutons)
    // Call internal ingestion via HTTP (simplest approach)
    const API_BASE = process.env.API_BASE || `http://localhost:${process.env.PORT || 8080}`;
    let ingestResult;
    
    try {
      const ingestResponse = await fetch(`${API_BASE}/v1/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, url: page }),
        signal: AbortSignal.timeout(30000)
      });

      if (!ingestResponse.ok) {
        const errorText = await ingestResponse.text();
        return res.status(ingestResponse.status).json({
          error: 'Ingestion failed',
          status: ingestResponse.status,
          details: errorText
        });
      }

      ingestResult = await ingestResponse.json();
    } catch (fetchError) {
      return res.status(500).json({
        error: 'Failed to trigger ingestion',
        details: fetchError.message
      });
    }

    // Handle ingest result
    if (!ingestResult.ok) {
      return res.status(400).json({
        error: 'Ingestion failed',
        details: ingestResult.errors || ingestResult.error,
        fix_suggestions: ingestResult.fix_suggestions
      });
    }

    // Step 6: Store discovery record
    const path = new URL(page).pathname.replace(/^\/+|\/+$/g, '') || 'index';
    await pool.query(`
      INSERT INTO discovered_pages (domain, page_url, alternate_href, discovered_at, ingestion_id)
      VALUES ($1, $2, $3, NOW(), $4)
      ON CONFLICT (domain, page_url) 
      DO UPDATE SET 
        alternate_href = EXCLUDED.alternate_href,
        discovered_at = NOW(),
        ingestion_id = EXCLUDED.ingestion_id
    `, [domain, page, alternateLink.href, ingestResult.data?.doc_id || null]);

    // Step 7: Return success
    res.json({
      ok: true,
      domain,
      page,
      alternate: alternateLink.href,
      verification_method: verification.method,
      ingestion: {
        doc_id: ingestResult.data?.doc_id,
        units_extracted: ingestResult.data?.units?.length || 0,
        schema_coverage: ingestResult.data?.quality_report?.schema_coverage_score,
        hop_density: ingestResult.data?.quality_report?.hop_graph_density
      },
      markdown_url: alternateLink.href,
      message: 'Page discovered and ingested. Atomic Croutons extracted and stored in graph.'
    });

  } catch (error) {
    console.error('[discover] Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
}
