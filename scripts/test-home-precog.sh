#!/bin/bash
# Test home precog endpoint
# Usage: ./scripts/test-home-precog.sh

API="${PRECOGS_API:-https://precogs.croutons.ai}"
API_KEY="${PRECOGS_API_KEY:-}"

echo "=== Testing Home Precog Endpoint ==="
echo "API: $API"
echo ""

# Test with home.safety diagnose
echo "Test 1: home.safety diagnose"
echo ""

if [ -n "$API_KEY" ]; then
  curl -N "$API/v1/run.ndjson" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "precog": "home.safety",
      "task": "diagnose",
      "content": "I live near a canal in Fort Myers (33908). My garage floods when it rains. What should I be looking at for protection?",
      "region": "33908",
      "domain": "floodbarrierpros.com",
      "vertical": "flood_protection"
    }' 2>&1
else
  curl -N "$API/v1/run.ndjson" \
    -H "Content-Type: application/json" \
    -d '{
      "precog": "home.safety",
      "task": "diagnose",
      "content": "I live near a canal in Fort Myers (33908). My garage floods when it rains. What should I be looking at for protection?",
      "region": "33908",
      "domain": "floodbarrierpros.com",
      "vertical": "flood_protection"
    }' 2>&1
fi

echo ""
echo ""
echo "=== Test Complete ==="




