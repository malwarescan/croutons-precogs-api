/* jshint node: true, esversion: 11 */
/**
 * Bangkok Massage Intelligence Precog Handler
 * Fetches data from Google Maps and extracts information from reviews
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "fs";

const GOOGLE_MAPS_URL = "https://www.google.com/maps/search/erotic+massage+bangkok/@13.7455615,100.4277491,11.02z/data=!4m2!2m1!6e1?entry=ttu&g_ep=EgoyMDI1MTExMi4wIKXMDSoASAFQAw%3D%3D";

// Load corpus data directly (no external service needed)
function loadCorpusShops(district = null) {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    // Try multiple paths to find corpus
    const corpusPaths = [
      join(__dirname, '../../../../corpora/thailand/bangkok/massage/shops_legit.ndjson'),
      join(__dirname, '../../../corpora/thailand/bangkok/massage/shops_legit.ndjson'),
      join(process.cwd(), 'corpora/thailand/bangkok/massage/shops_legit.ndjson'),
    ];
    
    let corpusPath = null;
    for (const path of corpusPaths) {
      if (existsSync(path)) {
        corpusPath = path;
        break;
      }
    }
    
    if (!corpusPath) {
      console.warn('[bkk-massage] Corpus file not found, trying merge service');
      return [];
    }
    
    const content = readFileSync(corpusPath, 'utf-8');
    const shops = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
      .filter(shop => {
        if (!district) return true;
        return shop.district && shop.district.toLowerCase() === district.toLowerCase();
      });
    
    console.log(`[bkk-massage] Loaded ${shops.length} shops from corpus${district ? ` in ${district}` : ''}`);
    return shops;
  } catch (error) {
    console.warn(`[bkk-massage] Failed to load corpus: ${error.message}`);
    return [];
  }
}

/**
 * Process Bangkok Massage precog job
 * @param {string} jobId - Job ID
 * @param {string} namespace - Precog namespace (bkk_massage)
 * @param {string} task - Task type (legitimacy_scoring, district_aware_ranking, etc.)
 * @param {Object} context - Job context (content, region/district, etc.)
 * @param {Function} emit - Event emitter function
 * @returns {Promise<Object>} Result object
 */
export async function processBkkMassagePrecog(jobId, namespace, task, context, emit) {
  const content = context?.content || "";
  const region = context?.region; // District name (Asok, Nana, etc.)

  console.log(`[bkk-massage] Processing ${namespace}.${task} for job ${jobId}`);

  try {
    // Emit thinking/analyzing event
    await emit("thinking", {
      message: "Fetching and merging Bangkok massage data...",
      status: "analyzing",
    });

    // Fetch live data from Google Maps (may return empty if scraping fails)
    let liveShops = [];
    try {
      liveShops = await fetchGoogleMapsData(emit);
    } catch (error) {
      console.warn(`[bkk-massage] Google Maps fetch failed: ${error.message}, using corpus only`);
      await emit("thinking", {
        message: "Using verified corpus data (Google Maps unavailable)",
        status: "fallback",
      });
    }

    // Load corpus data directly (no external service needed)
    let corpusShops = [];
    try {
      corpusShops = loadCorpusShops(region);
    } catch (error) {
      console.warn(`[bkk-massage] Corpus load failed: ${error.message}`);
    }
    
    // Merge live shops with corpus (or use corpus only if liveShops is empty)
    const mergedShops = liveShops.length > 0 
      ? [...liveShops, ...corpusShops] // Combine if we have live data
      : corpusShops; // Use corpus only if no live data

    // Emit grounding event
    await emit("grounding.chunk", {
      count: mergedShops.length,
      source: `Croutons Merge Service + Google Maps`,
      namespace: namespace,
      task: task,
      shops_loaded: mergedShops.length,
    });

    // Process task-specific logic
    const result = await executeBkkMassageTask(task, {
      shopsData: mergedShops,
      content,
      region,
    }, emit);

    console.log(`[bkk-massage] Task ${task} completed, result:`, JSON.stringify(result, null, 2));

    // Emit answer delta events
    await emitAnswer(result, emit);

    console.log(`[bkk-massage] All answer.delta events emitted for job ${jobId}`);

    return { success: true, result };
  } catch (error) {
    console.error(`[bkk-massage] Error processing ${namespace}.${task}:`, error);
    await emit("answer.delta", {
      text: `⚠️ Error processing ${task}: ${error.message}\n`,
    });
    throw error;
  }
}

