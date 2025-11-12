#!/bin/bash
# Verification script for inline + KB mode
# Run this after deploying to verify end-to-end functionality

set -e

API="${PRECOGS_API:-https://precogs.croutons.ai}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Precogs Inline Mode Verification"
echo "===================================="
echo ""

# Test 1: POST inline endpoint
echo "Test 1: POST inline endpoint (no URL param)"
echo "--------------------------------------------"

SNIPPET='{"@context":"https://schema.org","@type":"Service","name":"Siding Installation","provider":{"@type":"Organization","name":"Hoosier Cladding"}}'

RESPONSE=$(curl -s -N "$API/v1/run.ndjson" \
  -H "Content-Type: application/json" \
  -d "{
    \"precog\": \"schema\",
    \"kb\": \"schema-foundation\",
    \"task\": \"validate\",
    \"type\": \"Service\",
    \"content_source\": \"inline\",
    \"content\": $SNIPPET
  }" | head -20)

if echo "$RESPONSE" | grep -q '"type":"ack"'; then
  echo -e "${GREEN}✅ PASS: Received ack with job_id${NC}"
else
  echo -e "${RED}❌ FAIL: No ack received${NC}"
  echo "Response: $RESPONSE"
  exit 1
fi

if echo "$RESPONSE" | grep -q "grounding.chunk"; then
  echo -e "${GREEN}✅ PASS: Received grounding.chunk${NC}"
else
  echo -e "${YELLOW}⚠️  WARN: No grounding.chunk (may be OK if KB not loaded)${NC}"
fi

echo ""

# Test 2: Incomplete schema validation
echo "Test 2: KB rules validation (incomplete schema)"
echo "------------------------------------------------"

BAD='{"@context":"https://schema.org","@type":"Service","name":"Thing"}'

RESPONSE2=$(curl -s -N "$API/v1/run.ndjson" \
  -H "Content-Type: application/json" \
  -d "{
    \"precog\":\"schema\",
    \"kb\":\"schema-foundation\",
    \"task\":\"validate\",
    \"type\":\"Service\",
    \"content_source\":\"inline\",
    \"content\": $BAD
  }" | head -30)

if echo "$RESPONSE2" | grep -q "answer.delta"; then
  echo -e "${GREEN}✅ PASS: Received answer.delta${NC}"
else
  echo -e "${RED}❌ FAIL: No answer.delta${NC}"
  exit 1
fi

if echo "$RESPONSE2" | grep -qi "recommend\|missing\|suggest"; then
  echo -e "${GREEN}✅ PASS: KB rules providing recommendations${NC}"
else
  echo -e "${YELLOW}⚠️  WARN: No recommendations found (KB rules may not be applied)${NC}"
fi

echo ""

# Test 3: Check for hardcoded URLs in code (not docs)
echo "Test 3: Check for hardcoded URLs in runtime code"
echo "-------------------------------------------------"

HARDCODED=$(grep -r "hoosiercladding\|url=https" \
  --include="*.html" \
  --include="*.js" \
  --include="*.mjs" \
  runtime/ tools/ src/ 2>/dev/null | grep -v "node_modules" || true)

if [ -z "$HARDCODED" ]; then
  echo -e "${GREEN}✅ PASS: No hardcoded URLs in runtime code${NC}"
else
  echo -e "${RED}❌ FAIL: Found hardcoded URLs:${NC}"
  echo "$HARDCODED"
  exit 1
fi

echo ""

# Test 4: POST endpoint exists
echo "Test 4: POST endpoint CORS/OPTIONS"
echo "----------------------------------"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$API/v1/run.ndjson" \
  -H "Origin: https://precogs.croutons.ai" \
  -H "Access-Control-Request-Method: POST")

if [ "$STATUS" = "200" ] || [ "$STATUS" = "204" ]; then
  echo -e "${GREEN}✅ PASS: POST endpoint responds to OPTIONS (status: $STATUS)${NC}"
else
  echo -e "${YELLOW}⚠️  WARN: OPTIONS returned status $STATUS (may be OK)${NC}"
fi

echo ""

# Test 5: Metrics endpoint
echo "Test 5: Metrics endpoint"
echo "------------------------"

METRICS=$(curl -s "$API/metrics")

if echo "$METRICS" | grep -q "processed_total"; then
  echo -e "${GREEN}✅ PASS: Metrics endpoint accessible${NC}"
  PROCESSED=$(echo "$METRICS" | grep "processed_total" | head -1)
  echo "  $PROCESSED"
else
  echo -e "${RED}❌ FAIL: Metrics endpoint not accessible${NC}"
  exit 1
fi

echo ""

# Test 6: Function schema check
echo "Test 6: Function schema defaults"
echo "--------------------------------"

SCHEMA_CHECK=$(grep -A 5 'content_source.*enum' src/functions/invoke_precog.js | grep -q 'default.*inline' && echo "found" || echo "not found")

if [ "$SCHEMA_CHECK" = "found" ]; then
  echo -e "${GREEN}✅ PASS: Function schema defaults to inline${NC}"
else
  echo -e "${RED}❌ FAIL: Function schema does not default to inline${NC}"
  exit 1
fi

echo ""

echo "===================================="
echo -e "${GREEN}✅ Verification complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Test CLI: pbpaste | npm run schema:validate -- --inline --type Service"
echo "2. Test web viewers: Open /runtime/auto.html and /runtime/cli.html"
echo "3. Test function calling: curl -N $API/v1/chat with schema snippet"
echo "4. Check worker logs: npx railway logs -s precogs-worker"

