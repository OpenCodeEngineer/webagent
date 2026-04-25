---
name: e2e-test
description: >
  Run end-to-end tests against the live Lamoom platform. Triggers on "run tests",
  "run e2e", "test the system", "test end to end", "verify the flow", "smoke test",
  "does it work", "is the bot real", "record demo", "show me the flow".
  Tests verify AI liveness (not hardcoded), response variability, contextual
  relevance, session memory, and API structure. Can record a visual demo GIF.
---

# E2E Test Skill

Three tools: **API liveness tests** (fast, headless), **visual demo recorder** (browser + GIF), and **full E2E flow test** (protocol-level, tests the complete product lifecycle).

## When to Run

- After ANY change to proxy routes, OpenClaw client, or meta-agent config
- After deployments to the VM
- When asked to "test", "verify", or "check if it works"
- When asked to "record demo", "show me the flow", or "make a GIF"
- As a gate before creating PRs

## 1. AI Liveness Tests (API-level)

Fast headless tests — 7 checks against the proxy API, no browser needed.

```bash
chmod +x .agents/skills/e2e-playwright-test/scripts/test-ai-liveness.sh
source .env 2>/dev/null || true
.agents/skills/e2e-playwright-test/scripts/test-ai-liveness.sh \
  "${PROXY_URL:-https://dev.lamoom.com}" \
  "${PROXY_API_TOKEN:-${NEXT_PUBLIC_PROXY_API_TOKEN}}"
```

On the VM:
```bash
ssh root@78.47.152.177 'cd /opt/webagent && source .env && \
  bash .agents/skills/e2e-playwright-test/scripts/test-ai-liveness.sh \
  http://localhost:3001 "$PROXY_CUSTOMER_API_TOKEN"'
```

## 2. Visual Demo Recorder (Browser + GIF)

Records the full UI flow as step-by-step screenshots + video → GIF.
Requires: `playwright`, `ffmpeg`.

```bash
npx tsx .agents/skills/e2e-playwright-test/scripts/record-demo.ts [BASE_URL]
```

Env vars:
- `BASE_URL` — defaults to `https://dev.lamoom.com`
- `OUTPUT_DIR` — defaults to `./e2e-demo-output`
- `TEST_EMAIL` / `TEST_PASSWORD` — login credentials (any work with current auth)

Outputs in `OUTPUT_DIR/`:
- `step-01-*.png` through `step-N-*.png` — annotated screenshots per step
- `demo.gif` — screenshots assembled at 3s/frame
- `demo-video.gif` — browser video recording converted to GIF
- `*.webm` — raw Playwright video

### Flow Recorded

1. Login page → fill credentials → submit
2. Dashboard loads → click "Create New Agent"
3. Create page → wait for meta-agent AI greeting
4. Type pottery shop description → wait for AI response
5. Type tone preference → wait for AI response
6. Check for embed code snippet

## 3. Full E2E Flow Test (Protocol-level)

Tests the **complete product lifecycle** at the protocol level using `curl` + inline Node.js (for WebSocket). No browser needed. Covers: health checks → agent creation via meta-agent → agent verification → widget chat over WebSocket.

```bash
chmod +x .agents/skills/e2e-playwright-test/scripts/test-e2e-full.sh
source .env 2>/dev/null || true
.agents/skills/e2e-playwright-test/scripts/test-e2e-full.sh \
  "${PROXY_URL:-https://dev.lamoom.com}" \
  "${PROXY_API_TOKEN:-${NEXT_PUBLIC_PROXY_API_TOKEN}}"
```

On the VM:
```bash
ssh root@78.47.152.177 'cd /opt/webagent && source .env && \
  OPENCLAW_WORKSPACES_DIR=/opt/webagent/openclaw/workspaces \
  bash .agents/skills/e2e-playwright-test/scripts/test-e2e-full.sh \
  http://localhost:3001 "$PROXY_CUSTOMER_API_TOKEN"'
```

### Test Phases

| Phase | Tests | What it covers |
|-------|-------|----------------|
| 1. Infrastructure Health | T1–T3 | `/health`, `/health/openclaw`, `/widget.js` |
| 2. Agent Creation | T4–T6 | Meta-agent greeting → describe business → confirm & create (full 5-step flow) |
| 3. Agent Verification | T7–T8 | Agent appears in `GET /api/agents` list; workspace files on disk (if local) |
| 4. Widget Chat (WS) | T9–T10 | WebSocket auth with embed token; send message and get AI response from created agent |

### Key Features

- **Cascading state**: sessionId, embedToken, and agentSlug flow between phases
- **Smart skipping**: if Phase 2 fails, Phase 3–4 tests are skipped (not falsely failed)
- **WebSocket tests**: uses inline Node.js with the `ws` module (transitive dep of `@fastify/websocket`)
- **Long timeouts**: agent creation (T6) allows up to 180s for the meta-agent's 5-step file creation
- **SSL flexibility**: all curl calls use `-k` for self-signed certs

### Environment Variables

| Var | Required | Description |
|-----|----------|-------------|
| `PROXY_URL` / `BASE_URL` | No | Defaults to `https://dev.lamoom.com` |
| `PROXY_API_TOKEN` | **Yes** | Bearer token for proxy auth |
| `TEST_CUSTOMER_ID` | No | UUID, auto-generated if not set |
| `OPENCLAW_WORKSPACES_DIR` | No | Path to workspaces dir for T8 disk check |

---

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
