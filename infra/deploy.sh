#!/usr/bin/env bash
set -euo pipefail

# Deploy latest code to the Lamoom VM
# Usage: ./infra/deploy.sh [host]

HOST="${1:-78.47.152.177}"
APP_DIR="/opt/webagent"

echo "── Deploying to ${HOST} ──"

ssh "root@${HOST}" bash -s "${APP_DIR}" <<'REMOTE'
set -euo pipefail
APP_DIR="$1"
cd "${APP_DIR}"

echo "→ Pulling latest code..."
git pull origin main

echo "→ Installing dependencies..."
sudo -u openclaw bash -c "cd ${APP_DIR} && pnpm install --frozen-lockfile"

echo "→ Building all packages..."
sudo -u openclaw bash -c "cd ${APP_DIR} && pnpm build"

echo "→ Copying Next.js static assets to standalone..."
cp -r "${APP_DIR}/packages/admin/.next/static" \
      "${APP_DIR}/packages/admin/.next/standalone/packages/admin/.next/static"

echo "→ Running database migrations..."
sudo -u openclaw bash -c "cd ${APP_DIR} && pnpm --filter @webagent/proxy db:migrate" || true

echo "→ Restarting services..."
systemctl restart webagent-proxy
systemctl restart webagent-admin

echo "→ Waiting for services..."
sleep 5

echo "→ Service status:"
systemctl is-active webagent-proxy && echo "  proxy: running" || echo "  proxy: FAILED"
systemctl is-active webagent-admin && echo "  admin: running" || echo "  admin: FAILED"

echo "→ Health check:"
curl -s http://127.0.0.1:3001/health || echo "  proxy health: FAILED"
echo ""
curl -s http://127.0.0.1:3000/ -o /dev/null -w "  admin HTTP: %{http_code}\n" || echo "  admin: FAILED"

echo "── Deploy complete ──"
REMOTE
