#!/usr/bin/env bash
# =============================================================================
# Lamoom Platform — Full E2E Flow Test
#
# Tests the COMPLETE product flow at the protocol level:
#   Health → Agent Creation via Meta-Agent → Agent Verification → Widget Chat (WS)
#
# Usage:
#   ./test-e2e-full.sh [BASE_URL] [AUTH_SECRET]
#
# Environment variables:
#   PROXY_URL / BASE_URL        — defaults to https://dev.lamoom.com
#   PROXY_INTERNAL_SECRET       — preferred secret for customer HMAC auth
#   PROXY_API_TOKEN             — fallback secret for customer HMAC auth
#   TEST_CUSTOMER_ID            — UUID for the test customer (auto-generated)
#   OPENCLAW_WORKSPACES_DIR     — if set, checks workspace files on disk
# =============================================================================
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
BASE_URL="${1:-${PROXY_URL:-${BASE_URL:-https://dev.lamoom.com}}}"
AUTH_SECRET="${2:-${PROXY_INTERNAL_SECRET:-${PROXY_API_TOKEN:-}}}"
DEFAULT_TEST_CUSTOMER_ID="00000000-0000-4000-8000-000000000001"
CUSTOMER_ID="${TEST_CUSTOMER_ID:-$DEFAULT_TEST_CUSTOMER_ID}"
WORKSPACES_DIR="${OPENCLAW_WORKSPACES_DIR:-}"

# Strip trailing slash
BASE_URL="${BASE_URL%/}"

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ── Counters ─────────────────────────────────────────────────────────────────
PASSED=0; FAILED=0; SKIPPED=0

# ── Helpers ──────────────────────────────────────────────────────────────────
log()  { echo -e "$*" >&2; }
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; (( ++PASSED )); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1 — $2"; (( ++FAILED )); }
skip() { echo -e "${YELLOW}○ SKIP${NC}: $1 — $2"; (( ++SKIPPED )); }

banner() {
  echo ""
  echo -e "${CYAN}${BOLD}═══ $1 ═══${NC}"
}

json_field() {
  # Extract a top-level or nested field from JSON. Uses python if available, else node.
  local json="$1" path="$2"
  if command -v python3 &>/dev/null; then
    python3 -c "
import json, sys
try:
    d = json.loads(sys.argv[1])
    keys = sys.argv[2].split('.')
    for k in keys:
        if isinstance(d, dict):
            d = d.get(k)
        else:
            d = None
            break
    if d is not None:
        print(d if isinstance(d, str) else json.dumps(d))
except Exception:
    pass
" "$json" "$path" 2>/dev/null
  else
    node -e "
try {
  let d = JSON.parse(process.argv[1]);
  for (const k of process.argv[2].split('.')) { d = d?.[k]; }
  if (d !== undefined && d !== null) console.log(typeof d === 'string' ? d : JSON.stringify(d));
} catch {}
" "$json" "$path" 2>/dev/null
  fi
}

hmac_sha256_hex() {
  local payload="$1"
  if command -v openssl &>/dev/null; then
    printf '%s' "$payload" | openssl dgst -sha256 -hmac "$AUTH_SECRET" -r 2>/dev/null | awk '{print $1}'
  elif command -v python3 &>/dev/null; then
    python3 -c "
import hmac, hashlib, sys
print(hmac.new(sys.argv[1].encode(), sys.argv[2].encode(), hashlib.sha256).hexdigest())
" "$AUTH_SECRET" "$payload" 2>/dev/null
  else
    node -e "
const crypto = require('crypto');
console.log(crypto.createHmac('sha256', process.argv[1]).update(process.argv[2]).digest('hex'));
" "$AUTH_SECRET" "$payload" 2>/dev/null
  fi
}

customer_sig_for() {
  local customer_id="$1"
  local timestamp sig
  timestamp=$(date +%s)
  sig=$(hmac_sha256_hex "${customer_id}:${timestamp}") || return 1
  if [[ -z "$sig" ]]; then
    return 1
  fi
  printf '%s:%s' "$sig" "$timestamp"
}

