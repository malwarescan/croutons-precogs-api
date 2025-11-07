#!/bin/bash
# Verification script for Railway deployment

set -e

RAILWAY_URL="${RAILWAY_URL:-https://precogs-api-production.up.railway.app}"
CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-https://precogs.croutons.ai}"

echo "========== A) Verify Railway App =========="
echo ""

echo "1) Health endpoint (default Railway domain):"
curl -i "${RAILWAY_URL}/health"
echo ""
echo ""

echo "2) Runtime page (should return HTML):"
curl -I "${RAILWAY_URL}/runtime"
echo ""
echo ""

echo "3) Invoke stub endpoint:"
curl -sS "${RAILWAY_URL}/v1/invoke" \
  -H 'content-type: application/json' \
  -d '{"precog":"schema","prompt":"demo","stream":true}' | jq .
echo ""
echo ""

echo "4) Custom domain health (if attached):"
curl -i "${CUSTOM_DOMAIN}/health" || echo "Custom domain not yet attached"
echo ""
echo ""

echo "✅ Verification complete!"
echo ""
echo "Next steps:"
echo "  - If all tests pass, attach custom domain in Railway"
echo "  - Add Redis database"
echo "  - Add Postgres database"
echo "  - Run migrations"

