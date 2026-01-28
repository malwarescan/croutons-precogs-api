#!/bin/bash
# Wait for service to become healthy

echo "Monitoring service health (checking every 15 seconds for up to 5 minutes)..."

for i in $(seq 1 20); do
  sleep 15
  HEALTH=$(curl -s --max-time 3 "https://precogs.croutons.ai/health" 2>/dev/null | jq -r '.ok' 2>/dev/null || echo "false")
  
  if [ "$HEALTH" = "true" ]; then
    echo "✅ Service is HEALTHY after $((i*15)) seconds!"
    exit 0
  fi
  
  echo "[$i/20] Service not ready yet..."
done

echo "⚠️  Service did not become healthy within 5 minutes"
exit 1
