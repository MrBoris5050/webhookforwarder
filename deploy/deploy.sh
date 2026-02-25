#!/usr/bin/env bash
# Run this script on the VPS from the project root to deploy/update the app.
# Usage: ./deploy/deploy.sh   or   npm run deploy

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

echo "==> Deploying from $APP_DIR"

if [ -d .git ]; then
  echo "==> Pulling latest..."
  git pull
else
  echo "==> Not a git repo, skipping pull."
fi

echo "==> Installing dependencies..."
npm install --production

echo "==> Restarting app..."
if pm2 describe webhook-forwarder &>/dev/null; then
  pm2 restart webhook-forwarder
else
  pm2 start src/index.js --name webhook-forwarder
fi
pm2 save

echo "==> Done."
pm2 status webhook-forwarder
