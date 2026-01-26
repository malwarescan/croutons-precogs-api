#!/usr/bin/env node
/* jshint node: true, esversion: 11 */
/**
 * Ingest Home Domain NDJSON Sources into Croutons Graph
 * 
 * Ingests NDJSON feeds from partner sites (ourcasa.ai, floodbarrierpros.com)
 * into the Croutons graph service for home precogs to query.
 */

import { processNDJSONSource } from "../src/ndjsonIngestion.js";
import crypto from "crypto";

// Configuration
const GRAPH_BASE = process.env.GRAPH_BASE || "https://graph.croutons.ai";
const HMAC_SECRET = process.env.PUBLISH_HMAC_KEY || process.env.HMAC_SECRET || "dev-secret";

// NDJSON Sources for home domain
const HOME_SOURCES = [
  {
    id: "ourcasa-001",
    partner_name: "OurCasa",
    domain: "ourcasa.ai",
    ndjson_url: "https://ourcasa.ai/sitemaps/sitemap-ai.ndjson",
    vertical: "home_services",
    region_hint: null, // Multi-region
  },
  {
    id: "floodbarrierpros-001",
    partner_name: "FloodBarrierPros",
    domain: "floodbarrierpros.com",
    ndjson_url: "https://floodbarrierpros.com/sitemaps/sitemap-ai.ndjson",
    vertical: "flood_protection",
    region_hint: "Naples, FL", // Primary region
  },
];

/**
 * Sign HMAC for NDJSON body
 */
function signHmac(body) {
  const sig = crypto.createHmac("sha256", HMAC_SECRET).update(body).digest("hex");
  return `sha256=${sig}`;
}

/**
 * Generate triples from home domain factlet
 */
function generateTriples(factlet, factId, source) {
  const triples = [];
  
  // Page → Domain (providedBy)
  if (source && source.domain && factId) {
    triples.push({
      "@type": "Triple",
      subject: factId,
      predicate: "providedBy",
      object: source.domain,
      evidence_crouton_id: factId
    });
  }
  
  // Domain → Vertical (serves_vertical)
  if (source && source.domain && source.vertical) {
    triples.push({
      "@type": "Triple",
      subject: source.domain,
      predicate: "serves_vertical",
      object: source.vertical,
      evidence_crouton_id: factId
    });
  }
  
  // Page → Region (serves_region) if region_hint exists
  if (source && source.region_hint && factId) {
    triples.push({
      "@type": "Triple",
      subject: factId,
      predicate: "serves_region",
      object: source.region_hint,
      evidence_crouton_id: factId
    });
  }
  
  // Page → URL (has_url) if @id is a URL
  if (factlet["@id"] && factlet["@id"].startsWith("http")) {
    triples.push({
      "@type": "Triple",
      subject: factId,
      predicate: "has_url",
      object: factlet["@id"],
      evidence_crouton_id: factId
    });
  }
  
  return triples;
}

/**
 * Ingest factlets to graph service via /api/import
 */
