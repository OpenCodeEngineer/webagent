#!/usr/bin/env bash
# Hetzner CAX11 ARM64 – initial server setup
# Usage: bash setup.sh
# Placeholders to replace before running:
#   REPO_URL  – git clone URL (e.g. git@github.com:org/webagent.git)
#   DOMAIN    – public hostname (e.g. webagent.example.com)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/OpenCodeEngineer/webagent.git}"
DOMAIN="${DOMAIN:-webagent.example.com}"
APP_USER="openclaw"
APP_DIR="/home/${APP_USER}/webagent"

# ── 1. System packages ────────────────────────────────────────────────────────
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  curl git unzip ca-certificates gnupg lsb-release \
  nginx certbot python3-certbot-nginx \
  ufw

# ── 2. Node.js 24 (NodeSource) ────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node --version)" != v24* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# ── 3. pnpm (via corepack) ────────────────────────────────────────────────────
corepack enable
corepack prepare pnpm@latest --activate

# ── 4. Application user ───────────────────────────────────────────────────────
# No Docker needed — OpenClaw uses workspace-scoped tool sandboxing (file
# read/write restricted to agent workspace directory, no shell exec).
if ! id "${APP_USER}" &>/dev/null; then
  useradd -m -s /bin/bash "${APP_USER}"
fi

# ── 5. Clone repository ───────────────────────────────────────────────────────
if [[ ! -d "${APP_DIR}/.git" ]]; then
  git clone "${REPO_URL}" "${APP_DIR}"
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
fi

# ── 6. Environment file ───────────────────────────────────────────────────────
if [[ ! -f "${APP_DIR}/.env" && -f "${APP_DIR}/.env.example" ]]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
fi

# ── 7. Install dependencies ───────────────────────────────────────────────────
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && pnpm install --frozen-lockfile"

# ── 7b. Build all packages ────────────────────────────────────────────────────
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && pnpm build"

# ── 7c. Run database migrations ───────────────────────────────────────────────
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && pnpm --filter @webagent/proxy db:migrate"

# ── 8. Nginx configuration ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "${SCRIPT_DIR}/nginx/webagent.conf" /etc/nginx/sites-available/webagent.conf
sed -i "s/\${DOMAIN}/${DOMAIN}/g" /etc/nginx/sites-available/webagent.conf
ln -sf /etc/nginx/sites-available/webagent.conf /etc/nginx/sites-enabled/webagent.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ── 9. SSL certificate (certbot) ──────────────────────────────────────────────
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos \
  --register-unsafely-without-email --redirect

# ── 10. Systemd services ──────────────────────────────────────────────────────
for svc in openclaw-gateway webagent-proxy webagent-admin; do
  cp "${SCRIPT_DIR}/systemd/${svc}.service" /etc/systemd/system/
  sed -i "s|\${APP_DIR}|${APP_DIR}|g" "/etc/systemd/system/${svc}.service"
  sed -i "s|\${APP_USER}|${APP_USER}|g" "/etc/systemd/system/${svc}.service"
done
systemctl daemon-reload
systemctl enable --now openclaw-gateway webagent-proxy webagent-admin

# ── 11. Firewall ──────────────────────────────────────────────────────────────
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ── 12. Sudoers — allow webagent user to restart openclaw-gateway without password ──
# (fallback for when SIGHUP doesn't work)
echo "${APP_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart openclaw-gateway" > /etc/sudoers.d/webagent-openclaw
chmod 440 /etc/sudoers.d/webagent-openclaw

echo "✅  Setup complete. Services running on ${DOMAIN}"
