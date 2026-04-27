#!/usr/bin/env bash
set -euo pipefail

TARGET_URL="${1:-${TARGET_URL:-https://openclaw.vibebrowser.app/console/}}"
OUTPUT_FILE="${2:-${OUTPUT_FILE:-}}"
WORK_FILE=".agents/skills/openclaw-console-agent-bootstrap/scripts/.extract-console-api.$$"

cleanup() {
  rm -f "$WORK_FILE"
}
trap cleanup EXIT

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1 && ! command -v node >/dev/null 2>&1; then
  echo "error: python3 or node is required" >&2
  exit 2
fi

HTML="$(curl -fsSL "$TARGET_URL")"
printf '%s\n' "$HTML" > "$WORK_FILE"

SCRIPT_URLS=""
if command -v python3 >/dev/null 2>&1; then
  SCRIPT_URLS="$(printf '%s' "$HTML" | python3 - "$TARGET_URL" <<'PY'
import re, sys
from urllib.parse import urljoin
base = sys.argv[1]
html = sys.stdin.read()
seen = set()
for src in re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html, flags=re.I):
    if src.endswith('.js') or '.js?' in src or '/_next/' in src or '/assets/' in src:
        full = urljoin(base, src)
        if full not in seen:
            seen.add(full)
            print(full)
PY
)"
else
  SCRIPT_URLS="$(printf '%s' "$HTML" | node -e "const fs=require('fs');const {URL}=require('url');const base=process.argv[1];const html=fs.readFileSync(0,'utf8');const rx=/<script[^>]+src=[\"']([^\"']+)[\"']/ig;const out=new Set();let m;while((m=rx.exec(html))){const s=m[1];if(s.endsWith('.js')||s.includes('.js?')||s.includes('/_next/')||s.includes('/assets/')){out.add(new URL(s,base).toString())}};console.log([...out].join('\n'));" "$TARGET_URL")"
fi

chunk_count=0
if [[ -n "$SCRIPT_URLS" ]]; then
  while IFS= read -r js_url; do
    [[ -z "$js_url" ]] && continue
    if js_body="$(curl -fsSL "$js_url" 2>/dev/null)"; then
      chunk_count=$((chunk_count + 1))
      printf '\n/* SOURCE: %s */\n%s\n' "$js_url" "$js_body" >> "$WORK_FILE"
    fi
  done <<< "$SCRIPT_URLS"
fi

if command -v python3 >/dev/null 2>&1; then
  endpoints="$(python3 - "$WORK_FILE" <<'PY'
import re, sys
text = open(sys.argv[1], 'r', encoding='utf-8', errors='ignore').read()
items = sorted(set(re.findall(r'/api/v1/[A-Za-z0-9_\-./]*', text)))
for i in items:
    print(i)
PY
)"
else
  endpoints="$(node -e "const fs=require('fs');const t=fs.readFileSync(process.argv[1],'utf8');const m=t.match(/\\/api\\/v1\\/[A-Za-z0-9_\\-./]*/g)||[];console.log([...new Set(m)].sort().join('\\n'));" "$WORK_FILE")"
fi

endpoint_count="$(printf '%s\n' "$endpoints" | sed '/^$/d' | wc -l | tr -d ' ')"
report=$(cat <<REPORT
# OpenClaw Console API Extraction
target_url: $TARGET_URL
js_chunks_downloaded: $chunk_count
endpoints_found: $endpoint_count
$(if [[ "$endpoint_count" != "0" ]]; then printf '%s\n' "$endpoints"; else echo "(none)"; fi)
REPORT
)

if [[ -n "$OUTPUT_FILE" ]]; then
  printf '%s\n' "$report" > "$OUTPUT_FILE"
  echo "$OUTPUT_FILE"
else
  printf '%s\n' "$report"
fi
