#!/usr/bin/env node
/* jshint node: true, esversion: 11 */
/**
 * Test graph query for FloodBarrierPros factlets
 * Verifies that byDomain() returns data
 */

const GRAPH_BASE = process.env.GRAPH_BASE || "https://graph.croutons.ai";
const DOMAIN = "floodbarrierpros.com";

console.log("=== Testing Graph Query ===");
console.log(`Graph Base: ${GRAPH_BASE}`);
console.log(`Domain: ${DOMAIN}`);
console.log("");

try {
  const queryParams = new URLSearchParams({
    type: "Factlet",
    domain: DOMAIN,
  });

  const url = `${GRAPH_BASE}/api/triples?${queryParams.toString()}`;
  console.log(`Query URL: ${url}`);
  console.log("");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    console.error(`❌ Graph query failed: ${response.status} ${response.statusText}`);
    const text = await response.text();
    console.error(`   Response: ${text.substring(0, 200)}`);
    process.exit(1);
  }

  const data = await response.json();
  const factlets = data.triples || data.factlets || data.results || [];

  console.log(`✅ Graph query successful!`);
  console.log(`   Found ${factlets.length} factlets for domain: ${DOMAIN}`);
  console.log("");

  if (factlets.length > 0) {
    console.log("📋 Sample factlets (first 3):");
    factlets.slice(0, 3).forEach((factlet, i) => {
      console.log(`\n   ${i + 1}. ${factlet["@id"] || factlet.id || "unknown"}`);
      console.log(`      Type: ${factlet["@type"] || factlet.type || "unknown"}`);
      if (factlet.system) console.log(`      System: ${factlet.system}`);
      if (factlet.symptom) console.log(`      Symptom: ${factlet.symptom}`);
      if (factlet.cause) console.log(`      Cause: ${factlet.cause}`);
    });
  } else {
    console.log("⚠️  No factlets found. Make sure ingestion has run.");
  }
} catch (error) {
  console.error("❌ Error querying graph:", error.message);
  process.exit(1);
}




