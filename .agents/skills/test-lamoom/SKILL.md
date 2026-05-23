---
name: test-lamoom
description: >
  End-to-end Lamoom platform test. Proves the full customer journey works:
  session auth → create agent via /create chat → agent in dashboard → widget WebSocket reply.
  Triggers: "test lamoom", "lamoom e2e", "run lamoom test", "verify lamoom", "check lamoom".
---

# Lamoom E2E Test — Platform Quality Gate

## Trigger phrases

`test lamoom` · `lamoom e2e` · `run lamoom test` · `verify lamoom` · `check lamoom`

## MANDATORY RULES

1. Execute every phase in order. No skipping.
2. No mocks. Real browser, real server, real WebSocket.
3. Every phase requires a screenshot saved to `OUT_DIR`.
4. If any BLOCKING phase fails → STOP, report.

## Quick Run

```bash
export AUTH_SECRET=$(grep AUTH_SECRET /opt/webagent/.env | cut -d= -f2-)
node /home/azureuser/workspace/webagent/.agents/skills/test-lamoom/e2e.js
```

Or with overrides:

```bash
LAMOOM_BASE_URL=https://dev.lamoom.com \
LAMOOM_USER_ID=0e3d9d31-2219-42d3-b4d9-1440cbce8682 \
LAMOOM_USER_EMAIL=dzianisvv@gmail.com \
AUTH_SECRET=<secret> \
node .agents/skills/test-lamoom/e2e.js
```

## Prerequisites

- Chrome DevTools Protocol open on `localhost:9222`
- `AUTH_SECRET` accessible (env or `/opt/webagent/.env`)
- Platform deployed and running (`/health` returns ok)

## Auth mechanism

NextAuth v5 with `strategy: "jwt"`. Cookie `__Secure-authjs.session-token` is a JWE
signed with `AUTH_SECRET`. JWT payload **must include both `sub` AND `id`** fields
(both set to `session.user.id`) because `jwt` callback stores it as `token.id` and
`session` callback reads `token.id` — not `token.sub`.

Playwright context must use `ignoreHTTPSErrors: true` (new context, not existing CDP
context) to accept the self-signed cert on `dev.lamoom.com`.

## Phases

| # | Phase | Blocking |
|---|-------|----------|
| 0 | Platform health (`/health`, `/health/openclaw`) | Yes |
| 1 | Session auth + `/dashboard` accessible | Yes |
| 2 | Create agent via `/create` meta-agent chat | Yes |
| 3 | Agent appears in `/dashboard` | No |
| 4 | Widget WebSocket: `auth_ok` + agent reply | No |

## Phase 0: Health — BLOCKING

```bash
curl -sf https://dev.lamoom.com/health           # → {"status":"ok"}
curl -sf https://dev.lamoom.com/health/openclaw   # → {"status":"ok"}
```

## Phase 1: Session + Dashboard — BLOCKING

1. Build JWE JWT via `@auth/core/jwt encode()` with fields:
   - `sub`, `id` (both = USER_ID), `name`, `email`, `isAdmin: true`
   - `salt = '__Secure-authjs.session-token'`
2. Create new Playwright context with `ignoreHTTPSErrors: true`
3. Set cookie `__Secure-authjs.session-token` (secure, httpOnly, sameSite: Lax)
4. GET `/api/auth/session` → verify `user.id` present
5. Navigate to `/dashboard` → verify no redirect to `/login`

**If redirected to /login or user.id missing → STOP.**

## Phase 2: Create Agent — BLOCKING

1. Navigate to `/create`, wait for `networkidle`
2. Check body does NOT contain "Unable to authenticate WebSocket" (would mean ws-ticket rejected)
3. Wait for `textarea:not([disabled])` (timeout 15s) — textarea enables only after WS auth succeeds
4. Record all `data-agent-token="..."` values currently on page (old history)
5. Send: `Create a simple customer support agent for E2ETest-<timestamp> (sells electronics). Website: https://example.com`
6. Poll every 3s for NEW embed token (not in step 4 set) — up to 300s
7. If meta-agent asks for URL: reply `https://example.com`
8. On token found: wait 2s extra for DB write to settle

**Typical time: 30–60s.**

## Phase 3: Dashboard

Navigate to `/dashboard`, verify agent label appears in page text.

## Phase 4: Widget WebSocket

```javascript
ws = new WebSocket('wss://dev.lamoom.com/ws')
// onopen:
ws.send({ type: 'auth', agentToken: embedToken, userId: 'e2e-...' })
// on auth_ok:
ws.send({ type: 'message', content: 'Hello! What products do you sell?' })
// done signal: data.done === true || data.type === 'done'
```

Pass: `auth_ok` received AND agent reply has `content.length > 10`.

## Known Gotchas

- **Stale tokens**: `/create` page shows chat history from previous sessions. Always diff
  tokens before vs after sending message; ignore pre-existing ones.
- **Textarea disabled**: it stays disabled until proxy WS auth succeeds (ws-ticket flow).
  If still disabled after 15s, check `/api/auth/ws-ticket` returns 200 (needs `session.user.id`).
- **JWT `id` field**: without `id` in the token payload, `session.user.id` is undefined,
  ws-ticket returns 401, WS auth fails, textarea never enables.
- **Self-signed cert**: `ignoreHTTPSErrors: true` must be on `browser.newContext()`,
  not on the existing CDP context — existing contexts don't support this flag.
