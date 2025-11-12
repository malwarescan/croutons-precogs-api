#!/bin/bash
# Quick monitoring script for deployment verification
# Run this in a separate terminal while deployment is happening

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Deployment Monitoring${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${YELLOW}Opening API logs in 3 seconds...${NC}"
echo "Press Ctrl+C to stop monitoring"
sleep 3

echo ""
echo -e "${GREEN}=== API Logs ===${NC}"
cd ~/Desktop/croutons.ai/precogs/precogs-api
npx railway logs -s precogs-api

