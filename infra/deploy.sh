#!/usr/bin/env bash
set -euo pipefail

# Deploy current LOCAL repo state to the Lamoom VM (not git-pull based).
# Usage: ./infra/deploy.sh [host]

HOST="${1:-${DEPLOY_HOST:-78.47.152.177}}"
DEPLOY_USER="${DEPLOY_USER:-root}"
APP_DIR="${APP_DIR:-/opt/webagent}"
NGINX_SITE_PATH="${NGINX_SITE_PATH:-/etc/nginx/sites-enabled/openclaw}"
SYNC_DELETE="${SYNC_DELETE:-1}"
REMOTE="${DEPLOY_USER}@${HOST}"
RUNTIME_CONFIG_BACKUP="/tmp/webagent-openclaw-runtime.json5"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

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
ssh "${REMOTE}" "set -euo pipefail; install -d -m 0755 '${APP_DIR}'; \
  if [ -f '${APP_DIR}/openclaw/openclaw.json5' ]; then cp '${APP_DIR}/openclaw/openclaw.json5' '${RUNTIME_CONFIG_BACKUP}'; fi"

echo "→ Syncing local repo (including openclaw config and agent files)..."
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
  --exclude 'openclaw/workspace/'
  --exclude '.env'
)

if [[ "${SYNC_DELETE}" == "1" ]]; then
  RSYNC_ARGS+=(--delete)
fi

rsync "${RSYNC_ARGS[@]}" "${REPO_ROOT}/" "${REMOTE}:${APP_DIR}/"

echo "→ Syncing managed OpenClaw workspace from local repo..."
rsync -az --human-readable --delete \
  "${REPO_ROOT}/openclaw/workspace/" \
  "${REMOTE}:${APP_DIR}/openclaw/workspace/"

echo "→ Running remote build/restart/apply steps..."
ssh "${REMOTE}" bash -s "${APP_DIR}" "${RUNTIME_CONFIG_BACKUP}" "${NGINX_SITE_PATH}" <<'REMOTE'
set -euo pipefail
APP_DIR="$1"
RUNTIME_CONFIG_BACKUP="$2"
NGINX_SITE_PATH="$3"

cd "${APP_DIR}"

if [[ -f "${RUNTIME_CONFIG_BACKUP}" && -f "${APP_DIR}/openclaw/openclaw.json5" ]]; then
  echo "→ Merging runtime-registered OpenClaw agents into synced config..."
  python3 - "${APP_DIR}/openclaw/openclaw.json5" "${RUNTIME_CONFIG_BACKUP}" <<'PY'
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
chown -R openclaw:openclaw "${APP_DIR}" 2>/dev/null || true

echo "→ Installing dependencies..."
sudo -u openclaw bash -lc "cd '${APP_DIR}' && CI=1 pnpm install --frozen-lockfile --prod=false"

echo "→ Cleaning stale tsbuildinfo caches..."
find "${APP_DIR}/packages" -name 'tsconfig.tsbuildinfo' -delete 2>/dev/null || true

echo "→ Building packages..."
sudo -u openclaw bash -lc "cd '${APP_DIR}' && pnpm build"

bash "${APP_DIR}/infra/admin-static-sync.sh" sync "${APP_DIR}"

echo "→ Running DB migrations..."
if [[ -f "${APP_DIR}/.env" ]]; then
  sudo -u openclaw bash -lc "cd '${APP_DIR}' && set -a && source .env && set +a && pnpm --filter @webagent/proxy db:migrate" \
    || echo "⚠️  DB migration failed (exit $?) — deployment continues but tables may be stale"
else
  echo "⚠️  No .env file at ${APP_DIR}/.env — skipping DB migrations"
fi

if [[ -f "${NGINX_SITE_PATH}" ]]; then
  echo "→ Ensuring nginx /api auth routing + long-running API timeouts..."
  python3 - "${NGINX_SITE_PATH}" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
lines = text.splitlines()

api_idx = None
for i, line in enumerate(lines):
    if re.search(r'^\s*location\s+/api/?\s*\{', line):
        api_idx = i
        break

if api_idx is not None:
    api_end = None
    for j in range(api_idx + 1, len(lines)):
        if lines[j].strip() == "}":
            api_end = j
            break
    if api_end is not None:
        block = lines[api_idx:api_end + 1]
        has_read = any("proxy_read_timeout" in line for line in block)
        has_send = any("proxy_send_timeout" in line for line in block)
        insert_at = api_end
        if not has_read:
            lines.insert(insert_at, "        proxy_read_timeout 300s;")
            insert_at += 1
            api_end += 1
        if not has_send:
            lines.insert(insert_at, "        proxy_send_timeout 300s;")
            api_end += 1

if "location /api/auth/" not in "\n".join(lines):
    admin_upstream = "admin_frontend" if "upstream admin_frontend" in text else "admin_upstream"
    auth_block = [
        "    # NextAuth routes -> Admin (inserted by infra/deploy.sh)",
        "    location /api/auth/ {",
        f"        proxy_pass http://{admin_upstream};",
        "        proxy_http_version 1.1;",
        "        proxy_set_header Host $host;",
        "        proxy_set_header X-Real-IP $remote_addr;",
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
        "        proxy_set_header X-Forwarded-Proto $scheme;",
        "    }",
        "",
    ]
    insert_pos = 0
    for i, line in enumerate(lines):
        if re.search(r'^\s*location\s+/api/?\s*\{', line):
            insert_pos = i
            break
    lines[insert_pos:insert_pos] = auth_block

if "location /sso/" not in "\n".join(lines):
    proxy_upstream = "proxy_upstream"
    sso_block = [
        "    # SSO / identity routes (inserted by infra/deploy.sh)",
        "    location /sso/ {",
        f"        proxy_pass http://{proxy_upstream};",
        "        proxy_read_timeout 300s;",
        "        proxy_send_timeout 300s;",
        "        proxy_buffering on;",
        "        limit_req zone=api_limit burst=60 nodelay;",
        "        limit_req_status 429;",
        "    }",
        "",
    ]
    insert_pos = len(lines)
    for i, line in enumerate(lines):
        if re.search(r'^\s*location\s+/\s*\{', line):
            insert_pos = i
            break
    lines[insert_pos:insert_pos] = sso_block

new_text = "\n".join(lines) + "\n"
if new_text != text:
    path.write_text(new_text, encoding="utf-8")
PY
  nginx -t
  systemctl reload nginx
fi

echo "→ Restarting services..."
systemctl restart openclaw-gateway || true
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
