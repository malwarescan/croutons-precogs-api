#!/usr/bin/env node
/* jshint node: true, esversion: 11 */
/**
 * One-time ingestion script for FloodBarrierPros NDJSON
 * Run this to ingest the first source for testing
 */

import { processNDJSONSource } from "../src/ndjsonIngestion.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const source = {
  id: "floodbarrierpros-001",
  partner_name: "FloodBarrierPros",
  domain: "floodbarrierpros.com",
  ndjson_url: "https://floodbarrierpros.com/sitemaps/sitemap-ai.ndjson",
  vertical: "flood_protection",
  region_hint: "33908,FL,Fort Myers",
  polling_interval: "15m",
  status: "active",
};

console.log("=== Ingesting FloodBarrierPros NDJSON ===");
console.log(`URL: ${source.ndjson_url}`);
console.log("");

try {
  const result = await processNDJSONSource(source);

  if (result.success) {
    console.log("✅ Ingestion successful!");
    console.log(`   Partner: ${result.partner_name}`);
    console.log(`   Total factlets: ${result.results.total}`);
    console.log(`   Successful: ${result.results.successful}`);
    console.log(`   Failed: ${result.results.failed}`);

    if (result.results.successful > 0) {
      console.log("");
      console.log("📋 Sample factlets (first 3):");
      // In production, these would come from the graph query
      // For now, we'll show what was processed
      console.log("   (Check graph for ingested factlets)");
    }

    if (result.results.errors.length > 0) {
      console.log("");
      console.log("⚠️  Errors:");
      result.results.errors.slice(0, 3).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.error}`);
      });
    }
  } else {
    console.error("❌ Ingestion failed:");
    console.error(`   Error: ${result.error}`);
    process.exit(1);
  }
} catch (error) {
  console.error("❌ Fatal error:", error.message);
  process.exit(1);
}




