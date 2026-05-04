#!/usr/bin/env bash
# Provisioning smoke test for Paperclip integration
# Runs without root — uses isolated data dir, no systemd/nginx
# Usage: bash infra/paperclip/test-provision.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(mktemp -d)"
PAPERCLIP_PID=""
ACTUAL_PORT=""
PASS=0
FAIL=0

cleanup() {
  echo ""
  echo "── Cleanup ──"
  if [[ -n "${PAPERCLIP_PID}" ]] && kill -0 "${PAPERCLIP_PID}" 2>/dev/null; then
    kill "${PAPERCLIP_PID}" 2>/dev/null || true
    wait "${PAPERCLIP_PID}" 2>/dev/null || true
    echo "  Stopped Paperclip (PID ${PAPERCLIP_PID})"
  fi
  rm -rf "${TEST_DIR}"
  echo "  Cleaned ${TEST_DIR}"
  echo ""
  echo "══════════════════════════════════════"
  echo "  PASS: ${PASS}  FAIL: ${FAIL}"
  echo "══════════════════════════════════════"
  if [[ "${FAIL}" -gt 0 ]]; then
    exit 1
  fi
}
trap cleanup EXIT

assert() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    PASS=$((PASS + 1))
    echo "  ✓ ${label}"
  else
    FAIL=$((FAIL + 1))
    echo "  ✗ ${label}"
  fi
}

echo "══════════════════════════════════════"
echo "  Paperclip Provisioning Smoke Test"
echo "══════════════════════════════════════"
echo "  Data dir:  ${TEST_DIR}"
echo ""

# ── 1. Verify CLI exists ──────────────────────────────────────────────────────
echo "── Step 1: CLI availability ──"
assert "npx paperclipai resolves" npx paperclipai --version

# ── 2. Verify infra files exist ───────────────────────────────────────────────
echo "── Step 2: Infra files present ──"
assert "setup.sh exists"            test -f "${SCRIPT_DIR}/setup.sh"
assert "paperclip.service exists"   test -f "${SCRIPT_DIR}/paperclip.service"
assert "bootstrap.sh exists"        test -f "${SCRIPT_DIR}/bootstrap.sh"
assert "setup.sh is executable"     test -x "${SCRIPT_DIR}/setup.sh"
assert "bootstrap.sh is executable" test -x "${SCRIPT_DIR}/bootstrap.sh"

# ── 3. Validate systemd unit template ─────────────────────────────────────────
echo "── Step 3: Systemd unit template ──"
assert "service has ExecStart with 'run'" grep -q 'paperclipai run' "${SCRIPT_DIR}/paperclip.service"
assert "service has --data-dir"           grep -q '\-\-data-dir' "${SCRIPT_DIR}/paperclip.service"
assert "service has User placeholder"     grep -q 'PAPERCLIP_USER' "${SCRIPT_DIR}/paperclip.service"

# ── 4. Onboard + Run (background — onboard --yes chains into run) ────────────
echo "── Step 4: Onboard + Start server (background) ──"
# Note: `onboard --yes` automatically chains into `run` after saving config.
# We run it in the background and wait for health endpoint.
npx paperclipai onboard --yes --data-dir "${TEST_DIR}" --bind loopback &>"${TEST_DIR}/server.log" &
PAPERCLIP_PID=$!
echo "  PID: ${PAPERCLIP_PID}"

# Wait for config to be created (onboard phase)
echo "  Waiting for onboard to complete..."
for i in $(seq 1 30); do
  if [[ -f "${TEST_DIR}/instances/default/config.json" ]]; then
    break
  fi
  sleep 1
done

assert "config.json created"          test -f "${TEST_DIR}/instances/default/config.json"
assert "secrets dir created"          test -d "${TEST_DIR}/instances/default/secrets"

# Wait for health endpoint — Paperclip auto-selects next free port if busy
echo "  Waiting for server to be healthy..."
HEALTHY=false
for i in $(seq 1 45); do
  # Parse the actual port from server log
  if [[ -z "${ACTUAL_PORT}" ]]; then
    ACTUAL_PORT=$(grep -oP 'Server listening on [^:]+:\K\d+' "${TEST_DIR}/server.log" 2>/dev/null || true)
  fi
  if [[ -n "${ACTUAL_PORT}" ]]; then
    if curl -sf "http://localhost:${ACTUAL_PORT}/api/health" >/dev/null 2>&1; then
      HEALTHY=true
      break
    fi
  fi
  sleep 2
done

if $HEALTHY; then
  PASS=$((PASS + 1))
  echo "  ✓ Server healthy on port ${ACTUAL_PORT}"
else
  FAIL=$((FAIL + 1))
  echo "  ✗ Server did not become healthy within 90s"
  echo "  Last 30 lines of server.log:"
  tail -30 "${TEST_DIR}/server.log" 2>/dev/null || true
fi

# ── 5. Verify onboard artifacts ──────────────────────────────────────────────
echo "── Step 5: Onboard artifacts ──"
assert "instances dir created"        test -d "${TEST_DIR}/instances"
assert "default instance exists"      test -d "${TEST_DIR}/instances/default"
assert ".env file created"            test -f "${TEST_DIR}/instances/default/.env"

# ── 6. Verify API endpoints ──────────────────────────────────────────────────
if $HEALTHY; then
  echo "── Step 6: API smoke tests ──"
  BASE="http://localhost:${ACTUAL_PORT}"

  assert "GET /api/health returns 200" \
    curl -sf "${BASE}/api/health"

  # In local_trusted mode, no auth needed
  COMPANIES_STATUS=$(curl -sf -o /dev/null -w '%{http_code}' "${BASE}/api/companies" 2>/dev/null || echo "000")
  if [[ "${COMPANIES_STATUS}" == "200" ]]; then
    PASS=$((PASS + 1))
    echo "  ✓ GET /api/companies returns 200"
  else
    FAIL=$((FAIL + 1))
    echo "  ✗ GET /api/companies returned ${COMPANIES_STATUS}"
  fi

  # Verify health response is valid JSON
  HEALTH_BODY=$(curl -sf "${BASE}/api/health" 2>/dev/null || echo "")
  if echo "${HEALTH_BODY}" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    PASS=$((PASS + 1))
    echo "  ✓ Health response is valid JSON"
  else
    FAIL=$((FAIL + 1))
    echo "  ✗ Health response is not valid JSON: ${HEALTH_BODY}"
  fi
else
  echo "── Step 6: Skipped (server not healthy) ──"
fi

echo ""
echo "── Done ──"
