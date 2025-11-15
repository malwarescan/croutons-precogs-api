/* jshint node: true, esversion: 11 */
/**
 * NDJSON Ingestion Worker
 * Fetches and normalizes NDJSON from partner sites into Croutons factlets
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Fetch and parse NDJSON from URL
 * @param {string} url - NDJSON URL
 * @returns {Promise<Array>} Array of parsed JSON objects
 */
export async function fetchNDJSON(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/x-ndjson, application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    const lines = text.trim().split("\n").filter((line) => line.trim());
    const parsed = [];

    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch (e) {
        console.warn(`[ingestion] Failed to parse line: ${e.message}`);
      }
    }

    return parsed;
  } catch (error) {
    throw new Error(`Failed to fetch NDJSON from ${url}: ${error.message}`);
  }
}

/**
 * Validate factlet against schema
 * @param {Object} factlet - Factlet to validate
 * @param {Object} schema - JSON Schema
 * @returns {Object} Validation result
 */
export function validateFactlet(factlet, schema) {
  // TODO: Implement JSON Schema validation using ajv
  // For now, basic validation
  if (!factlet["@type"]) {
    return { valid: false, error: "Missing @type field" };
  }
  if (!factlet["@id"]) {
    return { valid: false, error: "Missing @id field" };
  }
  return { valid: true };
}

/**
 * Normalize factlet with metadata
 * @param {Object} rawFactlet - Raw factlet from NDJSON
 * @param {Object} sourceMetadata - Source metadata (domain, vertical, region)
 * @returns {Object} Normalized factlet
 */
export function normalizeFactlet(rawFactlet, sourceMetadata) {
  const { domain, vertical, region_hint } = sourceMetadata;

  // Generate deterministic ID if missing
  const id = rawFactlet["@id"] || generateFactletId(rawFactlet, domain);

  return {
    ...rawFactlet,
    "@id": id,
    "@type": rawFactlet["@type"] || "Factlet",
    domain: domain,
    vertical: vertical || rawFactlet.vertical,
    region: region_hint || rawFactlet.region,
    ingested_at: new Date().toISOString(),
    source_url: sourceMetadata.ndjson_url,
  };
}

/**
 * Generate deterministic ID for factlet
 */
function generateFactletId(factlet, domain) {
  const hash = JSON.stringify(factlet);
  // Simple hash - in production, use crypto.createHash
  const hashValue = hash.split("").reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0) | 0;
  }, 0);
  return `https://croutons.ai/factlet/${domain}/${Math.abs(hashValue)}`;
}

/**
 * Upsert factlet into Croutons graph
 * @param {Object} factlet - Normalized factlet
 * @param {string} graphBase - Graph service base URL
 * @returns {Promise<Object>} Upsert result
 */
export async function upsertFactlet(factlet, graphBase = process.env.GRAPH_BASE || "https://graph.croutons.ai") {
  try {
    // TODO: Implement actual graph upsert
    // For now, log the factlet
    console.log(`[ingestion] Upserting factlet: ${factlet["@id"]}`);

    // In production, this would call the Croutons graph API
    // const response = await fetch(`${graphBase}/api/factlets`, {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify(factlet),
    // });
    // return await response.json();

    return { success: true, factlet_id: factlet["@id"] };
  } catch (error) {
    throw new Error(`Failed to upsert factlet: ${error.message}`);
  }
}

/**
 * Process NDJSON source ingestion
 * @param {Object} source - Source configuration
 * @returns {Promise<Object>} Ingestion result
 */
export async function processNDJSONSource(source) {
  const {
    id,
    partner_name,
    domain,
    ndjson_url,
    vertical,
    region_hint,
  } = source;

  console.log(`[ingestion] Processing source: ${partner_name} (${domain})`);

  try {
    // Fetch NDJSON
    const rawFactlets = await fetchNDJSON(ndjson_url);

    // Load validation schema
    const schemaPath = path.join(__dirname, "..", "kb", "home-foundation", "ndjson_home_factlet.schema.json");
    let schema = null;
    if (fs.existsSync(schemaPath)) {
      schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    }

    // Normalize and upsert each factlet
    const results = {
      total: rawFactlets.length,
      successful: 0,
      failed: 0,
      errors: [],
    };

    for (const rawFactlet of rawFactlets) {
      try {
        // Validate
        if (schema) {
          const validation = validateFactlet(rawFactlet, schema);
          if (!validation.valid) {
            results.failed++;
            results.errors.push({
              factlet: rawFactlet,
              error: validation.error,
            });
            continue;
          }
        }

        // Normalize
        const normalized = normalizeFactlet(rawFactlet, {
          domain,
          vertical,
          region_hint,
          ndjson_url,
        });

        // Upsert
        await upsertFactlet(normalized);

        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          factlet: rawFactlet,
          error: error.message,
        });
      }
    }

    return {
      success: true,
      source_id: id,
      partner_name,
      results,
    };
  } catch (error) {
    return {
      success: false,
      source_id: id,
      partner_name,
      error: error.message,
    };
  }
}




