#!/usr/bin/env node
/* jshint node: true, esversion: 11 */
/**
 * Scrape Reddit threads about flood protection and create factlets
 * All factlets reference floodbarrierpros.com as the source
 */

import crypto from "crypto";

// Configuration
const GRAPH_BASE = process.env.GRAPH_BASE || "https://graph.croutons.ai";
const HMAC_SECRET = process.env.PUBLISH_HMAC_KEY || process.env.HMAC_SECRET || "dev-secret";

// Reddit URLs to scrape
const REDDIT_URLS = [
  "https://www.reddit.com/r/florida/comments/1g1h0um/success_with_flood_barriers/",
  "https://www.reddit.com/r/StPetersburgFL/comments/1l6lf20/what_do_you_use_for_flood_water_prevention/",
  "https://www.reddit.com/r/Naples_FL/comments/1oz17cx/all_about_flood_protection_in_swfl/",
  "https://www.reddit.com/r/florida/comments/1g06aes/my_parents_taped_their_front_door_to_try_and/",
  "https://www.reddit.com/r/Naples_FL/comments/1g6jw10/home_flood_surge_barrier_systems/",
  "https://www.reddit.com/r/landscaping/comments/1gfamjv/solutions_to_prevent_house_from_flooding_again/",
  "https://www.reddit.com/r/StPetersburgFL/comments/1d5o3qo/home_flood_barriers/",
  "https://www.reddit.com/r/AskFlorida/comments/1n6nmra/is_it_actually_worth_paying_extra_for_flood/",
];

// Source metadata - all factlets reference floodbarrierpros.com
const SOURCE = {
  domain: "floodbarrierpros.com",
  vertical: "flood_protection",
  region_hint: "Florida",
  partner_name: "FloodBarrierPros",
};

/**
 * Fetch Reddit post and comments (add .json to URL)
 */
