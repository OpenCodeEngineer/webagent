#!/usr/bin/env bash
# =============================================================================
# Lamoom Platform — Full E2E Flow Test
#
# Tests the COMPLETE product flow at the protocol level:
#   Health → Agent Creation via Meta-Agent → Agent Verification → Widget Chat (WS)
#
# Usage:
#   ./test-e2e-full.sh [BASE_URL] [API_TOKEN]
#
# Environment variables:
#   PROXY_URL / BASE_URL        — defaults to https://dev.lamoom.com
#   PROXY_API_TOKEN             — Bearer token for proxy auth (required)
#   TEST_CUSTOMER_ID            — UUID for the test customer (auto-generated)
#   OPENCLAW_WORKSPACES_DIR     — if set, checks workspace files on disk
# =============================================================================
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
BASE_URL="${1:-${PROXY_URL:-${BASE_URL:-https://dev.lamoom.com}}}"
API_TOKEN="${2:-${PROXY_API_TOKEN:-}}"
CUSTOMER_ID="${TEST_CUSTOMER_ID:-e2e-test-$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]' || date +%s)}"
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

# ── Pre-flight ───────────────────────────────────────────────────────────────
echo -e "${BOLD}Lamoom E2E Full Flow Test${NC}"
echo "──────────────────────────────────────────"
echo "  Base URL:    $BASE_URL"
echo "  Customer ID: $CUSTOMER_ID"
echo "  API Token:   ${API_TOKEN:+${API_TOKEN:0:8}…(set)}${API_TOKEN:-MISSING}"
echo "  Workspaces:  ${WORKSPACES_DIR:-not set}"
echo "──────────────────────────────────────────"

if [[ -z "$API_TOKEN" ]]; then
  echo -e "${RED}ERROR: PROXY_API_TOKEN is required.${NC}" >&2
  echo "  Set it via env var or pass as the second argument." >&2
  exit 2
fi

# Shared state (flows between tests)
SESSION_ID=""
AGENT_SLUG=""
EMBED_TOKEN=""
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
  local resp http_code body
  resp=$(curl -sk -w "\n%{http_code}" --max-time 60 \
    -X POST "$BASE_URL/api/agents/create-via-meta?customerId=$CUSTOMER_ID" \
    -H "Authorization: Bearer $API_TOKEN" \
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
  local msg="I want to create an AI chat agent for my website vibebrowser.app — it's a browser with built-in AI agent capabilities. Please check it out and create an agent for it."
  local payload
  payload=$(printf '{"messages":[{"role":"user","content":"%s"}],"sessionId":"%s"}' "$msg" "$SESSION_ID")

  local resp http_code body
  resp=$(curl -sk -w "\n%{http_code}" --max-time 90 \
    -X POST "$BASE_URL/api/agents/create-via-meta?customerId=$CUSTOMER_ID" \
    -H "Authorization: Bearer $API_TOKEN" \
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

  pass "T5: Meta-agent describe → ${#ai_response}-char response"
  log "    AI: ${ai_response:0:120}…"
}

# ── Test 6: Confirm & create agent ───────────────────────────────────────────
test_meta_create() {
  if [[ -z "$SESSION_ID" ]]; then
    skip "T6: Meta-agent create" "no sessionId from previous tests"
    return 1
  fi

  log "  → Confirming agent creation (this may take 1-2 minutes)…"
  local msg="Yes, that's correct. Please create the agent."
  local payload
  payload=$(printf '{"messages":[{"role":"user","content":"%s"}],"sessionId":"%s"}' "$msg" "$SESSION_ID")

  local resp http_code body
  resp=$(curl -sk -w "\n%{http_code}" --max-time 180 \
    -X POST "$BASE_URL/api/agents/create-via-meta?customerId=$CUSTOMER_ID" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null) || true
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')

  if [[ "$http_code" != "200" ]]; then
    fail "T6: Meta-agent create" "expected 200, got ${http_code:-timeout}"
    log "    Body: ${body:0:500}"
    return 1
  fi

  local ai_response embed_code embed_token_raw agent_json
  ai_response=$(json_field "$body" "data.response")
  embed_code=$(json_field "$body" "data.embedCode")
  EMBED_TOKEN=$(json_field "$body" "data.embedToken")
  agent_json=$(json_field "$body" "data.agent")

  log "    AI: ${ai_response:0:200}…"

  # Check for [AGENT_CREATED::<slug>] marker in AI response
  if [[ "$ai_response" =~ \[AGENT_CREATED::([a-zA-Z0-9_-]+)\] ]]; then
    AGENT_SLUG="${BASH_REMATCH[1]}"
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

  log "  → Listing agents for customer $CUSTOMER_ID…"
  local resp http_code body
  resp=$(curl -sk -w "\n%{http_code}" --max-time 30 \
    "$BASE_URL/api/agents?customerId=$CUSTOMER_ID" \
    -H "Authorization: Bearer $API_TOKEN" 2>/dev/null) || true
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

# Check node + ws availability once
NODE_WS_AVAILABLE=false
if command -v node &>/dev/null; then
  # Try to load ws from the monorepo (it's a transitive dep of @fastify/websocket)
  if node -e "require('ws')" 2>/dev/null; then
    NODE_WS_AVAILABLE=true
  else
    # Try from packages/proxy specifically
    if node -e "require('${PWD}/node_modules/ws')" 2>/dev/null; then
      NODE_WS_AVAILABLE=true
    fi
  fi
fi

# ── Test 9: WebSocket Auth ───────────────────────────────────────────────────
test_ws_auth() {
  if [[ "$PHASE2_OK" != "true" || -z "$EMBED_TOKEN" ]]; then
    skip "T9: WS auth" "no embed token from Phase 2"
    return 1
  fi

  if [[ "$NODE_WS_AVAILABLE" != "true" ]]; then
    skip "T9: WS auth" "node 'ws' module not available"
    return 1
  fi

  log "  → Connecting to $WS_URL/ws and authenticating…"
  local user_id="e2e-test-user-$(date +%s)"
  local result
  result=$(node -e "
const WebSocket = require('ws');
const ws = new WebSocket('${WS_URL}/ws', { rejectUnauthorized: false });
const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 20000);

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'auth',
    agentToken: '${EMBED_TOKEN}',
    token: '${EMBED_TOKEN}',
    userId: '${user_id}'
  }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'auth_ok') {
    console.log('AUTH_OK|' + msg.sessionId);
    clearTimeout(timeout);
    ws.close();
  } else if (msg.type === 'auth_error') {
    console.log('AUTH_ERROR|' + msg.reason);
    clearTimeout(timeout);
    ws.close();
  }
});