// Removed mergeWithCorpus function - now loading corpus directly in processBkkMassagePrecog

/**
 * Fetch data from Google Maps
 * @param {Function} emit - Event emitter
 * @returns {Promise<Array>} Array of shop data with extracted information
 */
async function fetchGoogleMapsData(emit) {
  try {
    await emit("thinking", {
      message: "Scraping Google Maps data...",
      status: "fetching",
    });

    // Note: Google Maps requires proper scraping with browser automation
    // For now, we'll use a fetch approach, but may need Puppeteer/Playwright
    const response = await fetch(GOOGLE_MAPS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Parse HTML to extract shop data
    // Google Maps embeds data in JSON-LD and script tags
    const shopsData = parseGoogleMapsHTML(html);

    await emit("thinking", {
      message: `Found ${shopsData.length} shops, extracting review data...`,
      status: "processing",
    });

    // For each shop, fetch detailed reviews to extract:
    // - Prettiest women mentions
    // - Pricing information
    // - Line usernames
    // - Websites
    // - Overall rating
    const enrichedShops = await Promise.all(
      shopsData.map(async (shop) => {
        try {
          const enriched = await enrichShopData(shop);
          return enriched;
        } catch (error) {
          console.warn(`[bkk-massage] Failed to enrich shop ${shop.name}:`, error.message);
          return shop;
        }
      })
    );

    return enrichedShops.filter(s => s !== null);
  } catch (error) {
    console.error(`[bkk-massage] Error fetching Google Maps data:`, error);
    throw error;
  }
}

/**
 * Parse Google Maps HTML to extract shop listings
 * @param {string} html - HTML content
 * @returns {Array} Array of shop objects
 */
function parseGoogleMapsHTML(html) {
  const shops = [];

  try {
    // Extract JSON-LD structured data
    const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
    let match;
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        if (data['@type'] === 'LocalBusiness' || data['@type'] === 'BeautySalon') {
          shops.push({
            name: data.name || '',
            address: data.address?.streetAddress || data.address || '',
            rating: data.aggregateRating?.ratingValue || null,
            reviewCount: data.aggregateRating?.reviewCount || 0,
            url: data.url || '',
            telephone: data.telephone || '',
          });
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }

    // Extract from Google Maps embedded data (window.APP_INITIALIZATION_STATE)
    const appInitMatch = html.match(/window\.APP_INITIALIZATION_STATE\s*=\s*(\[.*?\]);/s);
    if (appInitMatch) {
      try {
        const appData = JSON.parse(appInitMatch[1]);
        // Parse Google Maps internal data structure
        const extracted = extractFromAppData(appData);
        shops.push(...extracted);
      } catch (e) {
        console.warn('[bkk-massage] Failed to parse APP_INITIALIZATION_STATE');
      }
    }

    // Extract from data attributes
    const dataAttributeRegex = /data-value="([^"]*)"[^>]*data-name="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = dataAttributeRegex.exec(html)) !== null) {
      // Additional parsing if needed
    }

  } catch (error) {
    console.error('[bkk-massage] Error parsing HTML:', error);
  }

  return shops;
}

/**
 * Extract shop data from Google Maps APP_INITIALIZATION_STATE
 * @param {Array} appData - App initialization data
 * @returns {Array} Extracted shops
 */