extract_agent_slug_marker() {
  local response_text="$1"
  local normalized="${response_text//</}"
  normalized="${normalized//>/}"
  if [[ "$normalized" =~ \[AGENT_CREATED::[[:space:]]*([a-zA-Z0-9_-]+)[[:space:]]*\] ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# ── Pre-flight ───────────────────────────────────────────────────────────────
echo -e "${BOLD}Lamoom E2E Full Flow Test${NC}"
echo "──────────────────────────────────────────"
echo "  Base URL:    $BASE_URL"
echo "  Customer ID: $CUSTOMER_ID"
echo "  Auth Secret: ${AUTH_SECRET:+${AUTH_SECRET:0:8}…(set)}${AUTH_SECRET:-MISSING}"
echo "  Workspaces:  ${WORKSPACES_DIR:-not set}"
echo "──────────────────────────────────────────"

if [[ -z "$AUTH_SECRET" ]]; then
  echo -e "${RED}ERROR: PROXY_INTERNAL_SECRET or PROXY_API_TOKEN is required.${NC}" >&2
  echo "  Set it via env var or pass as the second argument." >&2
  exit 2
fi

# Shared state (flows between tests)
SESSION_ID=""
AGENT_SLUG=""
REQUESTED_AGENT_SLUG=""
EMBED_TOKEN=""
EMBED_CODE=""
AGENT_ID=""
PHASE2_OK=false
PHASE3_OK=false

###############################################################################
# PHASE 1 — Infrastructure Health
###############################################################################
banner "Phase 1: Infrastructure Health"

# ── Test 1: GET /health ──────────────────────────────────────────────────────
test_health() {
  local resp http_code body
  resp=$(curl -sk -w "\n%{http_code}" --max-time 10 "$BASE_URL/health" 2>/dev/null) || true
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [[ "$http_code" == "200" ]]; then
    local status
    status=$(json_field "$body" "status")
    if [[ "$status" == "ok" ]]; then
      pass "T1: GET /health → 200, status=ok"
    else
      pass "T1: GET /health → 200 (status=$status)"
    fi
  else
    fail "T1: GET /health" "expected 200, got ${http_code:-timeout}"
    return 1
  fi
}

# ── Test 2: GET /health/openclaw ─────────────────────────────────────────────
test_health_openclaw() {
  local resp http_code body
  resp=$(curl -sk -w "\n%{http_code}" --max-time 15 "$BASE_URL/health/openclaw" 2>/dev/null) || true
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [[ "$http_code" == "200" ]]; then
    local status
    status=$(json_field "$body" "status")
    if [[ "$status" == "ok" ]]; then
      pass "T2: GET /health/openclaw → 200, status=ok"
    else
      fail "T2: GET /health/openclaw" "returned 200 but status=$status (OpenClaw unreachable)"
      return 1
    fi
  else
    fail "T2: GET /health/openclaw" "expected 200, got ${http_code:-timeout}"
    return 1
  fi
}

# ── Test 3: GET /widget.js ───────────────────────────────────────────────────
test_widget_js() {
  local resp http_code body
  resp=$(curl -sk -w "\n%{http_code}" --max-time 15 "$BASE_URL/widget.js" 2>/dev/null) || true
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [[ "$http_code" == "200" ]]; then
    if [[ ${#body} -gt 100 ]]; then
      pass "T3: GET /widget.js → 200, ${#body} bytes of JS"
    else
      fail "T3: GET /widget.js" "response too small (${#body} bytes)"
      return 1
    fi
  else
    fail "T3: GET /widget.js" "expected 200, got ${http_code:-timeout}"
    return 1
  fi
}

test_health || true
test_health_openclaw || true
test_widget_js || true

###############################################################################
# PHASE 2 — Agent Creation via Meta-Agent
###############################################################################
banner "Phase 2: Agent Creation via Meta-Agent"

# ── Test 4: Initial greeting (empty messages) ────────────────────────────────
test_meta_greeting() {
  log "  → Sending initial greeting to meta-agent…"
  local resp http_code body customer_sig
  customer_sig=$(customer_sig_for "$CUSTOMER_ID") || {
    fail "T4: Meta-agent greeting" "failed to generate customer HMAC signature"
    return 1
  }
  resp=$(curl -sk -w "\n%{http_code}" --max-time 60 \
    -X POST "$BASE_URL/api/agents/create-via-meta" \
    -H "x-customer-id: $CUSTOMER_ID" \
    -H "x-customer-sig: $customer_sig" \
    -H "Content-Type: application/json" \
    -d '{"messages":[]}' 2>/dev/null) || true
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [[ "$http_code" != "200" ]]; then
    fail "T4: Meta-agent greeting" "expected 200, got ${http_code:-timeout}"
    log "    Body: ${body:0:300}"
    return 1
  fi

  SESSION_ID=$(json_field "$body" "data.sessionId")
  local ai_response
  ai_response=$(json_field "$body" "data.response")

  if [[ -z "$SESSION_ID" ]]; then
    fail "T4: Meta-agent greeting" "no sessionId in response"
    log "    Body: ${body:0:300}"
    return 1
  fi

  if [[ -z "$ai_response" ]]; then
    fail "T4: Meta-agent greeting" "empty AI response"
    return 1
  fi

  pass "T4: Meta-agent greeting → got sessionId=${SESSION_ID:0:20}… and ${#ai_response}-char response"
  log "    AI: ${ai_response:0:120}…"
}

# ── Test 5: Describe the business ────────────────────────────────────────────
test_meta_describe() {
  if [[ -z "$SESSION_ID" ]]; then
    skip "T5: Meta-agent describe" "no sessionId from T4"
    return 1
  fi

  log "  → Describing test business to meta-agent…"
  local msg="I want to create a chat agent for vibebrowser.app. Please check the website first and tell me what you find."
  local payload
  payload=$(printf '{"messages":[{"role":"user","content":"%s"}],"sessionId":"%s"}' "$msg" "$SESSION_ID")

  local resp http_code body customer_sig
  customer_sig=$(customer_sig_for "$CUSTOMER_ID") || {
    fail "T5: Meta-agent describe" "failed to generate customer HMAC signature"
    return 1
  }
  resp=$(curl -sk -w "\n%{http_code}" --max-time 90 \
    -X POST "$BASE_URL/api/agents/create-via-meta" \
    -H "x-customer-id: $CUSTOMER_ID" \
    -H "x-customer-sig: $customer_sig" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null) || true
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [[ "$http_code" != "200" ]]; then
    fail "T5: Meta-agent describe" "expected 200, got ${http_code:-timeout}"
    log "    Body: ${body:0:300}"
    return 1
  fi

  local ai_response
  ai_response=$(json_field "$body" "data.response")

  if [[ -z "$ai_response" ]]; then
    fail "T5: Meta-agent describe" "empty AI response"
    return 1
  fi

  # Update session ID in case it changed
  local new_sid
  new_sid=$(json_field "$body" "data.sessionId")
  if [[ -n "$new_sid" ]]; then SESSION_ID="$new_sid"; fi

  # Check if meta-agent eagerly created the agent in this step
  local marker_slug
  marker_slug=$(extract_agent_slug_marker "$ai_response")
  if [[ -n "$marker_slug" ]]; then
    AGENT_SLUG="$marker_slug"
    log "    (agent created eagerly in describe step: $AGENT_SLUG)"
    EMBED_TOKEN=$(json_field "$body" "data.embedToken")
    local embed_code
    embed_code=$(json_field "$body" "data.embedCode")
    if [[ -n "$embed_code" && "$embed_code" != "null" ]]; then
      EMBED_CODE="$embed_code"
      PHASE2_OK=true
    fi
  fi

  pass "T5: Meta-agent describe → ${#ai_response}-char response"
  log "    AI: ${ai_response:0:120}…"
}

# ── Test 6: Confirm & create agent ───────────────────────────────────────────
test_meta_create() {
  # If agent was already created eagerly in T5, skip to validation
  if [[ "$PHASE2_OK" == "true" && -n "$EMBED_TOKEN" && -n "$AGENT_SLUG" ]]; then
    pass "T6: Meta-agent create → agent=$AGENT_SLUG (created in describe step), embedToken=${EMBED_TOKEN:0:12}…"
    return 0
  fi

  if [[ -z "$SESSION_ID" ]]; then
    skip "T6: Meta-agent create" "no sessionId from previous tests"
    return 1
  fi

  local slug_suffix
  slug_suffix="${CUSTOMER_ID%%-*}"
  REQUESTED_AGENT_SLUG="vibebrowser-app-${slug_suffix}"
  log "  → Confirming agent creation (this may take 1-2 minutes)…"
  log "    Requesting unique slug: $REQUESTED_AGENT_SLUG"
  local msg
  msg="Yes, that looks correct. Please create the agent now. IMPORTANT: use exact unique slug ${REQUESTED_AGENT_SLUG} for this agent."
  local payload
  payload=$(printf '{"messages":[{"role":"user","content":"%s"}],"sessionId":"%s"}' "$msg" "$SESSION_ID")

  local resp http_code body customer_sig
  customer_sig=$(customer_sig_for "$CUSTOMER_ID") || {
    fail "T6: Meta-agent create" "failed to generate customer HMAC signature"
    return 1
  }
  resp=$(curl -sk -w "\n%{http_code}" --max-time 180 \
    -X POST "$BASE_URL/api/agents/create-via-meta" \
    -H "x-customer-id: $CUSTOMER_ID" \
    -H "x-customer-sig: $customer_sig" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null) || true
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [[ "$http_code" != "200" ]]; then
    fail "T6: Meta-agent create" "expected 200, got ${http_code:-timeout}"
    log "    Body: ${body:0:500}"
    return 1
  fi

  local ai_response embed_code agent_json
  ai_response=$(json_field "$body" "data.response")
  embed_code=$(json_field "$body" "data.embedCode")
  EMBED_TOKEN=$(json_field "$body" "data.embedToken")
  agent_json=$(json_field "$body" "data.agent")
  if [[ -n "$embed_code" && "$embed_code" != "null" && "$embed_code" != '""' ]]; then
    EMBED_CODE="$embed_code"
  fi

  log "    AI: ${ai_response:0:200}…"

  # Check for [AGENT_CREATED::<slug>] marker in AI response
  local marker_slug
  marker_slug=$(extract_agent_slug_marker "$ai_response")
  if [[ -n "$marker_slug" ]]; then
    AGENT_SLUG="$marker_slug"
    log "    Found AGENT_CREATED marker: slug=$AGENT_SLUG"
  else
    log "    ⚠ No [AGENT_CREATED::] marker in response text (may be in agent data)"
  fi

  # Extract agent ID from agent JSON if available
  if [[ -n "$agent_json" && "$agent_json" != "null" ]]; then
    AGENT_ID=$(json_field "$body" "data.agent.id")
    local agent_name
    agent_name=$(json_field "$body" "data.agent.name")
    if [[ -z "$AGENT_SLUG" ]]; then
      AGENT_SLUG=$(json_field "$body" "data.agent.openclawAgentId")
    fi
    log "    Agent ID: $AGENT_ID, name: $agent_name, slug: $AGENT_SLUG"
  fi

  if [[ -z "$AGENT_SLUG" && -n "$REQUESTED_AGENT_SLUG" ]]; then
    AGENT_SLUG="$REQUESTED_AGENT_SLUG"
  fi

  # Extract embed token from embedCode HTML if not already set
  if [[ -z "$EMBED_TOKEN" && -n "$embed_code" ]]; then
    if [[ "$embed_code" =~ data-agent-token=\"([^\"]+)\" ]]; then
      EMBED_TOKEN="${BASH_REMATCH[1]}"
      log "    Extracted embed token from embedCode: ${EMBED_TOKEN:0:12}…"
    fi
  fi

  # Validation
  local sub_failures=0

  if [[ -z "$embed_code" || "$embed_code" == "null" || "$embed_code" == '""' ]]; then
    log "    ✗ No embedCode in response"
    ((sub_failures++))
  else
    log "    ✓ embedCode present (${#embed_code} chars)"
  fi

  if [[ -z "$EMBED_TOKEN" || "$EMBED_TOKEN" == "null" ]]; then
    log "    ✗ No embed token resolved"
    ((sub_failures++))
  else
    log "    ✓ embedToken: ${EMBED_TOKEN:0:12}…"
  fi

  if [[ -z "$AGENT_SLUG" || "$AGENT_SLUG" == "null" ]]; then
    log "    ✗ No agent slug resolved"
    ((sub_failures++))
  else
    log "    ✓ agent slug: $AGENT_SLUG"
  fi

  if [[ $sub_failures -gt 0 ]]; then
    fail "T6: Meta-agent create" "$sub_failures missing fields (embedCode/token/slug)"
    log "    Full response: ${body:0:800}"
    return 1
  fi

  PHASE2_OK=true
  # Agent registration may reload the gateway; give transport a moment to settle.
  sleep 3
  pass "T6: Meta-agent create → agent=$AGENT_SLUG, embedToken=${EMBED_TOKEN:0:12}…"
}

test_meta_greeting || true
test_meta_describe || true
test_meta_create || true

###############################################################################
# PHASE 3 — Agent Verification
###############################################################################
banner "Phase 3: Agent Verification"

# ── Test 7: List agents and find ours ────────────────────────────────────────
test_list_agents() {
  if [[ "$PHASE2_OK" != "true" ]]; then
    skip "T7: List agents" "Phase 2 did not complete"
    return 1
  fi

  log "  → Listing agents for customer ${CUSTOMER_ID}..."
  local resp http_code body customer_sig
  customer_sig=$(customer_sig_for "$CUSTOMER_ID") || {
    fail "T7: List agents" "failed to generate customer HMAC signature"
    return 1
  }
  resp=$(curl -sk -w "\n%{http_code}" --max-time 30 \
    "$BASE_URL/api/agents" \
    -H "x-customer-id: $CUSTOMER_ID" \
    -H "x-customer-sig: $customer_sig" 2>/dev/null) || true
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [[ "$http_code" != "200" ]]; then
    fail "T7: List agents" "expected 200, got ${http_code:-timeout}"
    return 1
  fi

  # Check the agent appears in the list
  local found=false
  if command -v python3 &>/dev/null; then
    found=$(python3 -c "
import json, sys
try:
    data = json.loads(sys.argv[1]).get('data', [])
    target_id = sys.argv[2]
    target_slug = sys.argv[3]
    for a in data:
        if a.get('id') == target_id or a.get('openclawAgentId') == target_slug:
            status = a.get('status', 'unknown')
            name = a.get('name', 'unnamed')
            print(f'found|{status}|{name}')
            break
    else:
        print(f'notfound|{len(data)} agents')
except Exception as e:
    print(f'error|{e}')
" "$body" "${AGENT_ID:-none}" "${AGENT_SLUG:-none}" 2>/dev/null)
  else
    found=$(node -e "
try {
  const data = JSON.parse(process.argv[1]).data || [];
  const tid = process.argv[2], tslug = process.argv[3];
  const a = data.find(x => x.id === tid || x.openclawAgentId === tslug);
  if (a) console.log('found|' + (a.status||'unknown') + '|' + (a.name||'unnamed'));
  else console.log('notfound|' + data.length + ' agents');
} catch(e) { console.log('error|'+e.message); }
" "$body" "${AGENT_ID:-none}" "${AGENT_SLUG:-none}" 2>/dev/null)
  fi

  local result_type
  result_type=$(echo "$found" | cut -d'|' -f1)

  if [[ "$result_type" == "found" ]]; then
    local status name
    status=$(echo "$found" | cut -d'|' -f2)
    name=$(echo "$found" | cut -d'|' -f3)
    if [[ "$status" == "active" ]]; then
      PHASE3_OK=true
      pass "T7: List agents → found \"$name\" (status=active)"
    else
      fail "T7: List agents" "agent found but status=$status (expected active)"
    fi
  else
    fail "T7: List agents" "agent not found in list ($found)"
    log "    Response: ${body:0:400}"
  fi
}

# ── Test 8: Check workspace files on disk ────────────────────────────────────
test_workspace_files() {
  if [[ "$PHASE2_OK" != "true" ]]; then
    skip "T8: Workspace files" "Phase 2 did not complete"
    return 0
  fi

  if [[ -z "$WORKSPACES_DIR" ]]; then
    skip "T8: Workspace files" "OPENCLAW_WORKSPACES_DIR not set"
    return 0
  fi

  if [[ -z "$AGENT_SLUG" ]]; then
    skip "T8: Workspace files" "no agent slug available"
    return 0
  fi

  local config_path="$WORKSPACES_DIR/$AGENT_SLUG/agent-config.json"
  if [[ -f "$config_path" ]]; then
    local size
    size=$(wc -c < "$config_path" | tr -d ' ')
    pass "T8: Workspace files → agent-config.json exists ($size bytes)"
  else
    fail "T8: Workspace files" "$config_path not found"
  fi
}

test_list_agents || true
test_workspace_files || true

###############################################################################
# PHASE 4 — Widget Chat (WebSocket)
###############################################################################
banner "Phase 4: Widget Chat (WebSocket)"

# Determine WS URL from BASE_URL
WS_URL="${BASE_URL/http:/ws:}"
WS_URL="${WS_URL/https:/wss:}"

# Check node + WebSocket availability (native WebSocket in Node 22+, or ws module)
NODE_WS_AVAILABLE=false
NODE_WS_MODE=""  # "native" or "ws"
if command -v node &>/dev/null; then
  if node -e "if(typeof WebSocket==='undefined') process.exit(1)" 2>/dev/null; then
    NODE_WS_AVAILABLE=true
    NODE_WS_MODE="native"
  elif node -e "require('ws')" 2>/dev/null; then
    NODE_WS_AVAILABLE=true
    NODE_WS_MODE="ws"
  elif node -e "require('${PWD}/node_modules/ws')" 2>/dev/null; then
    NODE_WS_AVAILABLE=true
    NODE_WS_MODE="ws"
  fi
fi

# ── Test 9: WebSocket Auth ───────────────────────────────────────────────────
test_ws_auth() {
  if [[ "$PHASE2_OK" != "true" || -z "$EMBED_TOKEN" ]]; then
    skip "T9: WS auth" "no embed token from Phase 2"
    return 1
  fi

  if [[ "$NODE_WS_AVAILABLE" != "true" ]]; then
    skip "T9: WS auth" "WebSocket not available in node"
    return 1
  fi

  log "  → Connecting to $WS_URL/ws and authenticating…"
  local user_id="e2e-test-user-$(date +%s)"
  local result
  result=$(NODE_TLS_REJECT_UNAUTHORIZED=0 node -e "
// Use native WebSocket (Node 22+) or ws module
const WS = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');
const ws = new WS('${WS_URL}/ws');
const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 20000);

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    agentToken: '${EMBED_TOKEN}',
    token: '${EMBED_TOKEN}',
    userId: '${user_id}'
  }));
};

ws.onmessage = (evt) => {
  const raw = typeof evt.data === 'string' ? evt.data : evt.data.toString();
  const msg = JSON.parse(raw);
  if (msg.type === 'auth_ok') {
    console.log('AUTH_OK|' + msg.sessionId);
    clearTimeout(timeout);
    ws.close();
  } else if (msg.type === 'auth_error') {
    console.log('AUTH_ERROR|' + (msg.reason || msg.message));
    clearTimeout(timeout);
    ws.close();
  }
};

ws.onerror = (e) => { console.log('WS_ERROR|' + (e.message || 'connection failed')); process.exit(1); };
ws.onclose = () => process.exit(0);
" 2>/dev/null) || true

  local result_type
  result_type=$(echo "$result" | head -1 | cut -d'|' -f1)

  if [[ "$result_type" == "AUTH_OK" ]]; then
    local ws_session
    ws_session=$(echo "$result" | head -1 | cut -d'|' -f2)
    pass "T9: WS auth → auth_ok, session=${ws_session:0:30}…"
    return 0
  elif [[ "$result_type" == "AUTH_ERROR" ]]; then
    local reason
    reason=$(echo "$result" | head -1 | cut -d'|' -f2)
    fail "T9: WS auth" "auth_error: $reason"
    return 1
  else
    fail "T9: WS auth" "unexpected result: ${result:0:200}"
    return 1
  fi
}

# ── Test 10: Widget Chat Message ─────────────────────────────────────────────
run_ws_chat_probe() {
  local user_id="$1"
  NODE_TLS_REJECT_UNAUTHORIZED=0 WS_BASE_URL="$WS_URL" WS_EMBED_TOKEN="$EMBED_TOKEN" WS_USER_ID="$user_id" node - <<'NODE' 2>/dev/null || true
const WS = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');
const baseUrl = process.env.WS_BASE_URL;
const embedToken = process.env.WS_EMBED_TOKEN;
const userId = process.env.WS_USER_ID;
const ws = new WS(`${baseUrl}/ws`);
const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 60000);
let fullContent = '';

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    agentToken: embedToken,
    token: embedToken,
    userId,
  }));
};

ws.onmessage = (evt) => {
  const raw = typeof evt.data === 'string' ? evt.data : evt.data.toString();
  const msg = JSON.parse(raw);
  if (msg.type === 'auth_ok') {
    ws.send(JSON.stringify({ type: 'message', content: 'What products do you have?' }));
  } else if (msg.type === 'auth_error') {
    console.log('AUTH_ERROR|' + (msg.reason || msg.message));
    clearTimeout(timeout);
    ws.close();
  } else if (msg.type === 'message') {
    if (msg.content) fullContent += msg.content;
    if (msg.done) {
      console.log('CHAT_OK|' + fullContent.length + '|' + fullContent.substring(0, 200));
      clearTimeout(timeout);
      ws.close();
    }
  } else if (msg.type === 'error') {
    console.log('CHAT_ERROR|' + msg.message);
    clearTimeout(timeout);
    ws.close();
  }
};

ws.onerror = (e) => { console.log('WS_ERROR|' + (e.message || 'connection failed')); process.exit(1); };
ws.onclose = () => process.exit(0);
NODE
}

test_ws_chat() {
  if [[ "$PHASE2_OK" != "true" || -z "$EMBED_TOKEN" ]]; then
    skip "T10: WS chat" "no embed token from Phase 2"
    return 1
  fi

  if [[ "$NODE_WS_AVAILABLE" != "true" ]]; then
    skip "T10: WS chat" "WebSocket not available in node"
    return 1
  fi

  log "  → Sending chat message through widget WS…"
  local user_id="e2e-test-chat-$(date +%s)"
  local result
  result=$(run_ws_chat_probe "$user_id")

  local result_type
  result_type=$(echo "$result" | head -1 | cut -d'|' -f1)
  if [[ "$result_type" == "CHAT_ERROR" ]]; then
    local first_error
    first_error=$(echo "$result" | head -1 | cut -d'|' -f2-)
    if echo "$first_error" | grep -Eiq 'ECONNRESET|socket hang up|EPIPE|connection reset'; then
      log "    transient chat transport error ($first_error), retrying once…"
      sleep 2
      user_id="e2e-test-chat-retry-$(date +%s)"
      result=$(run_ws_chat_probe "$user_id")
      result_type=$(echo "$result" | head -1 | cut -d'|' -f1)
    fi
  fi

  if [[ "$result_type" == "CHAT_OK" ]]; then
    local content_len content_preview
    content_len=$(echo "$result" | head -1 | cut -d'|' -f2)
    content_preview=$(echo "$result" | head -1 | cut -d'|' -f3-)
    if [[ "$content_len" -gt 0 ]]; then
      pass "T10: WS chat → ${content_len}-char response from created agent"
      log "    Agent: ${content_preview}…"
    else
      fail "T10: WS chat" "empty response content"
    fi
  elif [[ "$result_type" == "AUTH_ERROR" ]]; then
    fail "T10: WS chat" "auth failed: $(echo "$result" | head -1 | cut -d'|' -f2)"
  elif [[ "$result_type" == "CHAT_ERROR" ]]; then
    fail "T10: WS chat" "agent error: $(echo "$result" | head -1 | cut -d'|' -f2)"
  elif [[ "$result_type" == "TIMEOUT" ]]; then
    fail "T10: WS chat" "timed out waiting for agent response (60s)"
  else
    fail "T10: WS chat" "unexpected result: ${result:0:200}"
  fi
}

# ── Test 10b: Standalone Widget Embed (real copy-paste flow) ──────────────────
test_standalone_widget_embed() {
  if [[ "$PHASE2_OK" != "true" || -z "$EMBED_TOKEN" ]]; then
    skip "T10b: Standalone widget embed" "no embed token from Phase 2"
    return 1
  fi

  if ! command -v node &>/dev/null; then
    skip "T10b: Standalone widget embed" "node is not available"
    return 0
  fi

  local snippet tmp_html result result_type detail
  if [[ -n "$EMBED_CODE" && "$EMBED_CODE" != "null" && "$EMBED_CODE" != '""' ]]; then
    snippet="$EMBED_CODE"
  else
    snippet="<script src=\"$BASE_URL/widget.js\" data-agent-token=\"$EMBED_TOKEN\" async></script>"
  fi

  tmp_html="$(mktemp -t lamoom-widget-standalone).html"
  printf '<!doctype html><html><head><meta charset="utf-8"><title>Lamoom Widget QA</title></head><body><main id="app">%s</main></body></html>\n' "$snippet" > "$tmp_html"

  log "  → Testing real standalone embed via file:// page…"
  result=$(NODE_TLS_REJECT_UNAUTHORIZED=0 node - "$tmp_html" <<'NODE' 2>/dev/null
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.log('NO_PLAYWRIGHT');
  process.exit(0);
}

const htmlPath = process.argv[2];

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--ignore-certificate-errors'],
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`file://${htmlPath}`);
    await page.waitForSelector('.lamoom-root-host', {
      state: 'attached',
      timeout: 30000,
    });

    await page.evaluate(() => {
      const host = document.querySelector('.lamoom-root-host');
      const root = host?.shadowRoot;
      const bubble = root?.querySelector('.lamoom-bubble');
      if (!bubble) throw new Error('widget-bubble-not-found');
      bubble.click();
    });

    await page.waitForTimeout(800);

    await page.evaluate(() => {
      const host = document.querySelector('.lamoom-root-host');
      const root = host?.shadowRoot;
      const textarea = root?.querySelector('.lamoom-textarea');
      const sendButton = root?.querySelector('.lamoom-send');
      if (!textarea || !sendButton) throw new Error('widget-input-not-found');
      textarea.value = 'Hello from standalone embed QA';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      sendButton.click();
    });

    const outcomeHandle = await page.waitForFunction(
      () => {
        const host = document.querySelector('.lamoom-root-host');
        const root = host?.shadowRoot;
        if (!root) return null;

        const messages = Array.from(root.querySelectorAll('.lamoom-message'))
          .map((el) => (el.textContent || '').trim())
          .filter(Boolean);

        const authError = messages.find((text) =>
          /invalid agent token|connection failed|authentication error/i.test(text),
        );
        if (authError) {
          return { status: 'auth_error', detail: authError };
        }

        const assistantMessages = Array.from(root.querySelectorAll('.lamoom-message.lamoom-assistant'))
          .map((el) => (el.textContent || '').trim())
          .filter(Boolean);
        const success = assistantMessages.find((text) =>
          text
          && !/^⚠️/.test(text)
          && !/invalid agent token|connection failed|connection lost|authentication error/i.test(text),
        );

        if (success) {
          return { status: 'ok', detail: success.slice(0, 200) };
        }

        return null;
      },
      { timeout: 120000, polling: 500 },
    );

    const outcome = await outcomeHandle.jsonValue();
    if (outcome?.status === 'ok') {
      console.log(`STANDALONE_OK|${String(outcome.detail || '').replace(/\|/g, ' ')}`);
    } else {
      console.log(`STANDALONE_FAIL|${String(outcome?.detail || 'unknown-error')}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`STANDALONE_FAIL|${message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
NODE
) || true

  rm -f "$tmp_html"

  result_type=$(echo "$result" | head -1 | cut -d'|' -f1)
  detail=$(echo "$result" | head -1 | cut -d'|' -f2-)

  if [[ "$result_type" == "NO_PLAYWRIGHT" ]]; then
    skip "T10b: Standalone widget embed" "playwright is not available in this environment"
    return 0
  fi

  if [[ "$result_type" == "STANDALONE_OK" ]]; then
    pass "T10b: Standalone widget embed → copy-paste flow works"
    log "    Widget reply: ${detail:0:160}…"
  else
    fail "T10b: Standalone widget embed" "${detail:-standalone embed test failed}"
  fi
}

test_ws_auth || true
test_ws_chat || true
test_standalone_widget_embed || true

###############################################################################
# PHASE 5 — Security Gates
###############################################################################
banner "Phase 5: Security Gates"

# ── Test 11: Unauthenticated API access ──────────────────────────────────────
test_unauth_api() {
  log "  → Testing unauthenticated access to protected endpoints…"
  local endpoints=("/api/agents" "/api/auth/ws-ticket")
  local all_pass=true

  for ep in "${endpoints[@]}"; do
    local resp http_code
    resp=$(curl -sk -w "\n%{http_code}" --max-time 10 "$BASE_URL$ep" 2>/dev/null) || true
    http_code=$(echo "$resp" | tail -1)

    # 401/403 = auth blocked; 405 = method not allowed (also safe — POST-only route hit with GET)
    if [[ "$http_code" == "401" || "$http_code" == "403" || "$http_code" == "405" ]]; then
      log "    ✓ $ep → $http_code (blocked)"
    else
      log "    ✗ $ep → $http_code (expected 401/403/405)"
      all_pass=false
    fi
  done

  if $all_pass; then
    pass "T11: Unauthenticated API access blocked"
  else
    fail "T11: Unauthenticated API access" "some endpoints accessible without auth"
  fi
}

# ── Test 12: Invalid embed token WS auth ─────────────────────────────────────
test_ws_invalid_token() {
  if [[ "$NODE_WS_AVAILABLE" != "true" ]]; then
    skip "T12: Invalid WS token" "WebSocket not available in node"
    return 0
  fi

  log "  → Testing WS auth with invalid embed token…"
  local result
  result=$(NODE_TLS_REJECT_UNAUTHORIZED=0 node -e "
const WS = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');
const ws = new WS('${WS_URL}/ws');
const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 15000);

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    agentToken: 'invalid-token-xyz',
    token: 'invalid-token-xyz',
    userId: 'attacker'
  }));
};

