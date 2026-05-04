#!/usr/bin/env bash
# Post-install: bootstrap Paperclip company and configure openclaw-gateway adapter
# Run after paperclip.service is healthy
set -euo pipefail

PAPERCLIP_PORT="${PAPERCLIP_PORT:-3100}"
PAPERCLIP_URL="http://localhost:${PAPERCLIP_PORT}"
OPENCLAW_GATEWAY_URL="${OPENCLAW_GATEWAY_URL:-http://localhost:18789}"
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"
COMPANY_NAME="${COMPANY_NAME:-Lamoom}"

echo "── Bootstrapping Paperclip for ${COMPANY_NAME} ──"

# Wait for API readiness
echo "Waiting for Paperclip API..."
for i in $(seq 1 30); do
  if curl -sf "${PAPERCLIP_URL}/api/health" >/dev/null 2>&1; then
    echo "  API ready after ${i} attempts"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Paperclip API not reachable at ${PAPERCLIP_URL} after 60s"
    exit 1
  fi
  sleep 2
done

# Get the default company (created during onboard)
echo "Fetching default company..."
COMPANIES_JSON=$(curl -sf "${PAPERCLIP_URL}/api/v1/companies" || echo '{"companies":[]}')
COMPANY_ID=$(echo "$COMPANIES_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
companies = data.get('companies', [])
print(companies[0]['id'] if companies else '')
" 2>/dev/null || echo "")

if [ -z "$COMPANY_ID" ]; then
  echo "WARNING: No company found in Paperclip. Onboard may not have completed."
  echo "  The proxy will retry company discovery on first agent creation."
  exit 0
fi

echo "  Company ID: ${COMPANY_ID}"

# Configure the openclaw-gateway adapter for this company
echo "Configuring openclaw-gateway adapter..."
ADAPTER_PAYLOAD=$(cat <<EOF
{
  "gateway_url": "${OPENCLAW_GATEWAY_URL}",
  "gateway_token": "${OPENCLAW_GATEWAY_TOKEN}"
}
EOF
)

ADAPTER_RESPONSE=$(curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d "${ADAPTER_PAYLOAD}" \
  "${PAPERCLIP_URL}/api/v1/companies/${COMPANY_ID}/adapters/openclaw-gateway" 2>&1) || {
  echo "WARNING: Failed to configure adapter (Paperclip may not support this endpoint yet)"
  echo "  Response: ${ADAPTER_RESPONSE}"
  echo "  This is non-fatal — adapter config can be applied later."
}

echo ""
echo "Summary:"
echo "  Paperclip URL:       ${PAPERCLIP_URL}"
echo "  Company ID:          ${COMPANY_ID}"
echo "  Adapter:             openclaw-gateway"
echo "  OpenClaw gateway:    ${OPENCLAW_GATEWAY_URL}"
echo ""
echo "✅ Bootstrap complete"
