#!/usr/bin/env bash
# E2E AI Liveness Test Suite
# Verifies the system talks to a real, flexible AI — not hardcoded responses.
# Run against the live proxy endpoint.
#
# Usage: ./test-ai-liveness.sh [PROXY_URL] [API_TOKEN]
#   PROXY_URL  defaults to $PROXY_URL or https://dev.lamoom.com
#   API_TOKEN  defaults to $PROXY_API_TOKEN or $NEXT_PUBLIC_PROXY_API_TOKEN

set -euo pipefail

PROXY_URL="${1:-${PROXY_URL:-https://dev.lamoom.com}}"
API_TOKEN="${2:-${PROXY_API_TOKEN:-${NEXT_PUBLIC_PROXY_API_TOKEN:-}}}"
CUSTOMER_ID="${TEST_CUSTOMER_ID:-b90daf67-5bda-4df3-a487-3297730b4971}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS=0; FAIL=0; SKIP=0

pass() { ((PASS++)); printf "${GREEN}✓ PASS${NC}: %s\n" "$1"; }
fail() { ((FAIL++)); printf "${RED}✗ FAIL${NC}: %s\n" "$1"; [ "${2:-}" ] && printf "  Detail: %s\n" "$2"; }
skip() { ((SKIP++)); printf "${YELLOW}⊘ SKIP${NC}: %s\n" "$1"; }

call_meta() {
  local messages="$1"
  local session_id="${2:-}"
  local body
  if [ -n "$session_id" ]; then
    body=$(printf '{"messages":%s,"sessionId":"%s"}' "$messages" "$session_id")
  else
    body=$(printf '{"messages":%s}' "$messages")
  fi
  curl -skf --max-time 180 \
    -X POST "${PROXY_URL}/api/agents/create-via-meta?customerId=${CUSTOMER_ID}" \
    -H "Authorization: Bearer ${API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null || echo '{"error":"request_failed"}'
}

extract_response() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('response',''))" 2>/dev/null || echo ""; }
extract_session()  { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('sessionId',''))" 2>/dev/null || echo ""; }
has_error()        { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'error' in d else 'no')" 2>/dev/null || echo "yes"; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  E2E AI Liveness Tests"
echo "  Target: ${PROXY_URL}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -z "$API_TOKEN" ]; then
  echo "ERROR: No API token. Set PROXY_API_TOKEN or pass as arg 2."
  exit 1
fi

# ──────────────────────────────────────────
# TEST 1: Basic connectivity — new session returns a response
# ──────────────────────────────────────────
echo "▸ Test 1: Basic connectivity (new session greeting)"
RESULT1=$(call_meta '[]')
RESP1=$(extract_response "$RESULT1")
SID1=$(extract_session "$RESULT1")

if [ "$(has_error "$RESULT1")" = "yes" ]; then
  fail "Basic connectivity" "Request failed or returned error"