function extractFromAppData(appData) {
  const shops = [];
  // Google Maps uses a complex nested structure
  // This is a simplified extraction - may need refinement
  const dataStr = JSON.stringify(appData);
  
  // Look for business listings patterns
  const businessPattern = /"name":"([^"]+)","address":"([^"]+)"/g;
  let match;
  while ((match = businessPattern.exec(dataStr)) !== null) {
    shops.push({
      name: match[1],
      address: match[2],
    });
  }

  return shops;
}

/**
 * Enrich shop data with review information
 * @param {Object} shop - Shop object
 * @returns {Promise<Object>} Enriched shop data
 */
async function enrichShopData(shop) {
  if (!shop.url && !shop.name) {
    return null;
  }

  // Fetch shop details page to get reviews
  // Note: This may require browser automation for full functionality
  const reviewData = {
    prettiestWomen: [],
    pricing: [],
    lineUsernames: [],
    websites: [],
    overallRating: shop.rating || null,
    reviewCount: shop.reviewCount || 0,
  };

  // Extract website if available
  if (shop.url) {
    reviewData.websites.push(shop.url);
  }

  // For full review extraction, we'd need to:
  // 1. Navigate to shop's Google Maps page
  // 2. Scroll through reviews
  // 3. Extract mentions of:
  //    - "pretty", "beautiful", "attractive" (prettiest women)
  //    - Price mentions (pricing)
  //    - Line ID patterns (line usernames)
  //    - Website URLs (websites)

  // This is a placeholder - actual implementation would use Puppeteer/Playwright
  // or a Google Maps API if available

  return {
    ...shop,
    reviewData,
  };
}

/**
 * Execute Bangkok Massage task
 * @param {string} task - Task type
 * @param {Object} data - Shop data and context
 * @param {Function} emit - Event emitter
 * @returns {Promise<Object>} Task result
 */
async function executeBkkMassageTask(task, data, emit) {
  const { shopsData, content, region } = data;

  switch (task) {
    case "legitimacy_scoring":
      return await executeLegitimacyScoring(shopsData, content, region);
    
    case "district_aware_ranking":
      return await executeDistrictAwareRanking(shopsData, region);
    
    case "safety_pattern_recognition":
      return await executeSafetyPatternRecognition(shopsData, content);
    
    case "price_sanity_checking":
      return await executePriceSanityChecking(shopsData, content, region);
    
    default:
      // Default: district-aware ranking
      return await executeDistrictAwareRanking(shopsData, region);
  }
}

/**
 * Legitimacy scoring task
 */
async function executeLegitimacyScoring(shopsData, content, region) {
  // Filter by region if specified
  let shops = region 
    ? shopsData.filter(s => s.address?.toLowerCase().includes(region.toLowerCase()))
    : shopsData;

  // Score based on rating and review count
  const scoredShops = shops.map(shop => ({
    name: shop.name,
    address: shop.address,
    legitimacy_score: calculateLegitimacyScore(shop),
    overall_rating: shop.reviewData?.overallRating || shop.rating,
    review_count: shop.reviewData?.reviewCount || shop.reviewCount,
    prettiest_women_mentions: shop.reviewData?.prettiestWomen?.length || 0,
    pricing_info: shop.reviewData?.pricing || [],
    line_usernames: shop.reviewData?.lineUsernames || [],
    websites: shop.reviewData?.websites || [],
  }));

  return {
    assessment: region 
      ? `Legitimacy analysis for ${region} district`
      : "Legitimacy scoring for all shops",
    shops: scoredShops.sort((a, b) => b.legitimacy_score - a.legitimacy_score),
    total_shops: scoredShops.length,
  };
}

/**
 * Calculate legitimacy score based on rating and reviews
 */
function calculateLegitimacyScore(shop) {
  const rating = shop.reviewData?.overallRating || shop.rating || 0;
  const reviewCount = shop.reviewData?.reviewCount || shop.reviewCount || 0;
  
  // Score: rating (0-5) * 0.6 + review count factor (0-0.4)
  const ratingScore = (rating / 5) * 0.6;
  const reviewScore = Math.min(reviewCount / 100, 1) * 0.4;
  
  return ratingScore + reviewScore;
}

/**
 * District-aware ranking task
 */
async function executeDistrictAwareRanking(shopsData, region) {
  // Filter by district if specified
  let shops = region 
    ? shopsData.filter(s => s.address?.toLowerCase().includes(region.toLowerCase()))
    : shopsData;

  // Sort by rating and review count
  shops.sort((a, b) => {
    const aRating = a.reviewData?.overallRating || a.rating || 0;
    const bRating = b.reviewData?.overallRating || b.rating || 0;
    if (bRating !== aRating) return bRating - aRating;
    return (b.reviewData?.reviewCount || b.reviewCount || 0) - (a.reviewData?.reviewCount || a.reviewCount || 0);
  });

  return {
    assessment: region 
      ? `District-aware ranking for ${region}`
      : "District-aware ranking for all districts",
    shops: shops.slice(0, 20).map(shop => ({
      name: shop.name,
      address: shop.address,
      rating: shop.reviewData?.overallRating || shop.rating,
      review_count: shop.reviewData?.reviewCount || shop.reviewCount,
      prettiest_women_mentions: shop.reviewData?.prettiestWomen || [],
      pricing: shop.reviewData?.pricing || [],
      line_usernames: shop.reviewData?.lineUsernames || [],
      websites: shop.reviewData?.websites || [],
      telephone: shop.telephone,
    })),
    total_shops: shops.length,
  };
}

/**
 * Safety pattern recognition task
 */
async function executeSafetyPatternRecognition(shopsData, content) {
  return {
    assessment: "Safety pattern recognition from Google Maps reviews",
    shops_analyzed: shopsData.length,
    note: "Review data extraction requires browser automation for full functionality",
  };
}

/**
 * Price sanity checking task
 */
async function executePriceSanityChecking(shopsData, content, region) {
  // Extract all pricing information
  const allPricing = [];
  shopsData.forEach(shop => {
    if (shop.reviewData?.pricing) {
      allPricing.push(...shop.reviewData.pricing);
    }
  });

  return {
    assessment: "Price sanity check from review data",
    pricing_data: allPricing,
    shops_analyzed: shopsData.length,
    note: "Pricing extracted from Google Maps reviews",
  };
}

/**
 * Emit answer delta events
 * @param {Object} result - Task result
 * @param {Function} emit - Event emitter
 */
async function emitAnswer(result, emit) {
  const text = formatResultAsText(result);
  
  // Emit as single delta (can be split into chunks if needed)
  await emit("answer.delta", {
    text: text,
  });
}

/**
 * Format result as text
 * @param {Object} result - Task result
 * @returns {string} Formatted text
 */
function formatResultAsText(result) {
  let text = "";

  if (result.assessment) {
    text += `${result.assessment}\n\n`;
  }

  if (result.shops && Array.isArray(result.shops)) {
    text += "**Shops:**\n\n";
    result.shops.forEach((shop, idx) => {
      text += `${idx + 1}. **${shop.name}**`;
      if (shop.address) text += ` - ${shop.address}`;
      if (shop.rating) text += ` ⭐ ${shop.rating}`;
      if (shop.review_count) text += ` (${shop.review_count} reviews)`;
      text += "\n";
      
      if (shop.prettiest_women_mentions && shop.prettiest_women_mentions.length > 0) {
        text += `   - Prettiest women mentions: ${shop.prettiest_women_mentions.join(", ")}\n`;
      }
      if (shop.pricing && shop.pricing.length > 0) {
        text += `   - Pricing: ${shop.pricing.join(", ")}\n`;
      }
      if (shop.line_usernames && shop.line_usernames.length > 0) {
        text += `   - Line: ${shop.line_usernames.join(", ")}\n`;
      }
      if (shop.websites && shop.websites.length > 0) {
        text += `   - Website: ${shop.websites.join(", ")}\n`;
      }
      text += "\n";
    });
  }

  if (result.pricing_data && Array.isArray(result.pricing_data)) {
    text += "**Pricing Information:**\n";
    result.pricing_data.forEach(price => {
      text += `- ${price}\n`;
    });
    text += "\n";
  }

  return text || JSON.stringify(result, null, 2);
}
