#!/usr/bin/env bash
# Deploy LibreChat alongside the existing Lamoom proxy on Hetzner CAX11.
# Usage: bash infra/librechat/deploy.sh [host]
set -euo pipefail

HOST="${1:-${DEPLOY_HOST:-78.47.152.177}}"
DEPLOY_USER="${DEPLOY_USER:-root}"
REMOTE="${DEPLOY_USER}@${HOST}"
LIBRECHAT_DIR="/opt/librechat"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "── Deploying LibreChat to ${REMOTE}:${LIBRECHAT_DIR} ──"

# 1. Ensure Docker is installed
echo "→ Ensuring Docker is installed..."
ssh "${REMOTE}" bash <<'DOCKER_INSTALL'
set -euo pipefail
if command -v docker &>/dev/null; then
  echo "Docker already installed: $(docker --version)"
else
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "Docker installed: $(docker --version)"
fi
DOCKER_INSTALL

# 2. Create remote directory
echo "→ Creating ${LIBRECHAT_DIR}..."
ssh "${REMOTE}" "install -d -m 0755 '${LIBRECHAT_DIR}'"

# 3. Sync config files
echo "→ Syncing LibreChat config files..."
rsync -az --human-readable \
  "${SCRIPT_DIR}/docker-compose.yml" \
  "${SCRIPT_DIR}/librechat.yaml" \
  "${REMOTE}:${LIBRECHAT_DIR}/"

# 4. Generate secrets if .env doesn't exist on remote, otherwise preserve it
echo "→ Setting up environment..."
ssh "${REMOTE}" bash -s "${LIBRECHAT_DIR}" <<'ENV_SETUP'
set -euo pipefail
LIBRECHAT_DIR="$1"

if [[ -f "${LIBRECHAT_DIR}/.env" ]]; then
  echo ".env already exists — preserving (update manually if needed)"
else
  echo "Generating fresh .env with random secrets..."
  CREDS_KEY=$(openssl rand -hex 32)
  CREDS_IV=$(openssl rand -hex 16)
  JWT_SECRET=$(openssl rand -hex 32)
  JWT_REFRESH_SECRET=$(openssl rand -hex 32)
  LIBRECHAT_API_KEY=$(openssl rand -hex 24)

  cat > "${LIBRECHAT_DIR}/.env" <<EOF
HOST=0.0.0.0
PORT=3080
DOMAIN_CLIENT=https://dev.lamoom.com
DOMAIN_SERVER=https://dev.lamoom.com

MONGO_URI=mongodb://mongodb:27017/LibreChat

CREDS_KEY=${CREDS_KEY}
CREDS_IV=${CREDS_IV}
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}

SESSION_EXPIRY=900000
REFRESH_TOKEN_EXPIRY=604800000

ALLOW_REGISTRATION=true
ALLOW_SOCIAL_LOGIN=false
ALLOW_SOCIAL_REGISTRATION=false
ALLOW_UNVERIFIED_EMAIL_LOGIN=true

LIBRECHAT_API_KEY=${LIBRECHAT_API_KEY}

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_KEY=

DEBUG_LOGGING=true
EOF
  echo "Generated .env with LIBRECHAT_API_KEY=${LIBRECHAT_API_KEY}"
  echo ""
  echo "⚠️  IMPORTANT: Add this to /opt/webagent/.env:"
  echo "   LIBRECHAT_API_KEY=${LIBRECHAT_API_KEY}"
fi
ENV_SETUP

# 5. Pull images and start services
echo "→ Starting LibreChat containers..."
ssh "${REMOTE}" bash -s "${LIBRECHAT_DIR}" <<'START'
set -euo pipefail
cd "$1"
docker compose pull
docker compose up -d
echo "Waiting for services to be healthy..."
sleep 10
docker compose ps
echo ""
echo "LibreChat is running on port 3080"
START

# 6. Update nginx to route /chat to LibreChat
echo "→ Updating nginx for LibreChat routing..."
ssh "${REMOTE}" bash <<'NGINX'
set -euo pipefail
NGINX_CONF="/etc/nginx/sites-enabled/openclaw"

if [[ ! -f "${NGINX_CONF}" ]]; then
  echo "⚠️  Nginx config not found at ${NGINX_CONF} — skipping nginx update"
  exit 0
fi

if grep -q 'location /chat' "${NGINX_CONF}" 2>/dev/null; then
  echo "Nginx already has /chat route — skipping"
  exit 0
fi

# Insert LibreChat proxy block before the closing } of the server block
python3 - "${NGINX_CONF}" <<'PY'
import sys
from pathlib import Path

conf_path = Path(sys.argv[1])
content = conf_path.read_text()

librechat_block = """
    # LibreChat admin chat UI
    location /chat {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
"""

# Find the last closing brace and insert before it
last_brace = content.rfind('}')
if last_brace == -1:
    print("Could not find closing brace in nginx config")
    sys.exit(1)

new_content = content[:last_brace] + librechat_block + "\n" + content[last_brace:]
conf_path.write_text(new_content)
print("Added /chat → LibreChat proxy block to nginx config")
PY

nginx -t && systemctl reload nginx
echo "Nginx reloaded with /chat route"
NGINX

echo ""
echo "✅ LibreChat deployed successfully!"
echo "   URL: https://dev.lamoom.com (LibreChat at :3080 behind nginx)"
echo ""
echo "Next steps:"
echo "  1. Ensure LIBRECHAT_API_KEY matches between /opt/librechat/.env and /opt/webagent/.env"
echo "  2. Register at https://dev.lamoom.com:3080 (or via nginx route)"
echo "  3. Select 'Lamoom Agent Builder' endpoint in LibreChat UI"
echo "  4. Start creating agents via natural language!"
