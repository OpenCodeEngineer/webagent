#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://openclaw.vibebrowser.app}"
AUTH="${AUTH:-${API_KEY:-${TOKEN:-}}}"
CUSTOMER_ID="${CUSTOMER_ID:-eval-customer}"
TARGET_URL="${TARGET_URL:-https://openclaw.vibebrowser.app/console/}"
TARGET_NAME="${TARGET_NAME:-OpenClaw Console}"
EVAL_ENDPOINT="${EVAL_ENDPOINT:-${BASE_URL%/}/api/v1/tenants/specialists}"
DRY_RUN="${DRY_RUN:-0}"

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1 && ! command -v node >/dev/null 2>&1; then
  echo "error: python3 or node is required" >&2
  exit 2
fi

# Each test case: "question|expected1,expected2,..."
# Expected substrings are checked case-insensitively against the agent response.
test_cases=(
  "How do I list all tenants via the API?|GET,/api/v1/tenants"
  "What endpoint creates a new tenant?|POST,/api/v1/tenants"
  "How do I restart a tenant?|POST,/tenants/:id/restart"
  "What HTTP method is used to delete a tenant?|DELETE,/api/v1/tenants/:id"
  "How do I check my current billing balance?|GET,/api/v1/billing"
  "What endpoint do I call to top up credits with crypto?|POST,/api/v1/billing/topup/crypto"
  "How do I list available specialist presets?|GET,/api/v1/tenants/specialists"
  "How do I authenticate to the API?|POST,/api/v1/auth/login,Bearer"
)

ask_live() {
  local prompt="$1"
  local payload
  payload=$(cat <<JSON
{"customerId":"$CUSTOMER_ID","customer_id":"$CUSTOMER_ID","targetUrl":"$TARGET_URL","target_url":"$TARGET_URL","targetName":"$TARGET_NAME","target_name":"$TARGET_NAME","prompt":"$prompt","message":"$prompt"}
JSON
)
  curl -fsSL "$EVAL_ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH" \
    --data "$payload"
}

extract_answer() {
  local raw="$1"
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$raw" | python3 - <<'PY'
import json, sys
s = sys.stdin.read().strip()
if not s:
    print("")
    raise SystemExit(0)
try:
    obj = json.loads(s)
except Exception:
    print(s)
    raise SystemExit(0)

preferred = ["answer","response","message","content","text","output"]

def pull(v):
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, dict):
        for k in preferred:
            if isinstance(v.get(k), str) and v.get(k).strip():
                return v[k].strip()
        for x in v.values():
            out = pull(x)
            if out:
                return out
    if isinstance(v, list):
        for x in v:
            out = pull(x)
            if out:
                return out
    return ""

print(pull(obj))
PY
  else
    printf '%s' "$raw" | node -e "const fs=require('fs');const s=fs.readFileSync(0,'utf8').trim();if(!s){console.log('');process.exit(0)};let o;try{o=JSON.parse(s)}catch{console.log(s);process.exit(0)};const pref=['answer','response','message','content','text','output'];function pull(v){if(typeof v==='string'&&v.trim())return v.trim();if(Array.isArray(v)){for(const x of v){const r=pull(x);if(r)return r}}else if(v&&typeof v==='object'){for(const k of pref){if(typeof v[k]==='string'&&v[k].trim())return v[k].trim()}for(const x of Object.values(v)){const r=pull(x);if(r)return r}}return ''};console.log(pull(o));"
  fi
}

# Dry-run canned responses keyed by substring of the question
dry_run_answer() {
  local prompt="$1"
  case "$prompt" in
    *"list all tenants"*)
      echo "To list all tenants, send a GET request to /api/v1/tenants with your Bearer token in the Authorization header. The response is a JSON array of tenant objects." ;;
    *"creates a new tenant"*)
      echo "To create a new tenant, POST to /api/v1/tenants with a JSON body containing planId, tenantType, and hostType. Example: POST /api/v1/tenants {planId: 'starter', tenantType: 'personal', hostType: 'container'}." ;;
    *"restart a tenant"*)
      echo "To restart a tenant, send POST /api/v1/tenants/:id/restart with your Bearer token. No request body is required. The server will acknowledge the restart." ;;
    *"delete a tenant"*)
      echo "To delete a tenant, use DELETE /api/v1/tenants/:id with your Authorization: Bearer token. This will begin the deletion process and the tenant status will transition to 'deleting'." ;;
    *"billing balance"*)
      echo "To check your billing balance, call GET /api/v1/billing. The response includes your subscription details, budget (total, spent, remaining), available credit packs, and payment history." ;;
    *"top up credits with crypto"*)
      echo "To top up with crypto, POST to /api/v1/billing/topup/crypto with {packId} in the body. You'll receive a {checkoutUrl} to complete payment. Requires Bearer auth." ;;
    *"specialist presets"*)
      echo "To list available specialists, send GET /api/v1/tenants/specialists. The response is {specialists: [{id, label, description}]}. Use these IDs when installing specialists via POST /api/v1/tenants/:id/specialists/install." ;;
    *"authenticate"*)
      echo "Authenticate by sending POST /api/v1/auth/login with your provider credentials. Supported providers: telegram, google, email_password. After login, use the returned token as Bearer in the Authorization header for all subsequent requests." ;;
    *)
      echo "I can help with OpenClaw Console API questions." ;;
  esac
}

check_substrings() {
  local answer="$1"
  local expected="$2"
  local answer_lower
  answer_lower="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"

  IFS=',' read -ra parts <<< "$expected"
  local missing=()
  for part in "${parts[@]}"; do
    local part_lower
    part_lower="$(printf '%s' "$part" | tr '[:upper:]' '[:lower:]')"
    if [[ "$answer_lower" != *"$part_lower"* ]]; then
      missing+=("$part")
    fi
  done

  if [[ ${#missing[@]} -eq 0 ]]; then
    echo "PASS|"
  else
    echo "FAIL|missing: ${missing[*]}"
  fi
}

if [[ "$DRY_RUN" != "1" && -z "$AUTH" ]]; then
  echo "error: AUTH (or API_KEY/TOKEN) is required unless --dry-run is used" >&2
  exit 2
fi

printf 'EVAL target=%s endpoint=%s mode=%s cases=%d\n' "$TARGET_URL" "$EVAL_ENDPOINT" "$([[ "$DRY_RUN" == "1" ]] && echo dry-run || echo live)" "${#test_cases[@]}"

passed=0
failed=0
total=${#test_cases[@]}

for tc in "${test_cases[@]}"; do
  question="${tc%%|*}"
  expected="${tc#*|}"

  if [[ "$DRY_RUN" == "1" ]]; then
    answer="$(dry_run_answer "$question")"
  else
    raw="$(ask_live "$question")"
    answer="$(extract_answer "$raw")"
  fi

  result="$(check_substrings "$answer" "$expected")"
  verdict="${result%%|*}"
  detail="${result#*|}"

  if [[ "$verdict" == "PASS" ]]; then
    passed=$((passed + 1))
    printf '[PASS] %s\n' "$question"
  else
    failed=$((failed + 1))
    printf '[FAIL] %s — %s\n' "$question" "$detail"
  fi
done

printf '\n%d/%d passed\n' "$passed" "$total"

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
exit 0