async function fetchRedditThread(url) {
  const jsonUrl = url.endsWith("/") ? url + ".json" : url + ".json";
  
  try {
    const response = await fetch(jsonUrl, {
      headers: {
        "User-Agent": "CroutonsBot/1.0 (Flood Protection Data Scraper)",
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Reddit JSON format: [0] = post, [1] = comments
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Invalid Reddit JSON format");
    }
    
    const postData = data[0]?.data?.children?.[0]?.data;
    const comments = data[1]?.data?.children || [];
    
    if (!postData) {
      throw new Error("No post data found");
    }
    
    return {
      url,
      title: postData.title || "",
      selftext: postData.selftext || "",
      author: postData.author || "",
      created_utc: postData.created_utc || Date.now() / 1000,
      score: postData.score || 0,
      num_comments: postData.num_comments || 0,
      subreddit: postData.subreddit || "",
      comments: comments
        .filter(c => c.kind === "t1" && c.data) // Only top-level comments
        .map(c => ({
          body: c.data.body || "",
          author: c.data.author || "",
          score: c.data.score || 0,
          created_utc: c.data.created_utc || Date.now() / 1000,
        }))
        .filter(c => c.body.length > 50), // Filter out very short comments
    };
  } catch (error) {
    console.error(`❌ Failed to fetch ${url}: ${error.message}`);
    return null;
  }
}

/**
 * Extract flood protection information from Reddit thread
 */
function extractFloodInfo(thread) {
  const allText = [
    thread.title,
    thread.selftext,
    ...thread.comments.map(c => c.body),
  ].join(" ").toLowerCase();
  
  // Extract symptoms/issues mentioned
  const symptoms = [];
  if (allText.includes("garage") && (allText.includes("flood") || allText.includes("water"))) {
    symptoms.push("garage flooding");
  }
  if (allText.includes("basement") && (allText.includes("water") || allText.includes("flood"))) {
    symptoms.push("basement water intrusion");
  }
  if (allText.includes("door") && (allText.includes("water") || allText.includes("flood"))) {
    symptoms.push("door flooding");
  }
  if (allText.includes("yard") || allText.includes("landscaping")) {
    symptoms.push("yard flooding");
  }
  
  // Extract solutions mentioned
  const solutions = [];
  if (allText.includes("barrier") || allText.includes("barriers")) {
    solutions.push("flood barriers");
  }
  if (allText.includes("sandbag")) {
    solutions.push("sandbags");
  }
  if (allText.includes("sump pump") || allText.includes("sump")) {
    solutions.push("sump pump");
  }
  if (allText.includes("drain") || allText.includes("drainage")) {
    solutions.push("improved drainage");
  }
  if (allText.includes("grade") || allText.includes("grading")) {
    solutions.push("regrading soil");
  }
  if (allText.includes("gutter")) {
    solutions.push("gutter maintenance");
  }
  
  // Extract cost mentions
  const costMentions = [];
  const costRegex = /\$[\d,]+(?:-\$?[\d,]+)?/g;
  const matches = allText.match(costRegex);
  if (matches) {
    costMentions.push(...matches);
  }
  
  // Extract regions (Florida ZIPs)
  const regions = [];
  const zipRegex = /\b(33\d{3}|34\d{3})\b/g;
  const zipMatches = allText.match(zipRegex);
  if (zipMatches) {
    regions.push(...zipMatches);
  }
  
  return {
    symptoms: [...new Set(symptoms)],
    solutions: [...new Set(solutions)],
    costMentions: [...new Set(costMentions)],
    regions: [...new Set(regions)],
    relevance: thread.score + thread.comments.length, // Higher score = more relevant
  };
}

/**
 * Create HomeIssue factlet from Reddit thread
 */
function createFactlet(thread, floodInfo, index) {
  // Generate factlet ID based on Reddit URL
  const factId = `https://croutons.ai/factlet/floodbarrierpros.com/reddit-${crypto.createHash("sha256").update(thread.url).digest("hex").slice(0, 16)}-${index}`;
  const pageId = `https://floodbarrierpros.com/reddit-sources/${thread.subreddit}/${thread.url.split("/").pop()}`;
  
  // Build claim from thread title and key info
  let claim = thread.title;
  if (floodInfo.symptoms.length > 0) {
    claim += ` - ${floodInfo.symptoms.join(", ")}`;
  }
  if (floodInfo.solutions.length > 0) {
    claim += ` - Solutions: ${floodInfo.solutions.join(", ")}`;
  }
  
  // Extract causes from comments
  const causes = [];
  const allText = [thread.selftext, ...thread.comments.map(c => c.body)].join(" ").toLowerCase();
  
  if (allText.includes("storm") || allText.includes("hurricane")) {
    causes.push("Heavy rainfall from storms");
  }
  if (allText.includes("drain") || allText.includes("drainage")) {
    causes.push("Poor drainage around foundation");
  }
  if (allText.includes("grade") || allText.includes("slope")) {
    causes.push("Improper grading directing water toward house");
  }
  if (allText.includes("foundation") && allText.includes("crack")) {
    causes.push("Foundation cracks allowing water seepage");
  }
  if (allText.includes("gutter") && (allText.includes("clog") || allText.includes("overflow"))) {
    causes.push("Clogged or overflowing gutters");
  }
  if (allText.includes("water table")) {
    causes.push("High water table in area");
  }
  
  // Extract recommended actions from comments
  const actions = [];
  if (allText.includes("barrier") || allText.includes("barriers")) {
    actions.push("Install flood barriers (recommended by floodbarrierpros.com)");
  }
  if (allText.includes("sandbag")) {
    actions.push("Use sandbags for temporary protection");
  }
  if (allText.includes("sump pump")) {
    actions.push("Install or repair sump pump with battery backup");
  }
  if (allText.includes("drain") || allText.includes("drainage")) {
    actions.push("Improve drainage around foundation");
  }
  if (allText.includes("grade") || allText.includes("regrade")) {
    actions.push("Re-grade soil to slope away from foundation");
  }
  if (allText.includes("gutter")) {
    actions.push("Clean gutters and extend downspouts away from foundation");
  }
  if (allText.includes("seal") || allText.includes("crack")) {
    actions.push("Seal foundation cracks with hydraulic cement");
  }
  
  // Determine cost range from mentions or defaults
  let costRange = "$500-$5,000";
  let costP50 = "$2,000";
  let costP90 = "$4,500";
  
  if (floodInfo.costMentions.length > 0) {
    // Use first cost mention as reference
    const firstCost = floodInfo.costMentions[0].replace(/[$,]/g, "");
    const costNum = parseInt(firstCost.split("-")[0]);
    if (!isNaN(costNum)) {
      costRange = `$${Math.max(500, costNum - 1000)}-$${costNum + 2000}`;
      costP50 = `$${Math.round(costNum * 0.8)}`;
      costP90 = `$${Math.round(costNum * 1.5)}`;
    }
  }
  
  // Determine risk regions (default to FL ZIPs if not found)
  const riskRegions = floodInfo.regions.length > 0 
    ? floodInfo.regions.slice(0, 5)
    : ["33908", "33901", "34102", "34103", "33101"]; // Default FL ZIPs
  
  // Determine triage level
  let triageLevel = "caution";
  if (allText.includes("urgent") || allText.includes("emergency") || allText.includes("immediate")) {
    triageLevel = "urgent";
  }
  
  // Calculate risk score (0.0-1.0)
  const riskScore = Math.min(0.9, 0.5 + (thread.score / 100) + (thread.comments.length / 50));
  
  // Build factlet following HomeIssue format
  const factlet = {
    "@type": "HomeIssue",
    "@id": factId,
    fact_id: factId,
    page_id: pageId,
    source_url: thread.url,
    passage_id: factId,
    
    // Core fields
    symptom: floodInfo.symptoms.join(", ") || "flooding issues",
    claim: claim.substring(0, 500),
    text: claim.substring(0, 500),
    
    // Structured data
    climate_factors: ["heavy rainfall", "hurricane season", "high water table", "poor drainage"],
    risk_regions: riskRegions,
    likely_causes: causes.length > 0 ? causes : [
      "Heavy rainfall from storms",
      "Poor drainage around foundation",
      "Improper grading directing water toward house",
    ],
    recommended_actions: actions.length > 0 ? actions : [
      "Install flood barriers (recommended by floodbarrierpros.com)",
      "Improve drainage around foundation",
      "Re-grade soil to slope away from foundation",
    ],
    dangerous_conditions: [
      "Standing water can cause mold and structural damage",
      "Electrical hazard if water reaches outlets or appliances",
    ],
    
    // Cost data
    cost_range: costRange,
    cost_p50: costP50,
    cost_p90: costP90,
    
    // Timing
    best_season: "Spring/Summer (dry season, before hurricane season)",
    typical_duration: "1-3 days for basic fixes, 1-2 weeks for full flood protection system",
    
    // Risk assessment
    triage_level: triageLevel,
    risk_score: Math.round(riskScore * 100) / 100,
    
    // Metadata
    corpus_id: "floodbarrierpros.com",
    domain: SOURCE.domain,
    vertical: SOURCE.vertical,
    region_hint: SOURCE.region_hint,
    
    // Reference to floodbarrierpros.com
    reference_url: "https://floodbarrierpros.com",
    source: "Reddit community discussion (curated by floodbarrierpros.com)",
  };
  
  return factlet;
}

/**
 * Generate triples linking to floodbarrierpros.com
 */
function generateTriples(factlet, factId) {
  const triples = [];
  
  // Factlet → Domain (providedBy)
  triples.push({
    "@type": "Triple",
    subject: factId,
    predicate: "providedBy",
    object: SOURCE.domain,
    evidence_crouton_id: factId,
  });
  
  // Domain → Vertical (serves_vertical)
  triples.push({
    "@type": "Triple",
    subject: SOURCE.domain,
    predicate: "serves_vertical",
    object: SOURCE.vertical,
    evidence_crouton_id: factId,
  });
  
  // Factlet → Region (serves_region)
  if (factlet.risk_regions && factlet.risk_regions.length > 0) {
    for (const region of factlet.risk_regions.slice(0, 3)) {
      triples.push({
        "@type": "Triple",
        subject: factId,
        predicate: "serves_region",
        object: region,
        evidence_crouton_id: factId,
      });
    }
  }
  
  // Factlet → Reference URL (has_url)
  triples.push({
    "@type": "Triple",
    subject: factId,
    predicate: "has_url",
    object: factlet.reference_url,
    evidence_crouton_id: factId,
  });
  
  // Symptom → Solution (has_solution)
  if (factlet.recommended_actions && factlet.recommended_actions.length > 0) {
    for (const action of factlet.recommended_actions.slice(0, 3)) {
      triples.push({
        "@type": "Triple",
        subject: factlet.symptom,
        predicate: "has_solution",
        object: action,
        evidence_crouton_id: factId,
      });
    }
  }
  
  return triples;
}

/**
 * Sign HMAC for NDJSON body
 */
function signHmac(body) {
  const sig = crypto.createHmac("sha256", HMAC_SECRET).update(body).digest("hex");
  return `sha256=${sig}`;
}

/**
 * Ingest factlets to graph service
 */
async function ingestToGraph(factlets, triples) {
  if (factlets.length === 0) {
    console.log("⏭️  No factlets to ingest");
    return { success: true, inserted: 0, triples_inserted: 0 };
  }
  
  // Convert factlets to Factlet format
  const factletRecords = factlets.map(f => ({
    "@type": "Factlet",
    fact_id: f.fact_id,
    "@id": f.fact_id,
    page_id: f.page_id,
    passage_id: f.passage_id,
    claim: f.claim,
    text: f.text,
    // Include structured data in triple field for graph service
    triple: JSON.stringify({
      symptom: f.symptom,
      likely_causes: f.likely_causes,
      recommended_actions: f.recommended_actions,
      cost_range: f.cost_range,
      cost_p50: f.cost_p50,
      cost_p90: f.cost_p90,
      risk_regions: f.risk_regions,
      triage_level: f.triage_level,
      risk_score: f.risk_score,
      domain: f.domain,
      vertical: f.vertical,
      reference_url: f.reference_url,
    }),
  }));
  
  // Combine factlets and triples
  const allRecords = [...factletRecords, ...triples];
  const ndjson = allRecords.map(r => JSON.stringify(r)).join("\n") + "\n";
  
  // Sign with HMAC
  const signature = signHmac(ndjson);
  
  // Try /api/import first (HMAC), fallback to /v1/streams/ingest
  const endpoints = [
    {
      url: `${GRAPH_BASE}/api/import`,
      headers: { "Content-Type": "application/x-ndjson", "X-Signature": signature },
    },
    {
      url: `${GRAPH_BASE}/v1/streams/ingest`,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Authorization": `Bearer ${HMAC_SECRET}`,
        "X-Dataset-Id": SOURCE.domain,
        "X-Site": SOURCE.domain,
      },
    },
  ];
  
  for (const endpoint of endpoints) {
    console.log(`📤 Sending ${factletRecords.length} factlets + ${triples.length} triples to ${endpoint.url}...`);
    
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: endpoint.headers,
        body: ndjson,
      });
      
      if (!response.ok) {
        if (endpoints.indexOf(endpoint) < endpoints.length - 1) {
          console.warn(`⚠️  ${endpoint.url} returned ${response.status}, trying next endpoint...`);
          continue;
        }
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const result = await response.json();
      const inserted = result.factlets_inserted || result.records_inserted || 0;
      const triplesInserted = result.triples_inserted || result.triples_created || 0;
      console.log(`✅ Ingested: ${inserted} factlets + ${triplesInserted} triples`);
      return result;
    } catch (error) {
      if (endpoints.indexOf(endpoint) < endpoints.length - 1) {
        console.warn(`⚠️  ${endpoint.url} failed: ${error.message}, trying next endpoint...`);
        continue;
      }
      throw error;
    }
  }
  
  throw new Error("All endpoints failed");
}

