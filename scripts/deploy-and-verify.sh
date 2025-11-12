#!/bin/bash
# Complete deployment and verification script for inline + KB mode
# Run this to deploy and verify in one go

set -e

API="${PRECOGS_API:-https://precogs.croutons.ai}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Precogs Inline Mode Deployment & Verification${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 0: Deploy
echo -e "${BLUE}Step 0: Deploying to Railway...${NC}"
echo "----------------------------------------"

echo -e "${YELLOW}Deploying API service...${NC}"
cd ~/Desktop/croutons.ai/precogs/precogs-api
npx railway link > /dev/null 2>&1 || echo "Already linked"
npx railway up -s precogs-api

echo -e "${YELLOW}Waiting 10 seconds for API to start...${NC}"
sleep 10

echo -e "${YELLOW}Deploying Worker service...${NC}"
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway link > /dev/null 2>&1 || echo "Already linked"
npx railway up -s precogs-worker

echo -e "${YELLOW}Waiting 10 seconds for Worker to start...${NC}"
sleep 10

echo ""
echo -e "${GREEN}✅ Deployment complete${NC}"
echo ""

# Step 1: Automated verification
echo -e "${BLUE}Step 1: Automated Verification${NC}"
echo "----------------------------------------"
cd ~/Desktop/croutons.ai/precogs/precogs-api
PRECOGS_API="$API" bash scripts/verify-inline-mode.sh

echo ""

# Step 2: Manual smoke test
echo -e "${BLUE}Step 2: Manual Smoke Test (POST inline)${NC}"
echo "----------------------------------------"

SNIPPET='{"@context":"https://schema.org","@type":"Service","name":"Siding Installation","provider":{"@type":"Organization","name":"Hoosier Cladding"}}'

echo "Testing POST /v1/run.ndjson with inline content..."
echo ""

RESPONSE=$(curl -s -N "$API/v1/run.ndjson" \
  -H "Content-Type: application/json" \
  -d "{
    \"precog\": \"schema\",
    \"kb\": \"schema-foundation\",
    \"task\": \"validate\",
    \"type\": \"Service\",
    \"content_source\": \"inline\",
    \"content\": $SNIPPET
  }" | head -30)

if echo "$RESPONSE" | grep -q '"type":"ack"'; then
  echo -e "${GREEN}✅ PASS: Received ack${NC}"
  JOB_ID=$(echo "$RESPONSE" | grep '"type":"ack"' | head -1 | grep -o '"job_id":"[^"]*"' | cut -d'"' -f4)
  echo "   Job ID: $JOB_ID"
else
  echo -e "${RED}❌ FAIL: No ack received${NC}"
  echo "Response: $RESPONSE"
  exit 1
fi

if echo "$RESPONSE" | grep -q "grounding.chunk"; then
  echo -e "${GREEN}✅ PASS: Received grounding.chunk${NC}"
else
  echo -e "${YELLOW}⚠️  WARN: No grounding.chunk${NC}"
fi

if echo "$RESPONSE" | grep -q "answer.delta"; then
  echo -e "${GREEN}✅ PASS: Received answer.delta${NC}"
else
  echo -e "${YELLOW}⚠️  WARN: No answer.delta yet (may still be processing)${NC}"
fi

echo ""

# Step 3: Check hardcoded URLs
echo -e "${BLUE}Step 3: Hardcoded URL Check${NC}"
echo "----------------------------------------"

HARDCODED=$(cd ~/Desktop/croutons.ai/precogs/precogs-api && rg -n "hoosiercladding|url=https" runtime/ tools/ src/ 2>/dev/null | grep -v "node_modules" || true)

if [ -z "$HARDCODED" ]; then
  echo -e "${GREEN}✅ PASS: No hardcoded URLs in runtime code${NC}"
else
  echo -e "${RED}❌ FAIL: Found hardcoded URLs${NC}"
  echo "$HARDCODED"
fi

echo ""

# Step 4: Metrics check
echo -e "${BLUE}Step 4: Metrics Check${NC}"
echo "----------------------------------------"

METRICS=$(curl -s "$API/metrics")
PROCESSED=$(echo "$METRICS" | grep -o '"processed_total":[0-9]*' | cut -d':' -f2)
FAILED=$(echo "$METRICS" | grep -o '"failed_total":[0-9]*' | cut -d':' -f2)

echo "processed_total: $PROCESSED"
echo "failed_total: $FAILED"

if [ "$FAILED" = "0" ]; then
  echo -e "${GREEN}✅ PASS: failed_total is 0${NC}"
else
  echo -e "${YELLOW}⚠️  WARN: failed_total is $FAILED${NC}"
fi

echo ""

# Step 5: CORS/OPTIONS check
echo -e "${BLUE}Step 5: CORS/OPTIONS Check${NC}"
echo "----------------------------------------"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$API/v1/run.ndjson" \
  -H "Origin: https://precogs.croutons.ai" \
  -H "Access-Control-Request-Method: POST")

if [ "$STATUS" = "200" ] || [ "$STATUS" = "204" ]; then
  echo -e "${GREEN}✅ PASS: OPTIONS returns $STATUS${NC}"
else
  echo -e "${YELLOW}⚠️  WARN: OPTIONS returned $STATUS${NC}"
fi

echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Verification Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Next steps:"
echo "1. Test CLI: pbpaste | npm run schema:validate -- --inline --type Service"
echo "2. Test web viewers: Open /runtime/auto.html, /runtime/cli.html"
echo "3. Test function calling: curl -N $API/v1/chat with schema snippet"
echo "4. Check worker logs: cd precogs-worker && npx railway logs -s precogs-worker"
echo ""
echo -e "${GREEN}✅ Verification complete!${NC}"