async function ingestToGraph(factlets, sourceName, source = null) {
  if (factlets.length === 0) {
    console.log(`⏭️  Skipping ${sourceName} (no factlets)`);
    return { success: true, inserted: 0, triples_inserted: 0 };
  }

  // Convert to Factlet format for graph service
  // /v1/streams/ingest requires: @type="Factlet", fact_id, claim (or text)
  const factletRecords = factlets.map(f => {
    const factId = f["@id"] || f.fact_id;
    const pageId = f.page_id || f.source_url || factId || "unknown";
    let claim = f.claim || f.text || f.summary || f.headline || "";
    
    // Ensure claim is not empty (required by endpoint)
    if (!claim || claim.trim().length === 0) {
      claim = f.name || f.title || `Home service data: ${f["@type"] || "unknown"}`;
    }
    
    // If still empty, use a fallback
    if (!claim || claim.trim().length === 0) {
      claim = JSON.stringify(f).substring(0, 200);
    }
    
    return {
      "@type": "Factlet",
      fact_id: factId,
      "@id": factId,
      page_id: pageId,
      passage_id: f.passage_id || factId,
      claim: claim.trim(),
      text: claim.trim(),
    };
  }).filter(f => f.fact_id && f.claim && f.claim.trim().length > 0); // Filter out invalid records

  // Generate triples from factlets
  const allTriples = [];
  const domainTriples = new Set(); // Track domain-level triples to avoid duplicates
  
  for (let i = 0; i < factlets.length; i++) {
    const factlet = factlets[i];
    const factId = factlet["@id"] || factlet.fact_id;
    if (!factId) continue;
    
    const recordTriples = generateTriples(factlet, factId, source);
    
    // Add page-level triples
    allTriples.push(...recordTriples.filter(t => t.predicate !== "serves_vertical"));
    
    // Add domain-level triples only once
    const domainTriple = recordTriples.find(t => t.predicate === "serves_vertical");
    if (domainTriple) {
      const key = `${domainTriple.subject}-${domainTriple.predicate}-${domainTriple.object}`;
      if (!domainTriples.has(key)) {
        domainTriples.add(key);
        allTriples.push(domainTriple);
      }
    }
  }

  // Combine factlets and triples into single NDJSON
  const allRecords = [...factletRecords, ...allTriples];
  const ndjson = allRecords.map(r => JSON.stringify(r)).join("\n") + "\n";

  // Sign with HMAC
  const signature = signHmac(ndjson);

  // Try /api/import first (HMAC), fallback to /v1/streams/ingest (Bearer)
  const endpoints = [
    { 
      url: `${GRAPH_BASE}/api/import`, 
      headers: { "Content-Type": "application/x-ndjson", "X-Signature": signature } 
    },
    { 
      url: `${GRAPH_BASE}/v1/streams/ingest`, 
      headers: { 
        "Content-Type": "application/x-ndjson", 
        "Authorization": `Bearer ${HMAC_SECRET}`,
        "X-Dataset-Id": (source && source.domain) || "home_services",
        "X-Site": (source && source.domain) || "external",
      } 
    },
  ];
  
  for (const endpoint of endpoints) {
    console.log(`📤 Sending ${factletRecords.length} factlets + ${allTriples.length} triples to ${endpoint.url}...`);
    
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: endpoint.headers,
        body: ndjson,
      });

      if (!response.ok) {
        if (endpoints.indexOf(endpoint) < endpoints.length - 1) {
          console.warn(`⚠️  ${endpoint.url} returned ${response.status}, trying next endpoint...`);
          continue; // Try next endpoint
        }
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      const inserted = result.factlets_inserted || result.records_inserted || 0;
      const triplesInserted = result.triples_inserted || result.triples_created || 0;
      console.log(`✅ ${sourceName}: ${inserted} factlets + ${triplesInserted} triples inserted`);
      console.log(`   Response: ${JSON.stringify(result).substring(0, 200)}`);
      if (inserted === 0 && factletRecords.length > 0) {
        console.warn(`⚠️  WARNING: Sent ${factletRecords.length} records but 0 were inserted!`);
        console.warn(`   This might indicate a format issue. Check graph service logs.`);
        console.warn(`   Sample record: ${JSON.stringify(factletRecords[0]).substring(0, 200)}`);
      }
      return result;
    } catch (error) {
      if (endpoints.indexOf(endpoint) < endpoints.length - 1) {
        console.warn(`⚠️  ${endpoint.url} failed: ${error.message}, trying next endpoint...`);
        continue; // Try next endpoint
      }
      console.error(`❌ Failed to ingest ${sourceName}: ${error.message}`);
      throw error;
    }
  }
  
  // If we get here, all endpoints failed
  throw new Error(`All endpoints failed for ${sourceName}`);
}

/**
 * Main ingestion function
 */
async function main() {
  console.log("=== Home Domain NDJSON Ingestion ===\n");
  console.log(`Graph Service: ${GRAPH_BASE}`);
  console.log(`HMAC Secret: ${HMAC_SECRET.substring(0, 8)}...`);
  console.log(`Sources: ${HOME_SOURCES.length}\n`);

  let totalInserted = 0;
  let totalTriples = 0;
  let totalProcessed = 0;

  for (const source of HOME_SOURCES) {
    console.log(`\n📂 Processing ${source.partner_name} (${source.domain})...`);

    try {
      // Process NDJSON source (fetches, validates, normalizes)
      const result = await processNDJSONSource(source);

      if (!result.success) {
        console.error(`❌ Failed to process ${source.partner_name}: ${result.error}`);
        continue;
      }

      console.log(`✅ Processed ${result.results.total} records`);
      console.log(`   Successful: ${result.results.successful}`);
      console.log(`   Failed: ${result.results.failed}`);

      totalProcessed += result.results.total;

      // Note: processNDJSONSource currently just logs (upsertFactlet is a TODO)
      // So we need to actually ingest to graph here
      // For now, we'll fetch the NDJSON and ingest directly
      console.log(`\n📥 Fetching NDJSON from ${source.ndjson_url}...`);

      const { fetchNDJSON } = await import("../src/ndjsonIngestion.js");
      const rawFactlets = await fetchNDJSON(source.ndjson_url);

      // Normalize factlets
      const { normalizeFactlet } = await import("../src/ndjsonIngestion.js");
      const normalizedFactlets = rawFactlets.map(f => normalizeFactlet(f, {
        domain: source.domain,
        vertical: source.vertical,
        region_hint: source.region_hint,
        ndjson_url: source.ndjson_url,
      }));

      // Ingest to graph (with triples)
      const ingestResult = await ingestToGraph(normalizedFactlets, source.partner_name, source);
      totalInserted += (ingestResult.factlets_inserted || ingestResult.records_inserted || 0);
      totalTriples += (ingestResult.triples_inserted || ingestResult.triples_created || 0);

      // Small delay between sources
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ Failed to ingest ${source.partner_name}: ${error.message}`);
      // Continue with other sources
    }
  }

  console.log("\n=== Ingestion Complete ===");
  console.log(`Total processed: ${totalProcessed} records`);
  console.log(`Total inserted: ${totalInserted} factlets`);
  console.log(`Total triples generated: ${totalTriples}`);
  console.log(`\n✅ Check dashboard: ${GRAPH_BASE}/dashboard.html`);
  console.log(`\n✅ Test query:`);
  console.log(`   curl "${GRAPH_BASE}/api/triples?domain=ourcasa.ai&limit=10"`);
  console.log(`   curl "${GRAPH_BASE}/api/triples?domain=floodbarrierpros.com&limit=10"`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
}

export { main, HOME_SOURCES };

