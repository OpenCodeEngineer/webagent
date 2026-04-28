#!/usr/bin/env bash
# infra/admin-static-sync.sh — Admin Next.js static asset helpers
#
# Subcommands:
#   sync <APP_DIR>                  clean-copy _next/static into standalone bundle
#   check <BASE_URL>                blocking smoke check against a live admin URL
#   sync-and-check <APP_DIR> <URL>  sync then check in one shot
#
# Usage examples:
#   bash infra/admin-static-sync.sh sync /opt/webagent
#   bash infra/admin-static-sync.sh check http://127.0.0.1:3000
#   bash infra/admin-static-sync.sh sync-and-check /opt/webagent http://127.0.0.1:3000
set -euo pipefail

CMD="${1:-}"

_usage() {
  echo "Usage:" >&2
  echo "  $0 sync <APP_DIR>" >&2
  echo "  $0 check <BASE_URL>" >&2
  echo "  $0 sync-and-check <APP_DIR> <BASE_URL>" >&2
  exit 1
}

# ── Static sync ───────────────────────────────────────────────────────────────
# Deterministically clean-copies packages/admin/.next/static into the
# standalone bundle directory so _next/static assets are always in sync.
_sync() {
  local app_dir="${1:?APP_DIR is required}"
  local src="${app_dir}/packages/admin/.next/static"
  local dst="${app_dir}/packages/admin/.next/standalone/packages/admin/.next/static"

  if [[ ! -d "${src}" ]]; then
    echo "❌ Static source not found: ${src}" >&2
    echo "   Hint: run 'pnpm build' before syncing." >&2
    exit 1
  fi

  echo "→ Syncing admin static assets into standalone bundle..."
  rm -rf "${dst}"
  mkdir -p "${dst}"
  cp -R "${src}/." "${dst}/"
  echo "✓ Admin static synced → ${dst}"
}

# ── Static asset smoke check ─────────────────────────────────────────────────
# Fetches /login, extracts real CSS and JS chunk paths from the HTML, then
# asserts both return HTTP 200 and the CSS is at least 1 KB.
_check() {
  local base_url="${1:?BASE_URL is required}"
  base_url="${base_url%/}"  # strip trailing slash

  echo "→ Admin static asset smoke check against ${base_url} ..."

  # 1. Fetch /login HTML
  local login_html
  if ! login_html="$(curl -sf --max-time 15 "${base_url}/login")"; then
    echo "❌ Could not fetch ${base_url}/login (non-200 or connection error)" >&2
    echo "   Hint: ensure webagent-admin is running and reachable." >&2
    exit 1
  fi

  # 2. Extract one CSS path from _next/static/css/
  local css_path
  css_path="$(printf '%s' "${login_html}" \
    | grep -oE '/_next/static/css/[^"]+\.css' | head -1 || true)"
  if [[ -z "${css_path}" ]]; then
    echo "❌ No /_next/static/css/*.css reference found in /login HTML" >&2
    echo "   Hint: re-run 'admin-static-sync.sh sync' then restart webagent-admin." >&2
    exit 1
  fi

  # 3. Extract one JS chunk path from _next/static/chunks/
  local js_path
  js_path="$(printf '%s' "${login_html}" \
    | grep -oE '/_next/static/chunks/[^"]+\.js' | head -1 || true)"
  if [[ -z "${js_path}" ]]; then
    echo "❌ No /_next/static/chunks/*.js reference found in /login HTML" >&2
    echo "   Hint: re-run 'admin-static-sync.sh sync' then restart webagent-admin." >&2
    exit 1
  fi

  # 4. Assert CSS returns HTTP 200
  local css_code
  css_code="$(curl -so /dev/null -w '%{http_code}' --max-time 15 "${base_url}${css_path}")"
  if [[ "${css_code}" != "200" ]]; then
    echo "❌ CSS asset returned HTTP ${css_code}: ${base_url}${css_path}" >&2
    echo "   Hint: static assets are missing from standalone bundle — re-run sync." >&2
    exit 1
  fi

  # 5. Assert CSS size > 1000 bytes (guards against empty/truncated files)
  local css_size
  css_size="$(curl -sf --max-time 15 -o /dev/null -w '%{size_download}' "${base_url}${css_path}")"
  if [[ "${css_size}" -le 1000 ]]; then
    echo "❌ CSS asset too small (${css_size} bytes, expected >1000): ${base_url}${css_path}" >&2
    echo "   Hint: asset may be empty or truncated — rebuild and re-run sync." >&2
    exit 1
  fi

  # 6. Assert JS chunk returns HTTP 200
  local js_code
  js_code="$(curl -so /dev/null -w '%{http_code}' --max-time 15 "${base_url}${js_path}")"
  if [[ "${js_code}" != "200" ]]; then
    echo "❌ JS chunk returned HTTP ${js_code}: ${base_url}${js_path}" >&2
    echo "   Hint: static assets are missing from standalone bundle — re-run sync." >&2
    exit 1
  fi

  echo "✓ CSS : ${css_path} (HTTP 200, ${css_size} bytes)"
  echo "✓ JS  : ${js_path} (HTTP 200)"
  echo "✓ Admin static asset smoke check passed"
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "${CMD}" in
  sync)
    _sync "${2:?APP_DIR required for sync}"
    ;;
  check)
    _check "${2:?BASE_URL required for check}"
    ;;
  sync-and-check)
    _sync  "${2:?APP_DIR required for sync-and-check}"
    _check "${3:?BASE_URL required for sync-and-check}"
    ;;
  *)
    _usage
    ;;
esac
