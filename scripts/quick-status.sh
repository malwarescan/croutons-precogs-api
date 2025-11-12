#!/bin/bash
# Quick status check script
# Run this anytime to check deployment status

API="${PRECOGS_API:-https://precogs.croutons.ai}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Quick Status Check${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Health check
echo -e "${YELLOW}Health Endpoint:${NC}"
HEALTH=$(curl -s "$API/health" 2>/dev/null)
if [ $? -eq 0 ] && echo "$HEALTH" | grep -q "ok"; then
  echo -e "${GREEN}✅ API is healthy${NC}"
  echo "$HEALTH" | jq '.' 2>/dev/null || echo "$HEALTH"
else
  echo -e "${RED}❌ API health check failed${NC}"
fi

echo ""

# Metrics check
echo -e "${YELLOW}Metrics:${NC}"
METRICS=$(curl -s "$API/metrics" 2>/dev/null)
if [ $? -eq 0 ]; then
  PROCESSED=$(echo "$METRICS" | grep -o '"processed_total":[0-9]*' | cut -d':' -f2)
  FAILED=$(echo "$METRICS" | grep -o '"failed_total":[0-9]*' | cut -d':' -f2)
  INFLIGHT=$(echo "$METRICS" | grep -o '"inflight_jobs":[0-9]*' | cut -d':' -f2)
  
  echo "  processed_total: $PROCESSED"
  echo "  failed_total: $FAILED"
  echo "  inflight_jobs: $INFLIGHT"
  
  if [ "$FAILED" = "0" ]; then
    echo -e "${GREEN}✅ No failed jobs${NC}"
  else
    echo -e "${YELLOW}⚠️  $FAILED failed jobs${NC}"
  fi
else
  echo -e "${RED}❌ Metrics endpoint failed${NC}"
fi

echo ""

# API Status
echo -e "${YELLOW}API Service Status:${NC}"
cd ~/Desktop/croutons.ai/precogs/precogs-api
npx railway status 2>/dev/null | grep -E "Project|Environment|Service|Status" || echo "Status check failed"

echo ""

# Worker Status
echo -e "${YELLOW}Worker Service Status:${NC}"
cd ~/Desktop/croutons.ai/precogs/precogs-api/precogs-worker
npx railway status 2>/dev/null | grep -E "Project|Environment|Service|Status" || echo "Status check failed"

echo ""
echo -e "${BLUE}========================================${NC}"