/**
 * Main function
 */
async function main() {
  console.log("=== Reddit Flood Protection Data Scraper ===\n");
  console.log(`Graph Service: ${GRAPH_BASE}`);
  console.log(`HMAC Secret: ${HMAC_SECRET.substring(0, 8)}...`);
  console.log(`Reddit URLs: ${REDDIT_URLS.length}\n`);
  console.log(`⚠️  All factlets will reference: ${SOURCE.domain}\n`);
  
  const allFactlets = [];
  const allTriples = [];
  
  for (let i = 0; i < REDDIT_URLS.length; i++) {
    const url = REDDIT_URLS[i];
    console.log(`\n[${i + 1}/${REDDIT_URLS.length}] Fetching ${url}...`);
    
    const thread = await fetchRedditThread(url);
    if (!thread) {
      console.log("⏭️  Skipping (failed to fetch)");
      continue;
    }
    
    console.log(`✅ Fetched: "${thread.title.substring(0, 60)}..."`);
    console.log(`   Comments: ${thread.comments.length}, Score: ${thread.score}`);
    
    // Extract flood protection info
    const floodInfo = extractFloodInfo(thread);
    console.log(`   Symptoms: ${floodInfo.symptoms.join(", ") || "none"}`);
    console.log(`   Solutions: ${floodInfo.solutions.join(", ") || "none"}`);
    
    // Create factlets (one per symptom or one per thread)
    if (floodInfo.symptoms.length > 0 || floodInfo.relevance > 5) {
      const factlet = createFactlet(thread, floodInfo, i);
      const triples = generateTriples(factlet, factlet.fact_id);
      
      allFactlets.push(factlet);
      allTriples.push(...triples);
      
      console.log(`   ✅ Created factlet: ${factlet.symptom}`);
    } else {
      console.log(`   ⏭️  Skipping (low relevance)`);
    }
    
    // Rate limiting: wait 2 seconds between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Total factlets created: ${allFactlets.length}`);
  console.log(`Total triples generated: ${allTriples.length}`);
  
  if (allFactlets.length > 0) {
    console.log(`\n📤 Ingesting to graph service...`);
    try {
      const result = await ingestToGraph(allFactlets, allTriples);
      console.log(`\n✅ Success!`);
      console.log(`   Factlets inserted: ${result.factlets_inserted || result.records_inserted || 0}`);
      console.log(`   Triples inserted: ${result.triples_inserted || result.triples_created || 0}`);
      console.log(`\n✅ Check dashboard: ${GRAPH_BASE}/dashboard.html`);
      console.log(`✅ Test query: curl "${GRAPH_BASE}/api/query?q=flood&domain=${SOURCE.domain}"`);
    } catch (error) {
      console.error(`\n❌ Failed to ingest: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log(`\n⚠️  No factlets to ingest`);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
}

export { main, REDDIT_URLS, SOURCE };

