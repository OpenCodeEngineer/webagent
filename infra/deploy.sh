#!/usr/bin/env bash
set -euo pipefail

# Deploy current LOCAL repo state to the Lamoom VM (not git-pull based).
# Usage: ./infra/deploy.sh [host]

HOST="${1:-${DEPLOY_HOST:-78.47.152.177}}"
DEPLOY_USER="${DEPLOY_USER:-root}"
APP_DIR="${APP_DIR:-/opt/webagent}"
APP_USER="${APP_USER:-openclaw}"
NGINX_SITE_PATH="${NGINX_SITE_PATH:-/etc/nginx/sites-enabled/openclaw}"
SYNC_DELETE="${SYNC_DELETE:-1}"
REMOTE="${DEPLOY_USER}@${HOST}"
SSH_OPTS=(
  -o ServerAliveInterval=20
  -o ServerAliveCountMax=6
  -o TCPKeepAlive=yes
)
RUNTIME_CONFIG_BACKUP="/tmp/webagent-openclaw-runtime.json5"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

run_rsync() {
  local description="$1"
  shift
  local -a args=("$@")

  echo "→ ${description} (attempt 1)..."
  if rsync -e "ssh ${SSH_OPTS[*]}" "${args[@]}"; then
    return 0
  else
    local rc=$?
    echo "⚠️  rsync failed (exit ${rc}); retrying with resilient flags..."
  fi
  sleep 2
  rsync -e "ssh ${SSH_OPTS[*]}" --no-compress --inplace --partial "${args[@]}"
}

if [[ ! -f "${REPO_ROOT}/pnpm-workspace.yaml" ]]; then
  echo "❌ Could not find repo root from ${SCRIPT_DIR}" >&2
  exit 1
fi

for cmd in rsync ssh; do
  if ! command -v "${cmd}" &>/dev/null; then
    echo "❌ Missing required command: ${cmd}" >&2
    exit 1
  fi
done

echo "── Deploying LOCAL repo to ${REMOTE}:${APP_DIR} ──"

echo "→ Preparing remote directory and preserving runtime OpenClaw config..."
ssh "${SSH_OPTS[@]}" "${REMOTE}" "set -euo pipefail; install -d -m 0755 '${APP_DIR}'; \
  if [ -f '${APP_DIR}/openclaw/config/openclaw.json5' ]; then cp '${APP_DIR}/openclaw/config/openclaw.json5' '${RUNTIME_CONFIG_BACKUP}'; fi"

RSYNC_ARGS=(
  -az
  --human-readable
  --exclude '.git/'
  --exclude '.DS_Store'
  --exclude 'node_modules/'
  --exclude '**/node_modules/'
  --exclude '.turbo/'
  --exclude '.next/'
  --exclude '**/.next/'
  --exclude 'dist/'
  --exclude '**/dist/'
  --exclude 'coverage/'
  --exclude 'openclaw/workspaces/'
  --exclude '.env'
)

if [[ "${SYNC_DELETE}" == "1" ]]; then
  RSYNC_ARGS+=(--delete)
fi

run_rsync "Syncing local repo" "${RSYNC_ARGS[@]}" "${REPO_ROOT}/" "${REMOTE}:${APP_DIR}/"

# Preserve runtime-generated meta workspace state on host (.openclaw/workspace-state.json).
run_rsync "Syncing managed OpenClaw workspace(s) from local repo" -az --human-readable --delete \
  --exclude '.openclaw/' \
  "${REPO_ROOT}/openclaw/workspaces/meta/" \
  "${REMOTE}:${APP_DIR}/openclaw/workspaces/meta/"

echo "→ Running remote build/restart/apply steps..."
ssh "${SSH_OPTS[@]}" "${REMOTE}" bash -s "${APP_DIR}" "${RUNTIME_CONFIG_BACKUP}" "${NGINX_SITE_PATH}" "${APP_USER}" <<'REMOTE'
set -euo pipefail
APP_DIR="$1"
RUNTIME_CONFIG_BACKUP="$2"
NGINX_SITE_PATH="$3"
APP_USER="$4"
OVERRIDE_SRC="${APP_DIR}/infra/systemd/openclaw.service.d/override.conf"

cd "${APP_DIR}"

if [[ -f "${RUNTIME_CONFIG_BACKUP}" && -f "${APP_DIR}/openclaw/config/openclaw.json5" ]]; then
  echo "→ Merging runtime-registered OpenClaw agents into synced config..."
  python3 - "${APP_DIR}/openclaw/config/openclaw.json5" "${RUNTIME_CONFIG_BACKUP}" <<'PY'
import json
import re
import sys
from pathlib import Path

git_path = Path(sys.argv[1])
runtime_path = Path(sys.argv[2])

def parse_json5(text: str):
    t = re.sub(r'//.*$', '', text, flags=re.MULTILINE)
    t = re.sub(r'/\*[\s\S]*?\*/', '', t)
    t = re.sub(r',\s*([\]}])', r'\1', t)
    t = re.sub(r'(\{|,)\s*([a-zA-Z_]\w*)\s*:', lambda m: m.group(1) + ' "' + m.group(2) + '":', t)
    return json.loads(t)

try:
    git_cfg = parse_json5(git_path.read_text(encoding="utf-8"))
    runtime_cfg = parse_json5(runtime_path.read_text(encoding="utf-8"))