ws.onmessage = (evt) => {
  const raw = typeof evt.data === 'string' ? evt.data : evt.data.toString();
  const msg = JSON.parse(raw);
  if (msg.type === 'auth_error') {
    console.log('REJECTED|' + (msg.reason || msg.message));
    clearTimeout(timeout);
    ws.close();
  } else if (msg.type === 'auth_ok') {
    console.log('ACCEPTED');
    clearTimeout(timeout);
    ws.close();
  }
};

ws.onerror = (e) => { console.log('WS_ERROR|' + (e.message || 'connection failed')); process.exit(1); };
ws.onclose = () => process.exit(0);
" 2>/dev/null) || true

  local result_type
  result_type=$(echo "$result" | head -1 | cut -d'|' -f1)

  if [[ "$result_type" == "REJECTED" ]]; then
    pass "T12: Invalid WS token → correctly rejected"
  elif [[ "$result_type" == "ACCEPTED" ]]; then
    fail "T12: Invalid WS token" "SECURITY: invalid token was ACCEPTED"
  else
    fail "T12: Invalid WS token" "unexpected: ${result:0:200}"
  fi
}

# ── Test 13: Unauthenticated admin pages redirect ────────────────────────────
test_unauth_pages() {
  log "  → Testing unauthenticated page access…"
  local pages=("/dashboard" "/create" "/admin")
  local all_redirect=true

  for page in "${pages[@]}"; do
    local http_code
    http_code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 10 \
      -L --max-redirs 0 "$BASE_URL$page" 2>/dev/null) || true

    # 302/307 redirect or 200 with login form are both acceptable
    if [[ "$http_code" == "302" || "$http_code" == "307" || "$http_code" == "200" ]]; then
      log "    ✓ $page → $http_code"
    else
      log "    ✗ $page → $http_code"
      all_redirect=false
    fi
  done

  if $all_redirect; then
    pass "T13: Unauthenticated pages → handled (redirect or SSR login)"
  else
    fail "T13: Unauthenticated pages" "unexpected status codes"
  fi
}

