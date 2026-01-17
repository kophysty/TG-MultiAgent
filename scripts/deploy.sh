#!/bin/bash
#
# deploy.sh - Automated deployment script for TG-MultiAgent
#
# Usage: ./scripts/deploy.sh [--skip-push] [--only-bot]
#
# Options:
#   --skip-push   Skip git push (useful if already pushed)
#   --only-bot    Only rebuild todo_bot (faster for bot-only changes)
#

set -e

# Configuration
SSH_KEY="$HOME/.ssh/tg_multiagent_deploy"
SERVER_HOST="45.80.70.145"
SERVER_USER="root"
REMOTE_DIR="/root/TG-MultiAgent"
COMPOSE_FILE="infra/docker-compose.prod.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
SKIP_PUSH=false
ONLY_BOT=false

for arg in "$@"; do
  case $arg in
    --skip-push)
      SKIP_PUSH=true
      ;;
    --only-bot)
      ONLY_BOT=true
      ;;
  esac
done

echo -e "${GREEN}=== TG-MultiAgent Deploy ===${NC}"

# Step 1: Check for uncommitted changes
echo -e "\n${YELLOW}[1/4] Checking git status...${NC}"
if [[ -n $(git status --porcelain) ]]; then
  echo -e "${RED}ERROR: Uncommitted changes detected.${NC}"
  echo "Please commit your changes first or stash them."
  git status --short
  exit 1
fi

# Step 2: Push to GitHub
if [ "$SKIP_PUSH" = false ]; then
  echo -e "\n${YELLOW}[2/4] Pushing to GitHub...${NC}"
  git push origin main
else
  echo -e "\n${YELLOW}[2/4] Skipping push (--skip-push)${NC}"
fi

# Step 3: Connect to server and update
echo -e "\n${YELLOW}[3/4] Updating server...${NC}"

SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_HOST"

$SSH_CMD << 'REMOTE_SCRIPT'
set -e
cd /root/TG-MultiAgent

echo "Pulling latest changes..."
git pull origin main

echo "Current version:"
cat apps/todo_bot/package.json | grep version
REMOTE_SCRIPT

# Step 4: Rebuild and restart containers
echo -e "\n${YELLOW}[4/4] Rebuilding containers...${NC}"

if [ "$ONLY_BOT" = true ]; then
  SERVICES="todo_bot"
else
  SERVICES="todo_bot reminders_worker"
fi

$SSH_CMD << REMOTE_SCRIPT
set -e
cd /root/TG-MultiAgent

echo "Rebuilding services: $SERVICES"
docker compose -f $COMPOSE_FILE up -d --build $SERVICES

echo ""
echo "Container status:"
docker compose -f $COMPOSE_FILE ps

echo ""
echo "Recent logs (last 10 lines):"
docker compose -f $COMPOSE_FILE logs --tail=10 todo_bot
REMOTE_SCRIPT

echo -e "\n${GREEN}=== Deploy complete ===${NC}"
