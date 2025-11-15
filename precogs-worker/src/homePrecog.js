/* jshint node: true, esversion: 11 */
/**
 * Home Domain Precog Handler
 * Processes home-related precog tasks (diagnose, assess_risk, local_context, etc.)
 */

import { loadKB } from "./kb.js";
import { fetchNDJSON } from "./ndjsonIngestion.js";

/**
 * Process home domain precog job
 * @param {string} jobId - Job ID
 * @param {string} namespace - Precog namespace (home, home.hvac, etc.)
 * @param {string} task - Task type (diagnose, assess_risk, local_context, etc.)
 * @param {Object} context - Job context (content, type, region, etc.)
 * @param {Function} emit - Event emitter function
 * @returns {Promise<Object>} Result object
 */
export async function processHomePrecog(jobId, namespace, task, context, emit) {
  const kbData = loadKB("home-foundation");
  const content = context?.content;
  const region = context?.region;
  const domain = context?.domain;
  const vertical = context?.vertical;

  console.log(`[home-precog] Processing ${namespace}.${task} for job ${jobId}`);

  try {
    // Emit grounding event
    await emit("grounding.chunk", {
      count: 1,
      source: `KB: home-foundation`,
      namespace: namespace,
      task: task,
      rules_loaded: !!kbData.types && Object.keys(kbData.types).length > 0,
    });

    // Query Croutons graph for relevant factlets
    let factlets = await queryCroutonsGraph({
      namespace,
      task,
      content,
      region,
      domain,
      vertical,
    }, emit);

    // Apply query hooks for filtering/boosting
    if (domain) {
      factlets = queryHooks.byDomain(factlets, domain);
    }
    if (region) {
      factlets = queryHooks.byRegion(factlets, region);
    }
    if (vertical) {
      factlets = queryHooks.byVertical(factlets, vertical);
    }

    // Process task-specific logic
    const result = await executeHomeTask(task, factlets, context, kbData);

    console.log(`[home-precog] Task ${task} completed, result:`, JSON.stringify(result, null, 2));

    // Emit answer delta events
    await emitAnswer(result, emit);

    console.log(`[home-precog] All answer.delta events emitted for job ${jobId}`);

    return { success: true, result };
  } catch (error) {
    console.error(`[home-precog] Error processing ${namespace}.${task}:`, error);
    await emit("answer.delta", {
      text: `⚠️ Error processing ${task}: ${error.message}\n`,
    });
    throw error;
  }
}

/**
 * Query Croutons graph for relevant factlets
 * @param {Object} params - Query parameters
 * @returns {Promise<Array>} Array of factlets
 */