test_unauth_api || true
test_ws_invalid_token || true
test_unauth_pages || true

###############################################################################
# PHASE 6 — Website Discovery Verification
###############################################################################
banner "Phase 6: Website Discovery (Meta-Agent)"

# ── Test 14: Meta-agent proactively fetches website info ─────────────────────
test_meta_discovery() {
  log "  → Testing meta-agent website discovery (vibebrowser.app)…"
  local msg="Create an agent for vibebrowser.app"
  local payload
  payload=$(printf '{"messages":[{"role":"user","content":"%s"}]}' "$msg")

  local resp http_code body customer_sig
  customer_sig=$(customer_sig_for "$CUSTOMER_ID") || {
    fail "T14: Website discovery" "failed to generate customer HMAC signature"
    return 1
  }
  resp=$(curl -sk -w "\n%{http_code}" --max-time 120 \
    -X POST "$BASE_URL/api/agents/create-via-meta" \
    -H "x-customer-id: $CUSTOMER_ID" \
    -H "x-customer-sig: $customer_sig" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null) || true
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [[ "$http_code" != "200" ]]; then
    fail "T14: Website discovery" "expected 200, got ${http_code:-timeout}"
    return 1
  fi

  local ai_response
  ai_response=$(json_field "$body" "data.response")

  if [[ -z "$ai_response" ]]; then
    fail "T14: Website discovery" "empty response"
    return 1
  fi

  # The meta-agent MUST show it fetched the site by mentioning specific details
  local evidence=0
  for keyword in "browser" "Vibe" "AI" "automation" "agent" "web"; do
    if echo "$ai_response" | grep -qi "$keyword"; then
      ((evidence++)) || true
    fi
  done

  if [[ $evidence -ge 2 ]]; then
    pass "T14: Website discovery → meta-agent shows knowledge ($evidence keywords matched)"
    log "    AI: ${ai_response:0:200}…"
  else
    fail "T14: Website discovery" "only $evidence keywords matched — agent may not have fetched site"
    log "    AI: ${ai_response:0:300}…"
  fi
}

test_meta_discovery || true

###############################################################################
# RESULTS SUMMARY
###############################################################################
echo ""
echo "════════════════════════════════════════════"
echo -e "${BOLD}E2E Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}, ${YELLOW}$SKIPPED skipped${NC}"
echo "════════════════════════════════════════════"

if [[ "$PHASE2_OK" == "true" ]]; then
  echo ""
  echo "Created agent left for inspection:"
  echo "  Customer ID:  $CUSTOMER_ID"
  echo "  Agent slug:   ${AGENT_SLUG:-unknown}"
  echo "  Agent ID:     ${AGENT_ID:-unknown}"
  echo "  Embed token:  ${EMBED_TOKEN:-unknown}"
fi

echo ""
[[ "$FAILED" -eq 0 ]] || exit 1