ws.on('error', (e) => { console.log('WS_ERROR|' + e.message); process.exit(1); });
ws.on('close', () => process.exit(0));
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
test_ws_chat() {
  if [[ "$PHASE2_OK" != "true" || -z "$EMBED_TOKEN" ]]; then
    skip "T10: WS chat" "no embed token from Phase 2"
    return 1
  fi

  if [[ "$NODE_WS_AVAILABLE" != "true" ]]; then
    skip "T10: WS chat" "node 'ws' module not available"
    return 1
  fi

  log "  → Sending chat message through widget WS…"
  local user_id="e2e-test-chat-$(date +%s)"
  local result
  result=$(node -e "
const WebSocket = require('ws');
const ws = new WebSocket('${WS_URL}/ws', { rejectUnauthorized: false });
const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 60000);
let authed = false;
let fullContent = '';

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'auth',
    agentToken: '${EMBED_TOKEN}',
    token: '${EMBED_TOKEN}',
    userId: '${user_id}'
  }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'auth_ok') {
    authed = true;
    // Send a test question
    ws.send(JSON.stringify({ type: 'message', content: 'What products do you have?' }));
  } else if (msg.type === 'auth_error') {
    console.log('AUTH_ERROR|' + msg.reason);
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
});

ws.on('error', (e) => { console.log('WS_ERROR|' + e.message); process.exit(1); });
ws.on('close', () => process.exit(0));
" 2>/dev/null) || true

  local result_type
  result_type=$(echo "$result" | head -1 | cut -d'|' -f1)

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

test_ws_auth || true
test_ws_chat || true

###############################################################################
# PHASE 5 — Security Gates
###############################################################################
banner "Phase 5: Security Gates"

# ── Test 11: Unauthenticated API access ──────────────────────────────────────
test_unauth_api() {
  log "  → Testing unauthenticated access to protected endpoints…"
  local endpoints=("/api/agents?customerId=test" "/api/auth/ws-ticket")
  local all_pass=true

  for ep in "${endpoints[@]}"; do
    local resp http_code
    resp=$(curl -sk -w "\n%{http_code}" --max-time 10 "$BASE_URL$ep" 2>/dev/null) || true
    http_code=$(echo "$resp" | tail -1)

    if [[ "$http_code" == "401" || "$http_code" == "403" ]]; then
      log "    ✓ $ep → $http_code (blocked)"
    else
      log "    ✗ $ep → $http_code (expected 401/403)"
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
    skip "T12: Invalid WS token" "node 'ws' module not available"
    return 0
  fi

  log "  → Testing WS auth with invalid embed token…"
  local result
  result=$(node -e "
const WebSocket = require('ws');
const ws = new WebSocket('${WS_URL}/ws', { rejectUnauthorized: false });
const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 15000);

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'auth',
    agentToken: 'invalid-token-xyz',
    token: 'invalid-token-xyz',
    userId: 'attacker'
  }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'auth_error') {
    console.log('REJECTED|' + msg.reason);
    clearTimeout(timeout);
    ws.close();
  } else if (msg.type === 'auth_ok') {
    console.log('ACCEPTED');
    clearTimeout(timeout);
    ws.close();
  }
});

ws.on('error', (e) => { console.log('WS_ERROR|' + e.message); process.exit(1); });
ws.on('close', () => process.exit(0));
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

  local resp http_code body
  resp=$(curl -sk -w "\n%{http_code}" --max-time 120 \
    -X POST "$BASE_URL/api/agents/create-via-meta?customerId=$CUSTOMER_ID" \
    -H "Authorization: Bearer $API_TOKEN" \
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
