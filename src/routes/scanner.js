// src/routes/scanner.js
// Scheduled scanner for verified partner domains (safety net)
// Scans only verified domains, only known pages or sitemap URLs
// Low frequency (daily/weekly) - not a crawler, just verification sweep

import { pool } from '../db.js';
import { parse } from 'node-html-parser';
import dns from 'dns/promises';

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
    return null;
  }
}

/**
 * Verify domain ownership (quick check)
 */
async function isDomainVerified(domain) {
  const verified = await pool.query(
    'SELECT verified_at FROM verified_domains WHERE domain = $1 AND verified_at IS NOT NULL',
    [domain]
  );
  return verified.rows.length > 0;
}

/**
 * Get URLs to scan for a domain
 * Returns: previously discovered pages + homepage
 */
async function getUrlsToScan(domain) {
  const urls = new Set();
  
  // Add homepage
  urls.add(`https://${domain}`);
  urls.add(`https://${domain}/`);
  
  // Add previously discovered pages
  const discovered = await pool.query(
    'SELECT page_url FROM discovered_pages WHERE domain = $1 AND is_active = true',
    [domain]
  );
  
  for (const row of discovered.rows) {
    urls.add(row.page_url);
  }
  
  // TODO: Add sitemap URLs if sitemap exists
  // For now, just use discovered pages
  
  return Array.from(urls);
}

/**
 * Scan a single URL for alternate link
 */
async function scanUrl(domain, url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Croutons-Scanner/1.0' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return { found: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    const alternateLink = extractAlternateLink(html);

    if (!alternateLink) {
      return { found: false };
    }

    return {
      found: true,
      alternate: alternateLink.href,
      url
    };
  } catch (error) {
    return { found: false, error: error.message };
  }
}

/**
 * POST /v1/scanner/run - Manual trigger for scheduled scanner
 * GET /v1/scanner/run - Same, for cron jobs
 */
export async function runScanner(req, res) {
  try {
    console.log('[scanner] Starting scheduled scan...');

    // Get all verified domains
    const verifiedDomains = await pool.query(
      'SELECT domain FROM verified_domains WHERE verified_at IS NOT NULL'
    );

    if (verifiedDomains.rows.length === 0) {
      return res.json({
        ok: true,
        message: 'No verified domains to scan',
        scanned: 0,
        discovered: 0
      });
    }

    const results = {
      domains_scanned: 0,
      urls_scanned: 0,
      new_discoveries: 0,
      updated_discoveries: 0,
      errors: []
    };

    // Scan each verified domain
    for (const row of verifiedDomains.rows) {
      const domain = row.domain;
      
      if (!(await isDomainVerified(domain))) {
        continue; // Skip if verification expired
      }

      results.domains_scanned++;
      console.log(`[scanner] Scanning domain: ${domain}`);

      // Get URLs to scan
      const urlsToScan = await getUrlsToScan(domain);
      
      for (const url of urlsToScan) {
        results.urls_scanned++;
        
        const scanResult = await scanUrl(domain, url);
        
        if (scanResult.found) {
          // Check if already discovered
          const existing = await pool.query(
            'SELECT id FROM discovered_pages WHERE domain = $1 AND page_url = $2',
            [domain, url]
          );

          if (existing.rows.length === 0) {
            // New discovery - trigger ingestion
            results.new_discoveries++;
            console.log(`[scanner] New discovery: ${domain} -> ${url}`);
            
            // Trigger discovery webhook internally
            try {
              const API_BASE = process.env.API_BASE || `http://localhost:${process.env.PORT || 8080}`;
              await fetch(`${API_BASE}/v1/discover`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain, page: url, alternate: scanResult.alternate }),
                signal: AbortSignal.timeout(30000)
              });
            } catch (discoverError) {
              console.error(`[scanner] Failed to trigger discovery for ${url}:`, discoverError.message);
              results.errors.push({ url, error: discoverError.message });
            }
          } else {
            // Update last_scanned_at
            await pool.query(
              'UPDATE discovered_pages SET last_scanned_at = NOW() WHERE domain = $1 AND page_url = $2',
              [domain, url]
            );
            results.updated_discoveries++;
          }
        } else if (scanResult.error) {
          results.errors.push({ url, error: scanResult.error });
        }

        // Small delay between URLs
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Delay between domains
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('[scanner] Scan complete:', results);

    res.json({
      ok: true,
      ...results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[scanner] Error:', error);
    res.status(500).json({
      error: 'Scanner failed',
      message: error.message
    });
  }
}
