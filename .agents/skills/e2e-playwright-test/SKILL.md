---
name: e2e-test
description: >
  Run end-to-end tests against the live Lamoom platform. Triggers on "run tests",
  "run e2e", "test the system", "test end to end", "verify the flow", "smoke test",
  "does it work", "is the bot real". Tests verify AI liveness (not hardcoded),
  response variability, contextual relevance, session memory, and API structure.
---

# E2E Test Skill

Run real integration tests against the live system to verify the AI agent is working
correctly and is NOT hardcoded.

## When to Run

- After ANY change to proxy routes, OpenClaw client, or meta-agent config
- After deployments to the VM
- When asked to "test", "verify", or "check if it works"
- As a gate before creating PRs

## Quick Run

```bash
chmod +x .agents/skills/e2e-playwright-test/scripts/test-ai-liveness.sh
# Load env vars (locally or on VM)
source .env 2>/dev/null || true
.agents/skills/e2e-playwright-test/scripts/test-ai-liveness.sh \
  "${PROXY_URL:-https://dev.lamoom.com}" \
  "${PROXY_API_TOKEN:-${NEXT_PUBLIC_PROXY_API_TOKEN}}"
```

Or on the VM directly:
```bash
ssh root@78.47.152.177 'cd /opt/webagent && source .env && \
  bash .agents/skills/e2e-playwright-test/scripts/test-ai-liveness.sh \
  http://localhost:3001 "$PROXY_CUSTOMER_API_TOKEN"'
```

## What It Tests

| # | Test | What it catches |
|---|------|-----------------|
| 1 | Basic connectivity | Proxy down, auth broken, OpenClaw unreachable |
| 2 | Not hardcoded pattern | Known canned responses |
| 3 | **Variability** | **HARDCODED BOT** — same input must produce different output |
| 4 | Contextual relevance | Bot ignores user input, generic canned reply |
| 5 | Session memory | Sessions broken, no context carry-over |
| 6 | Off-script handling | Bot can only follow a script, crashes on unexpected input |
| 7 | Response structure | API envelope shape changed, fields missing |

**Test 3 (variability) is the critical one.** A hardcoded bot returns identical responses
to identical inputs. A real LLM never does (temperature > 0).

## Interpreting Failures

- **Test 1 fails**: Check proxy is running, API token is correct, OpenClaw gateway is up
- **Test 3 fails ("HARDCODED BOT DETECTED")**: Someone replaced the real AI integration
  with static responses. Inspect `packages/proxy/src/openclaw/client.ts` and
  `packages/proxy/src/routes/api.ts` for hardcoded strings.
- **Test 4/5 fails**: The AI is real but may not have proper context/session handling.
  Check the `--session-id` flag in OpenClawClient and session key format.
- **Test 6 fails**: AI may be too rigidly prompted. Check meta-agent SOUL.md/IDENTITY.md.

## Adding New Tests

Edit `scripts/test-ai-liveness.sh`. Each test follows the pattern:
1. Call `call_meta` with messages JSON and optional sessionId
2. Extract response with `extract_response`
3. Assert with `pass`/`fail`/`skip`

Keep tests independent — each creates its own session unless testing memory.

## Environment Variables

| Var | Required | Description |
|-----|----------|-------------|
| `PROXY_URL` | No | Defaults to `https://dev.lamoom.com` |
| `PROXY_API_TOKEN` | Yes | Bearer token for proxy auth |
| `TEST_CUSTOMER_ID` | No | UUID, defaults to test customer |