elif [ -z "$RESP1" ] || [ ${#RESP1} -lt 20 ]; then
  fail "Basic connectivity" "Response too short (${#RESP1} chars): ${RESP1:0:100}"
else
  pass "Basic connectivity — got ${#RESP1} char response, sessionId=${SID1:0:8}..."
fi

# ──────────────────────────────────────────
# TEST 2: Response is not a known hardcoded pattern
# ──────────────────────────────────────────
echo "▸ Test 2: Response is not hardcoded"
HARDCODED_PATTERNS=(
  "What type of website"
  "What kind of website"
  "Tell me about your website"
  "I'd be happy to help you create"
  "Welcome to Lamoom"
  '{"ok":true'
)
IS_HARDCODED=0
for pattern in "${HARDCODED_PATTERNS[@]}"; do
  if echo "$RESP1" | grep -qiF "$pattern"; then
    # Flag it — but one match alone isn't conclusive. We'll check variability next.
    IS_HARDCODED=1
    MATCHED_PATTERN="$pattern"
    break
  fi
done
# Don't fail yet on pattern match alone — test 3 (variability) is the real detector
if [ $IS_HARDCODED -eq 1 ]; then
  echo "  ⚠ Response matches known pattern: '${MATCHED_PATTERN}' — checking variability..."
else
  pass "Response doesn't match known hardcoded patterns"
fi

# ──────────────────────────────────────────
# TEST 3: Variability — same input, different output
# This is THE hardcoded-bot killer test.
# ──────────────────────────────────────────
echo "▸ Test 3: Variability (same prompt, must get different response)"
RESULT2=$(call_meta '[]')
RESP2=$(extract_response "$RESULT2")

if [ -z "$RESP2" ]; then
  fail "Variability" "Second request returned empty response"
elif [ "$RESP1" = "$RESP2" ]; then
  fail "Variability — HARDCODED BOT DETECTED" "Two identical responses to same input"
  echo "  Response 1: ${RESP1:0:120}..."
  echo "  Response 2: ${RESP2:0:120}..."
else
  pass "Variability — responses differ (${#RESP1} vs ${#RESP2} chars)"
  # Now resolve test 2 if it was flagged
  if [ $IS_HARDCODED -eq 1 ]; then
    pass "Pattern match was coincidental (responses still vary)"
  fi
fi

# ──────────────────────────────────────────
# TEST 4: Contextual relevance — ask about pottery, response should mention pottery
# ──────────────────────────────────────────
echo "▸ Test 4: Contextual relevance (ask about vibebrowser.app)"
RESULT3=$(call_meta '[{"role":"user","content":"I want to create a chat agent for vibebrowser.app - its a browser with built-in AI capabilities for web automation"}]')
RESP3=$(extract_response "$RESULT3")
SID3=$(extract_session "$RESULT3")

if [ -z "$RESP3" ]; then
  fail "Contextual relevance" "Empty response"
else
  # Check if response mentions browser/vibebrowser/agent/automation — at least one
  RELEVANT=0
  for keyword in browser vibebrowser agent automation web AI; do
    if echo "$RESP3" | grep -qi "$keyword"; then
      RELEVANT=1
      break
    fi
  done
  if [ $RELEVANT -eq 1 ]; then
    pass "Contextual relevance — response references user's domain"
  else
    fail "Contextual relevance" "Response doesn't mention browser/vibebrowser/agent/automation: ${RESP3:0:200}"
  fi
fi

# ──────────────────────────────────────────
# TEST 5: Session memory — follow-up references prior context
# ──────────────────────────────────────────
echo "▸ Test 5: Session memory (follow-up in same session)"
if [ -z "$SID3" ]; then
  skip "Session memory — no sessionId from test 4"
else
  RESULT4=$(call_meta '[{"role":"user","content":"What domain did I say my shop is on?"}]' "$SID3")
  RESP4=$(extract_response "$RESULT4")

  if [ -z "$RESP4" ]; then
    fail "Session memory" "Empty response to follow-up"
  elif echo "$RESP4" | grep -qi "pottery-palace"; then
    pass "Session memory — AI recalled pottery-palace.com"
  elif echo "$RESP4" | grep -qi "pottery"; then
    pass "Session memory — AI recalled pottery context (partial)"
  else
    fail "Session memory" "AI didn't recall pottery-palace.com: ${RESP4:0:200}"
  fi
fi

# ──────────────────────────────────────────
# TEST 6: Off-script handling — ask something unexpected
# ──────────────────────────────────────────
echo "▸ Test 6: Off-script handling (unexpected question)"
RESULT5=$(call_meta '[{"role":"user","content":"What is the capital of France?"}]')
RESP5=$(extract_response "$RESULT5")

if [ -z "$RESP5" ]; then
  fail "Off-script handling" "Empty response"
elif echo "$RESP5" | grep -qi "paris"; then
  pass "Off-script handling — AI answered correctly (Paris)"
elif [ ${#RESP5} -gt 30 ]; then
  # AI might redirect back to agent creation — that's also valid behavior
  pass "Off-script handling — AI gave substantive response (${#RESP5} chars)"
else
  fail "Off-script handling" "Response too short or irrelevant: ${RESP5:0:200}"
fi

# ──────────────────────────────────────────
# TEST 7: Response structure — verify API envelope shape
# ──────────────────────────────────────────
echo "▸ Test 7: Response structure"
HAS_DATA=$(echo "$RESULT1" | python3 -c "
import sys,json
d=json.load(sys.stdin)
data=d.get('data',{})
has_response = 'response' in data
has_session = 'sessionId' in data
print(f'response={has_response} sessionId={has_session}')
" 2>/dev/null || echo "parse_error")

if echo "$HAS_DATA" | grep -q "response=True.*sessionId=True"; then
  pass "Response structure — data.response and data.sessionId present"
else
  fail "Response structure" "Missing expected fields: ${HAS_DATA}"
fi

# ──────────────────────────────────────────
# Summary
# ──────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS + FAIL + SKIP))
printf "  Results: ${GREEN}%d passed${NC}, ${RED}%d failed${NC}, ${YELLOW}%d skipped${NC} / %d total\n" $PASS $FAIL $SKIP $TOTAL
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
exit 0
