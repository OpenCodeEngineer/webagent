# MVP Handoff — Auth Context Fix + Deploy + QA

> **Created**: 2025-07-21
> **Branch**: `fix/regression-api-restart-intent` (2 commits ahead of main)
> **Target**: Make widget agents capable of executing API calls (restart, list tenants, etc.)

---

## Current State

### What's Done (committed on branch)
- **QA skill hardened** — strict verdict matrix, evidence requirements, false-positive gates
- **Intent-echo rules** — agent states exact API call before executing
- **Refresh-workspace endpoint** — `POST /api/admin/agents/:id/refresh-workspace`
- **Agent detail page UX** — simplified "Chat" label with MessageCircle icon (no more "Test Your Widget" framing)
- **API surface KB** — `openclaw/workspaces/meta/knowledgebase/openclaw-console-api-surface.md`
- **Meta templates updated** — never-request-browser-token rule, concrete endpoint guidance
- **Unknown-agent self-heal** — WS handler retries after registering agent with gateway

### What's Uncommitted (local only)
- Minor QA skill script tweaks (3 files, 7 lines changed)

### What's NOT Done (the remaining MVP gap)
These items are the **sole blockers** preventing MVP readiness:

---

## Task 1: Server-Side Auth Context Injection (CRITICAL)

**Problem**: Widget agents have no auth credentials. When asked to "restart deployment" or "list tenants," the agent hallucinates about finding tokens in DevTools.

**Root Cause**: `buildWidgetMessageWithSessionPolicy()` in `packages/proxy/src/ws/handler.ts` injects session context into messages, but `state.userContext` is always empty because nobody configures it.

**Solution**: Store auth context in `agents.widgetConfig.authContext` (JSONB). On widget WS auth, read it and inject into session.

### Implementation Details

#### 1a. Modify `lookupEmbedToken()` (handler.ts ~line 418)
Add `widgetConfig` to the SELECT:
```typescript
// Current:
.select({
  agentId: agents.id,
  openclawAgentId: agents.openclawAgentId,
  allowedOrigins: widgetEmbeds.allowedOrigins,
})

// Change to:
.select({
  agentId: agents.id,
  openclawAgentId: agents.openclawAgentId,
  allowedOrigins: widgetEmbeds.allowedOrigins,
  widgetConfig: agents.widgetConfig,
})
```

Update `TokenLookup` interface:
```typescript
interface TokenLookup {
  agentId: string;
  openclawAgentId: string;
  allowedOrigins: string[] | null;
  widgetConfig: Record<string, unknown> | null;
}
```

#### 1b. Inject auth context after widget auth (handler.ts ~line 575-601)
After `state.openclawAgentId = tokenData.openclawAgentId;`:
```typescript
// Inject server-side auth context from agent config
const serverAuthCtx = tokenData.widgetConfig?.authContext;
if (serverAuthCtx && typeof serverAuthCtx === 'object' && !Array.isArray(serverAuthCtx)) {
  state.userContext = normalizeSessionAuthContext(serverAuthCtx as Record<string, unknown>);
}

// Client context can add NON-auth fields only (safety)
const rawContext = msg.context;
if (rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext)) {
  const clientCtx = rawContext as Record<string, unknown>;
  const AUTH_KEYS = new Set(['Authorization', 'Bearer', 'apiToken', 'token', 'headers']);
  for (const [k, v] of Object.entries(clientCtx)) {
    if (!AUTH_KEYS.has(k)) {
      state.userContext[k] = v;
    }
  }
  if (Object.keys(state.userContext).length > 0) {
    state.firstMessage = true;
  }
}
```

#### 1c. Add "never reveal credentials" to session policy (handler.ts ~line 246)
In `buildWidgetMessageWithSessionPolicy`, add to `credentialPolicy`:
```
'Never reveal, display, echo, or include raw credential/token values in your responses. '
+ 'Use them ONLY in fetch/API tool call headers. If a user asks for the token, decline.'
```

### Key Files
- `packages/proxy/src/ws/handler.ts` — main changes
- `packages/proxy/src/routes/api.ts` — PATCH endpoint fix
- `packages/proxy/src/routes/admin-api.ts` — GET response redaction

---

## Task 2: PATCH Deep-Merge + Cache Invalidation

**Problem**: `PATCH /api/agents/:id` with `{ widgetConfig: { authContext: {...} } }` replaces the entire `widgetConfig`, deleting existing `skills` etc.

**Solution**: Deep-merge `widgetConfig` in the PATCH handler.

### Implementation Details