async function queryCroutonsGraph(params, emit) {
  const { namespace, task, content, region, domain, vertical } = params;

  const graphBase = process.env.GRAPH_BASE || "https://graph.croutons.ai";
  
  // Emit grounding chunk to indicate graph query
  if (emit) {
    await emit("grounding.chunk", {
      count: 1,
      source: `${graphBase}/api/triples`,
      query: {
        domain: domain || null,
        region: region || null,
        vertical: vertical || null,
      },
    });
  }
  
  try {
    // Query graph API for home domain factlets
    const queryParams = new URLSearchParams({
      type: "Factlet",
      domain: domain || "",
      region: region || "",
      vertical: vertical || "",
      system: namespace.replace("home.", "") || "home",
    });

    const response = await fetch(`${graphBase}/api/triples?${queryParams.toString()}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      console.warn(`[home-precog] Graph query failed: ${response.status}`);
      
      // Fallback: fetch directly from NDJSON feed if domain is known
      if (domain) {
        const ndjsonUrl = getNDJSONUrlForDomain(domain);
        if (ndjsonUrl) {
          console.log(`[home-precog] Falling back to NDJSON feed: ${ndjsonUrl}`);
          try {
            const factlets = await fetchNDJSON(ndjsonUrl);
            console.log(`[home-precog] Fetched ${factlets.length} factlets from NDJSON feed`);
            return factlets;
          } catch (ndjsonError) {
            console.warn(`[home-precog] NDJSON fallback failed: ${ndjsonError.message}`);
          }
        }
      }
      
      return [];
    }

    const data = await response.json();
    
    // Extract factlets from triples response
    // Adjust based on actual graph API response format
    return data.triples || data.factlets || [];
  } catch (error) {
    console.warn(`[home-precog] Graph query error: ${error.message}`);
    
    // Fallback: fetch directly from NDJSON feed if domain is known
    if (domain) {
      const ndjsonUrl = getNDJSONUrlForDomain(domain);
      if (ndjsonUrl) {
        console.log(`[home-precog] Falling back to NDJSON feed after error: ${ndjsonUrl}`);
        try {
          const factlets = await fetchNDJSON(ndjsonUrl);
          console.log(`[home-precog] Fetched ${factlets.length} factlets from NDJSON feed`);
          return factlets;
        } catch (ndjsonError) {
          console.warn(`[home-precog] NDJSON fallback failed: ${ndjsonError.message}`);
        }
      }
    }
    
    // Return empty array on error - precog can still work with KB rules
    return [];
  }
}

/**
 * Get NDJSON feed URL for a given domain
 * @param {string} domain - Domain name
 * @returns {string|null} NDJSON URL or null if not known
 */
function getNDJSONUrlForDomain(domain) {
  const domainMap = {
    "floodbarrierpros.com": "https://floodbarrierpros.com/sitemaps/sitemap-ai.ndjson",
    // Add more domains as needed
  };
  return domainMap[domain] || null;
}

/**
 * Execute home domain task
 * @param {string} task - Task type
 * @param {Array} factlets - Relevant factlets from graph
 * @param {Object} context - Job context
 * @param {Object} kbData - KB data
 * @returns {Promise<Object>} Task result
 */
async function executeHomeTask(task, factlets, context, kbData) {
  switch (task) {
    case "diagnose":
      return diagnoseTask(factlets, context);
    case "assess_risk":
      return assessRiskTask(factlets, context);
    case "recommend_fixes":
      return recommendFixesTask(factlets, context);
    case "local_context":
      return localContextTask(factlets, context);
    case "timing":
      return timingTask(factlets, context);
    case "cost_band":
      return costBandTask(factlets, context);
    case "risk_projection":
      return riskProjectionTask(factlets, context);
    default:
      throw new Error(`Unknown task: ${task}`);
  }
}

/**
 * Diagnose task handler
 */
function diagnoseTask(factlets, context) {
  const content = context?.content || "";
  const symptoms = extractSymptoms(content);
  const region = context?.region || "";
  const domain = context?.domain || "";

  // Build assessment based on content and factlets
  let assessment = "Analysis based on symptoms and knowledge base";
  if (content.toLowerCase().includes("flood") || content.toLowerCase().includes("garage")) {
    assessment = "Home in a flood-risk area with ground-level garage flooding issue";
  }

  let riskScore = 0.3;
  if (content.toLowerCase().includes("flood") && region) {
    riskScore = 0.75; // Higher risk for flood issues
  }

  const likelyCauses = [];
  if (content.toLowerCase().includes("flood")) {
    likelyCauses.push("Insufficient drainage near garage entrance");
    likelyCauses.push("Backflow from street drains during heavy rain");
    likelyCauses.push("Lack of flood barriers or seals");
  } else {
    likelyCauses.push(...symptoms.map((s) => `Possible cause for: ${s}`));
  }

  const recommendedSteps = [];
  if (content.toLowerCase().includes("flood")) {
    recommendedSteps.push("Install removable flood barrier at garage entrance");
    recommendedSteps.push("Add trench drain and ensure gutters discharge away from driveway");
    recommendedSteps.push("Check for proper grading around garage");
    if (domain === "floodbarrierpros.com") {
      recommendedSteps.push("Consider professional flood barrier installation");
    }
  } else {
    recommendedSteps.push("Check system", "Monitor closely", "Call professional if needed");
  }

  // Extract cost_band and when from factlets if domain is floodbarrierpros.com
  let costBand = null;
  let when = null;

  if (domain === "floodbarrierpros.com" && factlets && factlets.length > 0) {
    // Normalize region for matching (extract city name)
    const regionNormalized = region ? region.toLowerCase().split(",")[0].trim() : "";
    
    // Find factlet matching region or use first one
    const matchingFactlet = factlets.find(f => {
      if (!regionNormalized) return false;
      
      // Check various location fields
      const fLocation = (f.location || f.region || "").toLowerCase();
      const fId = (f["@id"] || "").toLowerCase();
      const fName = (f.name || "").toLowerCase();
      
      return fLocation.includes(regionNormalized) ||
             fId.includes(regionNormalized) ||
             fName.includes(regionNormalized);
    }) || factlets[0];

    // Extract cost_range -> cost_band
    if (matchingFactlet.cost_range) {
      costBand = matchingFactlet.cost_range;
    } else if (matchingFactlet.cost_p50) {
      // Fallback: use median cost as estimate
      costBand = `~${matchingFactlet.cost_p50}`;
    }

    // Extract best_season -> when
    if (matchingFactlet.best_season) {
      when = matchingFactlet.best_season;
    } else if (matchingFactlet.typical_duration) {
      // Fallback: use typical_duration if best_season not available
      when = matchingFactlet.typical_duration;
    }
  }

  const result = {
    assessment: assessment,
    risk_score: riskScore,
    likely_causes: likelyCauses,
    recommended_steps: recommendedSteps,
    dangerous_conditions: content.toLowerCase().includes("electrical") ? ["Water near electrical outlets"] : [],
    triage_level: riskScore > 0.6 ? "caution" : "safe",
  };

  // Add cost_band and when if extracted from factlets
  if (costBand) {
    result.cost_band = costBand;
  }
  if (when) {
    result.when = when;
  }

  return result;
}

/**
 * Assess risk task handler
 */
function assessRiskTask(factlets, context) {
  return {
    assessment: "Risk assessment based on system and region",
    risk_score: 0.25,
    dangerous_conditions: [],
    triage_level: "safe",
  };
}

/**
 * Recommend fixes task handler
 */
function recommendFixesTask(factlets, context) {
  return {
    recommended_steps: ["Step 1", "Step 2", "Step 3"],
    requires_pro: false,
    cost_band: {
      low: 100,
      high: 500,
      currency: "USD",
      confidence: 0.7,
    },
  };
}

/**
 * Local context task handler (Casa-specific)
 */
function localContextTask(factlets, context) {
  const region = context?.region || "unknown";
  const domain = context?.domain || "";
  const vertical = context?.vertical || "";

  // Build location context based on region
  let riskProfile = "Standard profile";
  if (region.includes("33908") || region.includes("Fort Myers")) {
    riskProfile = "coastal, heavy rain, storm surge prone";
  }

  let timingRecommendation = "Best window: November–February";
  if (region.includes("FL") || region.includes("Florida")) {
    timingRecommendation = "Install flood barriers before peak storm season (June–November)";
  }

  let costBand = {
    low: 10000,
    high: 25000,
    currency: "USD",
    confidence: 0.75,
  };
  if (vertical === "flood_protection") {
    costBand = {
      low: 2000,
      high: 8000,
      currency: "USD",
      confidence: 0.7,
    };
  }

  return {
    location_context: {
      region: region,
      risk_profile: riskProfile,
    },
    timing_recommendation: timingRecommendation,
    cost_band: costBand,
    risk_projection: {
      five_year: "Elevated risk of repeated flooding without mitigation",
      ten_year: "High probability of structural issues without intervention",
    },
    when_to_call_pro: [
      "If water reaches electrical outlets",
      "If flooding persists after basic drainage improvements",
      "Visible structural damage",
    ],
  };
}

/**
 * Timing task handler
 */
function timingTask(factlets, context) {
  return {
    timing_recommendation: "Optimal timing: November–February",
    optimal_window: ["November", "December", "January", "February"],
  };
}

/**
 * Cost band task handler
 */
function costBandTask(factlets, context) {
  return {
    cost_band: {
      low: 5000,
      high: 15000,
      currency: "USD",
      confidence: 0.8,
    },
  };
}

/**
 * Risk projection task handler
 */
function riskProjectionTask(factlets, context) {
  return {
    risk_projection: {
      five_year: "Moderate risk",
      ten_year: "Higher risk without intervention",
    },
  };
}

/**
 * Emit answer delta events
 */
async function emitAnswer(result, emit) {
  if (!result) {
    console.warn("[home-precog] emitAnswer called with null/undefined result");
    await emit("answer.delta", {
      text: "No result generated from task processing.\n",
    });
    return;
  }

  console.log(`[home-precog] emitAnswer called with result keys: ${Object.keys(result).join(", ")}`);

  // Emit base fields
  if (result.assessment) {
    await emit("answer.delta", {
      text: `\nAssessment:\n${result.assessment}\n`,
    });
  }

  if (result.risk_score !== undefined) {
    await emit("answer.delta", {
      text: `\nRisk Score: ${result.risk_score}\n`,
    });
  }

  if (result.likely_causes && result.likely_causes.length > 0) {
    await emit("answer.delta", {
      text: `\nLikely Causes:\n`,
    });
    for (const cause of result.likely_causes) {
      await emit("answer.delta", {
        text: `  • ${cause}\n`,
      });
    }
  }

  if (result.recommended_steps && result.recommended_steps.length > 0) {
    await emit("answer.delta", {
      text: `\nRecommended Steps:\n`,
    });
    for (const step of result.recommended_steps) {
      await emit("answer.delta", {
        text: `  • ${step}\n`,
      });
    }
  }

  if (result.dangerous_conditions && result.dangerous_conditions.length > 0) {
    await emit("answer.delta", {
      text: `\nDangerous Conditions:\n`,
    });
    for (const condition of result.dangerous_conditions) {
      await emit("answer.delta", {
        text: `  • ${condition}\n`,
      });
    }
  }

  if (result.triage_level) {
    await emit("answer.delta", {
      text: `\nTriage Level: ${result.triage_level}\n`,
    });
  }

  // Emit Casa-specific fields
  if (result.location_context) {
    await emit("answer.delta", {
      text: `\nLocation Context:\n  Region: ${result.location_context.region || "unknown"}\n  Risk Profile: ${result.location_context.risk_profile || "standard"}\n`,
    });
  }

  if (result.timing_recommendation) {
    await emit("answer.delta", {
      text: `\nTiming Recommendation: ${result.timing_recommendation}\n`,
    });
  }

  if (result.cost_band) {
    // Handle both object format (old) and string format (new from factlets)
    if (typeof result.cost_band === "string") {
      await emit("answer.delta", {
        text: `\nCost Band: ${result.cost_band}\n`,
      });
    } else {
      await emit("answer.delta", {
        text: `\nCost Band: ${result.cost_band.currency || "USD"} ${result.cost_band.low} - ${result.cost_band.high} (Confidence: ${result.cost_band.confidence || 0})\n`,
      });
    }
  }

  if (result.when) {
    await emit("answer.delta", {
      text: `\nWhen: ${result.when}\n`,
    });
  }

  if (result.risk_projection) {
    await emit("answer.delta", {
      text: `\nRisk Projection:\n  5-Year: ${result.risk_projection.five_year || "N/A"}\n  10-Year: ${result.risk_projection.ten_year || "N/A"}\n`,
    });
  }

  if (result.when_to_call_pro && result.when_to_call_pro.length > 0) {
    await emit("answer.delta", {
      text: `\nWhen to Call a Pro:\n`,
    });
    for (const item of result.when_to_call_pro) {
      await emit("answer.delta", {
        text: `  • ${item}\n`,
      });
    }
  }

  // Always emit full result as JSON at the end
  await emit("answer.delta", {
    text: `\nFull Result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`,
  });

  console.log(`[home-precog] emitAnswer completed, emitted events for result`);
}

/**
 * Extract symptoms from content
 */
function extractSymptoms(content) {
  // Simple extraction - in production, use NLP or structured parsing
  const symptoms = [];
  const symptomKeywords = ["not working", "broken", "leaking", "warm", "cold", "noisy"];
  
  for (const keyword of symptomKeywords) {
    if (content.toLowerCase().includes(keyword)) {
      symptoms.push(keyword);
    }
  }
  
  return symptoms.length > 0 ? symptoms : ["general issue"];
}

/**
 * Query hooks for filtering factlets
 */
export const queryHooks = {
  byDomain: (factlets, domain) => {
    return factlets.filter((f) => f.domain === domain);
  },
  byRegion: (factlets, region) => {
    return factlets.filter((f) => f.region === region || f.region?.includes(region));
  },
  byVertical: (factlets, vertical) => {
    return factlets.filter((f) => f.vertical === vertical || f.system === vertical);
  },
};

