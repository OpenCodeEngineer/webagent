#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://openclaw.vibebrowser.app}"
AUTH="${AUTH:-${API_KEY:-${TOKEN:-}}}"
CUSTOMER_ID="${CUSTOMER_ID:-eval-customer}"
TARGET_URL="${TARGET_URL:-https://openclaw.vibebrowser.app/console/}"
TARGET_NAME="${TARGET_NAME:-OpenClaw Console}"
EVAL_ENDPOINT="${EVAL_ENDPOINT:-${BASE_URL%/}/api/v1/tenants/specialists}"
MIN_SCORE="${MIN_SCORE:-3}"
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

prompts=(
  "how to use console"
  "how billing works"
  "how to deploy"
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

score_answer() {
  local prompt="$1"
  local answer="$2"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$prompt" "$answer" "$TARGET_URL" "$MIN_SCORE" <<'PY'
import re, sys
prompt, answer, target_url, min_score = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
a = answer.lower()
score = 0
notes = []

if any(x in a for x in ["go to", "open", "click", "navigate", "visit", "settings", "dashboard", "menu"]):
    score += 1
else:
    notes.append("missing_navigation_verbs")

if re.search(r'https?://|/console|/billing|/plans|/tenants', a):
    score += 1
else:
    notes.append("missing_link_or_route")

if len(answer.split()) <= 180 and len(answer.split()) >= 15:
    score += 1
else:
    notes.append("length_out_of_range")

if prompt == "how to use console":
    if ("console" in a) and any(x in a for x in ["dashboard", "tenant", "settings", "agent", "navigation"]):
        score += 2
    else:
        notes.append("weak_console_coverage")
elif prompt == "how billing works":
    if ("billing" in a) and any(x in a for x in ["topup", "top up", "plan", "payment", "invoice", "crypto"]):
        score += 2
    else:
        notes.append("weak_billing_coverage")
elif prompt == "how to deploy":
    if any(x in a for x in ["deploy", "deployment"]) and any(x in a for x in ["step", "command", "environment", "configure", "publish"]):
        score += 2
    else:
        notes.append("weak_deploy_coverage")

passed = score >= min_score
print(f"{score}|{'PASS' if passed else 'FAIL'}|{','.join(notes) if notes else 'ok'}")
PY
  else
    node -e "const [prompt,answer,targetUrl,minScore]=process.argv.slice(1);const a=answer.toLowerCase();let score=0;const notes=[];if(['go to','open','click','navigate','visit','settings','dashboard','menu'].some(x=>a.includes(x)))score++;else notes.push('missing_navigation_verbs');if(/https?:\\/\\/|\\/console|\\/billing|\\/plans|\\/tenants/.test(a))score++;else notes.push('missing_link_or_route');const wc=answer.trim().split(/\\s+/).filter(Boolean).length;if(wc<=180&&wc>=15)score++;else notes.push('length_out_of_range');if(prompt==='how to use console'){if(a.includes('console')&&['dashboard','tenant','settings','agent','navigation'].some(x=>a.includes(x)))score+=2;else notes.push('weak_console_coverage')}if(prompt==='how billing works'){if(a.includes('billing')&&['topup','top up','plan','payment','invoice','crypto'].some(x=>a.includes(x)))score+=2;else notes.push('weak_billing_coverage')}if(prompt==='how to deploy'){if(['deploy','deployment'].some(x=>a.includes(x))&&['step','command','environment','configure','publish'].some(x=>a.includes(x)))score+=2;else notes.push('weak_deploy_coverage')}const passed=score>=Number(minScore);console.log(`${score}|${passed?'PASS':'FAIL'}|${notes.length?notes.join(','):'ok'}`);" "$prompt" "$answer" "$target_url" "$MIN_SCORE"
  fi
}

if [[ "$DRY_RUN" != "1" && -z "$AUTH" ]]; then
  echo "error: AUTH (or API_KEY/TOKEN) is required unless --dry-run is used" >&2
  exit 2
fi

printf 'EVAL target=%s endpoint=%s mode=%s threshold=%s\n' "$TARGET_URL" "$EVAL_ENDPOINT" "$([[ "$DRY_RUN" == "1" ]] && echo dry-run || echo live)" "$MIN_SCORE"

failures=0
for prompt in "${prompts[@]}"; do
  if [[ "$DRY_RUN" == "1" ]]; then
    case "$prompt" in
      "how to use console")
        answer="Open the OpenClaw Console at $TARGET_URL, go to the dashboard, then use the left menu to navigate tenants, specialists, billing, and settings. Click each section to review status and use the search/filter controls for faster navigation." ;;
      "how billing works")
        answer="In OpenClaw Console, open /billing to review current balance and plan details, then use /billing/topup or /billing/topup/crypto to add credits. Check plans before upgrades and confirm payment status from the billing history." ;;
      "how to deploy")
        answer="To deploy, open console settings, verify tenant configuration, run your deployment command in CI, then return to the dashboard to validate health. Use the console links and environment settings before publish, and confirm rollout in tenants overview." ;;
    esac
  else
    raw="$(ask_live "$prompt")"
    answer="$(extract_answer "$raw")"
  fi

  result="$(score_answer "$prompt" "$answer")"
  score="${result%%|*}"
  rem="${result#*|}"
  verdict="${rem%%|*}"
  notes="${result##*|}"

  printf '[%s] score=%s verdict=%s notes=%s\n' "$prompt" "$score" "$verdict" "$notes"
  if [[ "$verdict" != "PASS" ]]; then
    failures=$((failures + 1))
  fi
done

if [[ "$failures" -gt 0 ]]; then
  echo "EVAL_RESULT=FAIL failed_checks=$failures" >&2
  exit 1
fi

echo "EVAL_RESULT=PASS"
