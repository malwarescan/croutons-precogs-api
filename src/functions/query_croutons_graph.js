/**
 * GPT Function Definition: query_croutons_graph
 * 
 * Allows GPT agents to query the Croutons graph for factlets and triples.
 * This is the primary interface for LLMs to access the knowledge graph.
 */

export const queryCroutonsGraphFunction = {
  name: "query_croutons_graph",
  description: "Query the Croutons knowledge graph for factlets, claims, and relationships. Use this to retrieve verified information from the graph database. Returns factlets (atomic facts) and triples (relationships) that match your query.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text search query to find relevant factlets. Searches in claim/text fields. Example: 'Bangkok massage shops in Asok' or 'flood protection Naples FL'"
      },
      domain: {
        type: "string",
        description: "Filter by domain (e.g., 'ourcasa.ai', 'floodbarrierpros.com', 'bkk_massage'). Optional."
      },
      corpus: {
        type: "string",
        description: "Filter by corpus ID (e.g., 'bkk_massage', 'home_services'). Optional."
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (1-100, default: 20)",
        minimum: 1,
        maximum: 100
      }
    },
    required: ["query"]
  }
};

/**
 * Execute the query_croutons_graph function
 * @param {Object} args - Function arguments
 * @returns {Promise<Object>} Query results
 */
export async function executeQueryCroutonsGraph(args) {
  const { query, domain, corpus, limit = 20 } = args;
  
  const graphBase = process.env.GRAPH_BASE || "https://graph.croutons.ai";
  
  const params = new URLSearchParams({
    q: query,
    limit: Math.min(100, Math.max(1, limit))
  });
  
  if (domain) params.append("domain", domain);
  if (corpus) params.append("corpus", corpus);
  
  try {
    const response = await fetch(`${graphBase}/api/query?${params.toString()}`, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });
    
    if (!response.ok) {
      throw new Error(`Graph query failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      success: true,
      query: query,
      results: data.results || [],
      triples: data.triples || [],
      count: data.count || 0,
      message: `Found ${data.count || 0} factlets matching "${query}"`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      results: [],
      triples: [],
      count: 0
    };
  }
}