except Exception as exc:
    print(f"runtime agent merge skipped: {exc}")
    raise SystemExit(0)

git_agents = {a.get("id") for a in git_cfg.get("agents", {}).get("list", []) if isinstance(a, dict)}
runtime_list = runtime_cfg.get("agents", {}).get("list", [])
added = []
for agent in runtime_list:
    if not isinstance(agent, dict):
        continue
    aid = agent.get("id")
    if aid and aid not in git_agents:
        git_cfg.setdefault("agents", {}).setdefault("list", []).append(agent)
        git_agents.add(aid)
        added.append(aid)

if added:
    git_path.write_text(json.dumps(git_cfg, indent=2) + "\n", encoding="utf-8")
    print(f"merged {len(added)} runtime agents")
else:
    print("no runtime agents to merge")
PY
fi
rm -f "${RUNTIME_CONFIG_BACKUP}" || true

echo "→ Fixing ownership..."
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}" 2>/dev/null || true

echo "→ Installing dependencies..."
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && CI=1 pnpm install --frozen-lockfile --prod=false"

echo "→ Cleaning stale tsbuildinfo caches..."
find "${APP_DIR}/packages" -name 'tsconfig.tsbuildinfo' -delete 2>/dev/null || true

echo "→ Building packages..."
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && pnpm build"

echo "→ Applying OpenClaw gateway drop-in override (user-level service)..."
OPENCLAW_USER_UNIT_DIR="/home/${APP_USER}/.config/systemd/user/openclaw-gateway.service.d"
install -d -m 0755 "${OPENCLAW_USER_UNIT_DIR}"
chown "${APP_USER}:${APP_USER}" "${OPENCLAW_USER_UNIT_DIR}"
if [[ -f "${OVERRIDE_SRC}" ]]; then
  sed "s|\${APP_DIR}|${APP_DIR}|g" "${OVERRIDE_SRC}" > "${OPENCLAW_USER_UNIT_DIR}/override.conf"
  chown "${APP_USER}:${APP_USER}" "${OPENCLAW_USER_UNIT_DIR}/override.conf"
else
  echo "⚠️  Missing ${OVERRIDE_SRC} — skipping openclaw-gateway override"
fi

echo "→ Installing WebAgent service units from repo templates..."
for unit in webagent-proxy webagent-admin; do
  unit_src="${APP_DIR}/infra/systemd/${unit}.service"
  unit_dst="/etc/systemd/system/${unit}.service"
  if [[ -f "${unit_src}" ]]; then
    sed -e "s|\${APP_DIR}|${APP_DIR}|g" -e "s|\${APP_USER}|${APP_USER}|g" "${unit_src}" > "${unit_dst}"
  else
    echo "⚠️  Missing ${unit_src} — keeping existing ${unit}.service"
  fi
done

bash "${APP_DIR}/infra/admin-static-sync.sh" sync "${APP_DIR}"

echo "→ Running DB migrations..."
if [[ -f "${APP_DIR}/.env" ]]; then
  sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && set -a && source .env && set +a && pnpm --filter @webagent/proxy db:migrate" \
    || echo "⚠️  DB migration failed (exit $?) — deployment continues but tables may be stale"
else
  echo "⚠️  No .env file at ${APP_DIR}/.env — skipping DB migrations"
fi

NGINX_TEMPLATE="${APP_DIR}/infra/nginx/webagent.conf"
DOMAIN="${DOMAIN:-dev.lamoom.com}"
if [[ -f "${NGINX_TEMPLATE}" ]]; then
  echo "→ Installing nginx config from repo template..."
  sed "s/\${DOMAIN}/${DOMAIN}/g" "${NGINX_TEMPLATE}" > "${NGINX_SITE_PATH}"
  nginx -t
  systemctl reload nginx
else
  echo "⚠️  Missing ${NGINX_TEMPLATE} — skipping nginx config"
fi

echo "→ Restarting services..."
systemctl daemon-reload
# Restart OpenClaw gateway (user-level service)
sudo -u "${APP_USER}" bash -lc "export XDG_RUNTIME_DIR=/run/user/\$(id -u); systemctl --user daemon-reload; systemctl --user restart openclaw-gateway.service" || true
systemctl restart webagent-proxy
systemctl restart webagent-admin
sleep 4

echo "→ Health checks..."
curl -sf http://127.0.0.1:3001/health >/dev/null
curl -sf http://127.0.0.1:3000/ >/dev/null

echo "→ Blocking static asset smoke check..."
bash "${APP_DIR}/infra/admin-static-sync.sh" check http://127.0.0.1:3000

OPENCLAW_HEALTH=""
for _ in $(seq 1 30); do
  OPENCLAW_HEALTH="$(curl -sf http://127.0.0.1:3001/health/openclaw || true)"
  if echo "${OPENCLAW_HEALTH}" | grep -q '"ok"'; then
    break
  fi
  sleep 2
done
echo "${OPENCLAW_HEALTH}"
if ! echo "${OPENCLAW_HEALTH}" | grep -q '"ok"'; then
  echo "❌ OpenClaw health failed"
  exit 1
fi

echo "✅ Remote deploy finished"
REMOTE

echo "── Deploy complete ──"
