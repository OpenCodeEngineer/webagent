#!/usr/bin/env bash
# Paperclip orchestration layer — VM setup
# Run AFTER the main infra/setup.sh has completed
# Usage: bash infra/paperclip/setup.sh
set -euo pipefail

PAPERCLIP_USER="${PAPERCLIP_USER:-paperclip}"
PAPERCLIP_DIR="${PAPERCLIP_DIR:-/opt/paperclip}"
PAPERCLIP_DATA="${PAPERCLIP_DATA:-/var/lib/paperclip}"
OPENCLAW_GATEWAY_URL="${OPENCLAW_GATEWAY_URL:-http://localhost:18789}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "── Installing Paperclip orchestration layer ──"

# 1. Create dedicated user
if ! id "${PAPERCLIP_USER}" &>/dev/null; then
  useradd -m -s /bin/bash -d "${PAPERCLIP_DIR}" "${PAPERCLIP_USER}"
fi
mkdir -p "${PAPERCLIP_DATA}"
chown -R "${PAPERCLIP_USER}:${PAPERCLIP_USER}" "${PAPERCLIP_DATA}"

# 2. Ensure Node.js available (should already be from main setup)
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Run infra/setup.sh first."
  exit 1
fi

# 3. Pre-cache the paperclipai package so systemd start is fast
sudo -u "${PAPERCLIP_USER}" bash -c "npx --yes paperclipai --version"

# 4. Write bootstrap adapter config for later API-based setup
cat > "${PAPERCLIP_DATA}/bootstrap-config.json" <<EOF
{
  "defaultAdapter": "openclaw-gateway",
  "adapterConfig": {
    "openclaw-gateway": {
      "gatewayUrl": "${OPENCLAW_GATEWAY_URL}",
      "transport": "http"
    }
  }
}
EOF
chown "${PAPERCLIP_USER}:${PAPERCLIP_USER}" "${PAPERCLIP_DATA}/bootstrap-config.json"

# 5. Install systemd service
#    The service uses `paperclipai run` which handles onboard + doctor + start
#    on first boot automatically.
cp "${SCRIPT_DIR}/paperclip.service" /etc/systemd/system/paperclip.service
sed -i "s|\${PAPERCLIP_DIR}|${PAPERCLIP_DIR}|g" /etc/systemd/system/paperclip.service
sed -i "s|\${PAPERCLIP_USER}|${PAPERCLIP_USER}|g" /etc/systemd/system/paperclip.service
sed -i "s|\${PAPERCLIP_DATA}|${PAPERCLIP_DATA}|g" /etc/systemd/system/paperclip.service

systemctl daemon-reload
systemctl enable --now paperclip

# 6. Wait for Paperclip to be healthy
#    Keep Paperclip loopback-only and access it via SSH tunnel if needed:
#      ssh -L 3100:127.0.0.1:3100 root@<vm>
PAPERCLIP_PORT=3100
echo "Waiting for Paperclip to start (first boot runs migrations)..."
for i in $(seq 1 60); do
  if curl -sf "http://localhost:${PAPERCLIP_PORT}/api/health" >/dev/null 2>&1; then
    echo "✅ Paperclip is running on port ${PAPERCLIP_PORT}"
    exit 0
  fi
  sleep 2
done

echo "⚠ Paperclip did not become healthy within 120s — check: journalctl -u paperclip"
exit 1
