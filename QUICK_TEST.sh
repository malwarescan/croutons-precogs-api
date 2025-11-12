#!/bin/bash
# Quick test script for Precogs API

API_BASE="https://precogs.croutons.ai"
API_KEY="${API_KEY:-}"

echo "=== Precogs API Test ==="
echo ""

# 1. Health check
echo "1. Health check..."
curl -sS "$API_BASE/health" | jq .
echo ""

# 2. Create job
echo "2. Creating job..."
RESP=$(curl -sS -X POST "$API_BASE/v1/invoke" \
  -H "Content-Type: application/json" \
  ${API_KEY:+-H "Authorization: Bearer $API_KEY"} \
  -d '{"precog":"schema","url":"https://example.com","task":"Test job"}')

echo "$RESP" | jq .

JOB_ID=$(echo "$RESP" | jq -r '.job_id // empty')
if [ -z "$JOB_ID" ]; then
  echo "ERROR: No job_id returned"
  exit 1
fi

echo ""
echo "3. Job ID: $JOB_ID"
echo ""

# 3. Stream events
echo "4. Streaming events (10 seconds)..."
echo "URL: $API_BASE/v1/jobs/$JOB_ID/events"
echo ""
timeout 10 curl -N "$API_BASE/v1/jobs/$JOB_ID/events" 2>/dev/null || true

echo ""
echo ""
echo "=== Test Complete ==="
echo "To stream more events, run:"
echo "curl -N \"$API_BASE/v1/jobs/$JOB_ID/events\""



