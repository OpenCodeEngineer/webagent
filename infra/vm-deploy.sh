#!/usr/bin/env bash
# vm-deploy.sh — single entrypoint for VM deploy operations.
#
# Usage: ./infra/vm-deploy.sh <command> [host]
#
# Commands:
#   deploy           Sync local repo → VM, build, restart services
#   bootstrap        First-time VM setup (packages, nginx, TLS, systemd)
#   bootstrap-deploy bootstrap then deploy
#
# Env vars (all have defaults):
#   DEPLOY_HOST      VM IP or hostname          (default: 78.47.152.177)
#   DEPLOY_USER      SSH user                   (default: root)
#   APP_DIR          App directory on VM        (default: /opt/webagent)
#   APP_USER         OS user that owns the app  (default: openclaw)
#   DOMAIN           Public domain for TLS      (bootstrap, default: webagent.example.com)
#   REPO_URL         Git URL for initial clone  (bootstrap only)
#   NGINX_SITE_PATH  Nginx site config path     (deploy only)
#   SYNC_DELETE      Pass 0 to skip --delete    (default: 1)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CMD="${1:-}"
HOST="${2:-${DEPLOY_HOST:-78.47.152.177}}"
DEPLOY_USER="${DEPLOY_USER:-root}"
APP_DIR="${APP_DIR:-/opt/webagent}"
APP_USER="${APP_USER:-openclaw}"
DOMAIN="${DOMAIN:-webagent.example.com}"
REPO_URL="${REPO_URL:-https://github.com/OpenCodeEngineer/webagent.git}"
NGINX_SITE_PATH="${NGINX_SITE_PATH:-/etc/nginx/sites-enabled/openclaw}"
SYNC_DELETE="${SYNC_DELETE:-1}"
REMOTE="${DEPLOY_USER}@${HOST}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [host]

Commands:
  deploy           Sync local repo to VM, build, restart services
  bootstrap        First-time VM setup (packages, nginx, TLS, systemd)
  bootstrap-deploy Bootstrap then deploy

Args:
  host             VM hostname or IP (overrides \$DEPLOY_HOST)

Env vars:
  DEPLOY_HOST      VM IP/hostname            (default: 78.47.152.177)
  DEPLOY_USER      SSH user                  (default: root)
  APP_DIR          App directory on VM       (default: /opt/webagent)
  APP_USER         OS app user               (default: openclaw)
  DOMAIN           Public domain for TLS     (bootstrap, default: webagent.example.com)
  REPO_URL         Git URL for initial clone (bootstrap only)
  NGINX_SITE_PATH  Nginx site config path    (deploy only)
  SYNC_DELETE      Set 0 to skip --delete    (default: 1)

Examples:
  # Redeploy current VM
  ./infra/vm-deploy.sh deploy

  # Bootstrap + deploy a fresh VM
  DOMAIN=myapp.example.com ./infra/vm-deploy.sh bootstrap-deploy 1.2.3.4

  # Deploy to a different VM
  DEPLOY_USER=ubuntu APP_DIR=/srv/webagent ./infra/vm-deploy.sh deploy staging.example.com
EOF
  exit 1
}

do_deploy() {
  echo "── vm-deploy: deploy → ${REMOTE}:${APP_DIR} ──"
  DEPLOY_HOST="${HOST}" \
  DEPLOY_USER="${DEPLOY_USER}" \
  APP_DIR="${APP_DIR}" \
  NGINX_SITE_PATH="${NGINX_SITE_PATH}" \
  SYNC_DELETE="${SYNC_DELETE}" \
    bash "${SCRIPT_DIR}/deploy.sh" "${HOST}"
}

do_bootstrap() {
  echo "── vm-deploy: bootstrap → ${REMOTE} ──"

  for cmd in rsync ssh; do
    if ! command -v "${cmd}" &>/dev/null; then
      echo "❌ Missing required command: ${cmd}" >&2
      exit 1
    fi
  done

  # Sync infra/ to a temporary directory on the remote so setup.sh can
  # reference its sibling files (nginx/, systemd/, admin-static-sync.sh).
  REMOTE_INFRA="/root/.webagent-bootstrap-infra"
  echo "→ Syncing infra/ to ${REMOTE}:${REMOTE_INFRA} ..."
  rsync -az --delete "${SCRIPT_DIR}/" "${REMOTE}:${REMOTE_INFRA}/"

  echo "→ Running setup.sh on remote (domain=${DOMAIN}, app_dir=${APP_DIR})..."
  ssh "${REMOTE}" \
    REPO_URL="${REPO_URL}" \
    DOMAIN="${DOMAIN}" \
    APP_DIR="${APP_DIR}" \
    APP_USER="${APP_USER}" \
    bash "${REMOTE_INFRA}/setup.sh"

  echo "✅ Bootstrap complete"
}

case "${CMD}" in
  deploy)
    do_deploy
    ;;
  bootstrap)
    do_bootstrap
    ;;
  bootstrap-deploy)
    do_bootstrap
    do_deploy
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    echo "❌ Unknown command: '${CMD}'" >&2
    echo "" >&2
    usage
    ;;
esac
