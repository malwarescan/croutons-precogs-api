#!/bin/bash
# FINAL "GO LIVE" PROOF BUNDLE — REQUIRED BEFORE WE CLAIM FULL_PROTOCOL
# Target: nrlc.ai

set -e

echo "================================================================"
echo "FINAL GO LIVE PROOF BUNDLE FOR FULL PROTOCOL v1.1"
echo "================================================================"
echo ""
echo "Target domain: nrlc.ai"
echo "Target URL: https://nrlc.ai/"
echo ""
echo "Waiting for service to be healthy..."

# Wait for service to be healthy
for i in {1..30}; do
  HEALTH=$(curl -s --max-time 3 "https://precogs.croutons.ai/health" 2>/dev/null | jq -r '.ok' 2>/dev/null || echo "false")
  if [ "$HEALTH" == "true" ]; then
    echo "✅ Service is healthy!"
    break
  fi
  echo "[$i/30] Waiting... (service not ready)"
  sleep 10
done

if [ "$HEALTH" != "true" ]; then
  echo "❌ Service did not become healthy. Aborting."
  exit 1
fi

echo ""
echo "================================================================"
echo "TEST 1: Facts stream — prove both evidence types + non-empty"
echo "================================================================"
echo ""
echo "Command: curl -s 'https://precogs.croutons.ai/v1/facts/nrlc.ai.ndjson' | jq -r '.evidence_type' | sort | uniq -c"
echo ""
curl -s "https://precogs.croutons.ai/v1/facts/nrlc.ai.ndjson" | jq -r '.evidence_type' | sort | uniq -c
echo ""
echo "Sample text_extraction fact:"
echo "Command: curl -s 'https://precogs.croutons.ai/v1/facts/nrlc.ai.ndjson?evidence_type=text_extraction' | head -1 | jq"
echo ""
curl -s "https://precogs.croutons.ai/v1/facts/nrlc.ai.ndjson?evidence_type=text_extraction" | head -1 | jq '{slot_id,fact_id,evidence_type,object:(.triple.object),supporting_text,evidence_anchor,anchor_missing}'
echo ""

echo "================================================================"
echo "TEST 2: Extract endpoint — prove external validation pass_rate = 1.0"
echo "================================================================"
echo ""
echo "Command: curl -s 'https://precogs.croutons.ai/v1/extract/nrlc.ai?url=https%3A%2F%2Fnrlc.ai%2F' | jq"
echo ""
curl -s "https://precogs.croutons.ai/v1/extract/nrlc.ai?url=https%3A%2F%2Fnrlc.ai%2F" | jq '{extraction_text_hash, facts_validated:.validation.facts_validated, facts_passed:.validation.facts_passed, pass_rate:(.validation.facts_passed/.validation.facts_validated), citation_grade:.validation.citation_grade}'
echo ""

echo "================================================================"
echo "TEST 3: Mirror — prove split sections + v1.1 evidence blocks"
echo "================================================================"
echo ""
echo "Command: curl -s 'https://md.croutons.ai/nrlc.ai/index.md' | sed -n '1,80p'"
echo ""
curl -s "https://md.croutons.ai/nrlc.ai/index.md" | sed -n '1,80p'
echo ""
echo "... (showing first 80 lines)"
echo ""

echo "================================================================"
echo "TEST 4: Mirror headers — prove canonical linkback + cache headers"
echo "================================================================"
echo ""
echo "Command: curl -I 'https://md.croutons.ai/nrlc.ai/index.md'"
echo ""
curl -I "https://md.croutons.ai/nrlc.ai/index.md" 2>/dev/null | sed -n '1,40p'
echo ""

echo "================================================================"
echo "TEST 5: Status endpoint — prove full_protocol computed from text facts"
echo "================================================================"
echo ""
echo "Command: curl -s 'https://precogs.croutons.ai/v1/status/nrlc.ai' | jq"
echo ""
curl -s "https://precogs.croutons.ai/v1/status/nrlc.ai" | jq '{domain,verified,versions,counts,nonempty,qa}'
echo ""

echo "================================================================"
echo "TEST 6: Graph endpoint — prove non-empty JSON-LD"
echo "================================================================"
echo ""
echo "Command: curl -s 'https://precogs.croutons.ai/v1/graph/nrlc.ai.jsonld' | jq '.["@graph"] | length'"
echo ""
GRAPH_LENGTH=$(curl -s "https://precogs.croutons.ai/v1/graph/nrlc.ai.jsonld" | jq '.["@graph"] | length' 2>/dev/null || echo "0")
echo "Graph length: $GRAPH_LENGTH"
echo ""

echo "================================================================"
echo "FINAL VERIFICATION SUMMARY"
echo "================================================================"
echo ""
echo "✅ All tests completed. Review outputs above to verify:"
echo "   1. Both evidence_type counts > 0"
echo "   2. Text facts have valid anchors (anchor_missing=false)"
echo "   3. Extract validator pass_rate = 1.0"
echo "   4. Mirror has v1.1 format with split sections"
echo "   5. Status shows correct versions and full_protocol tier"
echo "   6. Graph is non-empty"
echo ""
echo "If all checks pass, you can claim:"
echo "\"Full Protocol v1.1 is live: text facts are literal quotes from"
echo "canonical extraction with deterministic offsets + hashes; schema"
echo "facts are separated as metadata; status and extract endpoint"
echo "externally validate citation-grade.\""
echo ""
