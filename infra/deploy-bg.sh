#!/usr/bin/env bash
# Wrapper: runs deploy.sh in background and polls output every 10s.
# Keeps stdout active so tool runners don't kill the process for inactivity.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="/tmp/deploy-bg-$$.log"

nohup "${SCRIPT_DIR}/deploy.sh" "$@" > "${LOG}" 2>&1 &
PID=$!
echo "deploy PID=${PID}, log=${LOG}"

LAST_LINE=0
while kill -0 "${PID}" 2>/dev/null; do
  sleep 10
  TOTAL=$(wc -l < "${LOG}")
  if (( TOTAL > LAST_LINE )); then
    sed -n "$((LAST_LINE+1)),${TOTAL}p" "${LOG}"
    LAST_LINE=${TOTAL}
  else
    echo "... waiting ($(date +%H:%M:%S))"
  fi
done
wait "${PID}"
EXIT=$?

# Print any remaining output
TOTAL=$(wc -l < "${LOG}")
if (( TOTAL > LAST_LINE )); then
  sed -n "$((LAST_LINE+1)),${TOTAL}p" "${LOG}"
fi

if (( EXIT == 0 )); then
  echo "✅ Deploy finished successfully"
else
  echo "❌ Deploy failed (exit ${EXIT})"
fi
exit "${EXIT}"