#### 2a. Deep-merge in PATCH (api.ts ~line 831)
```typescript
// Before .set():
const mergedBody = { ...body };
if (body.widgetConfig && existingAgent.widgetConfig) {
  mergedBody.widgetConfig = {
    ...(existingAgent.widgetConfig as Record<string, unknown>),
    ...body.widgetConfig,
  };
}

const updatedRows = await app.db
  .update(agents)
  .set({
    ...mergedBody,
    updatedAt: new Date(),
  })
  // ...
```

#### 2b. Cache invalidation on widgetConfig change (api.ts ~line 849)
Add after the existing status-change cache invalidation:
```typescript
if (body.widgetConfig) {
  const embedRows = await app.db
    .select({ embedToken: widgetEmbeds.embedToken })
    .from(widgetEmbeds)
    .where(eq(widgetEmbeds.agentId, params.id));
  for (const embedRow of embedRows) {
    invalidateEmbedTokenCache(embedRow.embedToken);
  }
}
```

#### 2c. Redact authContext from GET responses
In admin-api.ts GET endpoints that return agents, strip `widgetConfig.authContext` before sending.

### Key Files
- `packages/proxy/src/routes/api.ts` — PATCH fix + cache invalidation
- `packages/proxy/src/routes/admin-api.ts` — response redaction

---

## Task 3: Auth Context Config UI

**Problem**: No way for admins to configure the API token for an agent.

**Solution**: Add a simple card to the agent detail page.

### Implementation Details

Create `packages/admin/src/components/agent-auth-context.tsx`:
- Client component ("use client")
- Simple card with:
  - "API Configuration" title
  - "API Token" password input field
  - "Save" button
- Reads current value from agent's `widgetConfig.authContext.apiToken`
- Saves via `PATCH /api/agents/:id` with `{ widgetConfig: { authContext: { apiToken: value } } }`
- Uses existing auth/API infrastructure in the admin app

Add to `packages/admin/src/app/dashboard/agents/[id]/page.tsx`:
- Insert between Embed Code card and Chat section
- Only show if agent is active

---

## Task 4: Widget Preview Cleanup (Minor)

- `packages/admin/src/components/widget-preview.tsx` line 36: change `title="Real widget preview"` → `title="Widget preview"`

---

## Task 5: Deploy + QA

### Deploy Steps
```bash
ssh root@78.47.152.177
cd /opt/webagent
git pull origin main
pnpm install --frozen-lockfile
npx turbo run build
set -a; source .env; set +a
npx drizzle-kit migrate
cp -r packages/admin/.next/static packages/admin/.next/standalone/packages/admin/.next/static
systemctl restart webagent-proxy webagent-admin
# Verify:
curl -sk https://dev.lamoom.com/health
curl -sk https://dev.lamoom.com/health/openclaw
```

### Post-Deploy: Configure Auth Context
1. Find an existing agent in the dashboard
2. Set the API token for the OpenClaw Console API
3. Test widget chat: ask "list my tenants" or "restart deployment"

### QA
Run the full E2E QA skill (`.agents/skills/e2e-playwright-test/SKILL.md`).
Key phases to verify:
- Phase 5: Widget chat works with auth context
- Phase 10: Restart/list critical path passes

---

## Architecture Notes

### Why Token in Prompt?
OpenClaw agents use `fetch` tool to make HTTP calls. The LLM generates the full `fetch` call including headers. There's no server-side credential injection in OpenClaw's tool runtime. The token MUST be visible to the LLM to generate correct API calls. Mitigated by:
- Strong "never reveal credentials" instruction in session policy
- Redacting from API GET responses
- Server-side auth context takes priority (untrusted client can't override)

### Data Model
```
agents.widgetConfig (JSONB):
{
  "skills": ["website-api"],
  "authContext": {
    "apiToken": "actual-token-value",
    "Authorization": "Bearer actual-token-value"  // auto-normalized
  }
}
```

### WS Auth Flow (after fix)
1. Widget connects → sends `{type:"auth", token:"embed-token", userId:"..."}`
2. Proxy looks up embed token → gets agent + widgetConfig
3. Extracts `widgetConfig.authContext` → injects into `state.userContext`
4. On message, `buildWidgetMessageWithSessionPolicy()` prepends auth context to prompt
5. Agent sees credentials → can use in `fetch` tool calls

### Relevant PRs/Branches
- Current branch: `fix/regression-api-restart-intent` (2 ahead of main)
- Unmerged: PR #184 (`fix/regression-chat-ui-section`) — agent detail UX
- These should be merged to main before starting new work

### VM Access
- `root@78.47.152.177`
- Services: webagent-proxy, webagent-admin, openclaw-gateway
- Docker: lamoom-librechat
- Workspace: `/opt/webagent/`
