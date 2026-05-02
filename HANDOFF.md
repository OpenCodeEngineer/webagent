# MVP Handoff

> **Updated**: 2026-04-28
> **Branch**: `main` (all work merged)
> **Deployed**: commit `7570b44` (PR #190) live on dev.lamoom.com

---

## DONE

- **Server-side auth context injection** (PR #190, merged & deployed)
  - `lookupEmbedToken()` returns `widgetConfig`, injects `authContext` into widget sessions
  - "Never reveal credentials" policy in session context
  - Server auth wins over client context for auth fields
  - PATCH deep-merges `widgetConfig` (preserves `skills`)
  - Cache invalidation on widgetConfig changes
  - `authContext` redacted from GET API responses
- **Auth context config UI** on agent detail page (`agent-auth-context.tsx`)
- **Widget preview cleanup** (iframe title fixed)
- **QA skill hardened** with strict verdict matrix, evidence requirements, false-positive gates
- **Intent-echo rules** (agent states exact API call before executing)
- **Refresh-workspace endpoint** (`POST /api/admin/agents/:id/refresh-workspace`)
- **Agent detail UX** simplified ("Chat" label, no "Test Your Widget" framing)
- **API surface KB** (`openclaw/workspaces/meta/knowledgebase/openclaw-console-api-surface.md`)
- **Meta templates** updated with never-request-browser-token rule
- **Unknown-agent self-heal** in WS handler
- **Deploy verified** (health, static assets, services all green)

---

## REMAINING (next session picks up here)

### 1. Configure Auth Context on an Existing Agent (CRITICAL)
The code is deployed but no agent has auth context configured yet. Steps:
1. Go to `https://dev.lamoom.com/dashboard`
2. Click "View" on an active agent
3. Find the new "API Configuration" card
4. Enter the OpenClaw Console API token (Bearer token for `https://admin.openclaw.vibebrowser.app/api/v1/`)
5. Click Save

To get the API token, check the OpenClaw Console admin or the OpenClawBot source:
```bash
ssh root@78.47.152.177 'grep -i "api.*token\|bearer\|auth" /opt/OpenClawBot/.env 2>/dev/null | head -5'
```

Alternatively, use the PATCH API directly:
```bash
AGENT_ID="<uuid>"  # from DB
TOKEN="<proxy-api-token>"
API_TOKEN="<openclaw-console-api-token>"
curl -X PATCH "https://dev.lamoom.com/api/agents/$AGENT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"widgetConfig\":{\"authContext\":{\"apiToken\":\"$API_TOKEN\"}}}"
```

### 2. Validate Widget Agent Can Execute API Calls
After configuring auth context:
1. Open the agent detail page widget chat
2. Ask: "List my tenants" or "Restart deployment X"
3. The agent should use the injected token in fetch calls
4. Should NOT ask user for JWT/Bearer token

### 3. Run Full QA (`.agents/skills/e2e-playwright-test/SKILL.md`)
The hardened QA protocol with strict release gates. Key phases:
- Phase 5: Widget chat works with auth context
- Phase 10: Restart/list critical path passes
- Verdict must be READY for MVP sign-off

### 4. Fix Any Issues QA Surfaces
The QA skill will identify remaining gaps. Common expected issues:
- Agent workspace may need refresh after auth context config
  (use `POST /api/admin/agents/:id/refresh-workspace`)
- Streaming indicators may need verification
- Markdown rendering in responses

---

## Architecture Reference

### Auth Context Flow
```
1. Admin sets API token via agent detail page (PATCH /api/agents/:id)
2. Token stored in agents.widgetConfig.authContext (JSONB)
3. Widget connects via WS, authenticates with embed token
4. Proxy reads agent's widgetConfig.authContext from DB
5. Injects into state.userContext via normalizeSessionAuthContext()
6. buildWidgetMessageWithSessionPolicy() prepends auth context to messages
7. Agent LLM sees credentials, uses in fetch() tool calls
8. "Never reveal credentials" instruction prevents leakage
```

### Key Files
| File | Purpose |
|------|---------|
| `packages/proxy/src/ws/handler.ts` | WS auth, session policy, auth context injection |
| `packages/proxy/src/routes/api.ts` | PATCH deep-merge, cache invalidation, auth redaction |
| `packages/proxy/src/routes/admin-api.ts` | refresh-workspace endpoint |
| `packages/admin/src/components/agent-auth-context.tsx` | Auth config UI |
| `packages/admin/src/app/dashboard/agents/[id]/page.tsx` | Agent detail page |
| `openclaw/workspaces/meta/knowledgebase/openclaw-console-api-surface.md` | API reference KB |
| `.agents/skills/e2e-playwright-test/SKILL.md` | QA protocol |

### VM Access
- **Production**: `root@78.47.152.177` (services: webagent-proxy, webagent-admin, openclaw-gateway)
- **Dev workspace**: `azureuser@100.108.64.76` (OpenCode at port 4096)
- **Docker**: lamoom-librechat on prod VM
- **Workspaces**: `/opt/webagent/openclaw/workspaces/<agent-id>/`

### Relevant PRs
- #189: QA hardening + handoff doc + meta templates (merged)
- #190: Server-side auth context injection (merged & deployed)
