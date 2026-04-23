---
name: create-agent
description: Create and configure a new customer AI agent for the WebAgent platform. Generates workspace files, API skill, OpenClaw config, and embeddable widget code.
user-invocable: true
metadata: {"openclaw": {"always": true}}
---

# create-agent

This skill creates a fully configured customer agent for the WebAgent platform with a strict no-shell workflow.

## Hard rules
- **Never use `exec`, shell commands, or CLI process spawning** during this flow.
- Use only built-in file tools (`read`, `write`, `edit`) and built-in HTTP tools (`web`/`fetch`).
- For file creation, prefer `write` directly: **`write` creates missing parent directories automatically**.

## 5-Step Flow

### Step 1 — Gather info conversationally and confirm understanding
Collect and confirm:
- Website/product: `websiteName`, `websiteUrl`, and product summary.
- API details: API style (`REST`/`GraphQL`), base URL, authentication method, and key endpoints/actions.
- Personality/tone: how the assistant should sound and behave.

Before generating anything, send a compact confirmation summary and get explicit customer confirmation that details are correct.

### Step 2 — Generate workspace files via `write`
Derive:
- `agentSlug` = website name lowercased, non-alphanumeric collapsed to hyphens, trim edge hyphens.
- `workspacePath` = `~/openclaw/workspaces/<agentSlug>/`

Using templates in `openclaw/templates/` as the starting point, render and `write`:
- `<workspacePath>/AGENTS.md`
- `<workspacePath>/SOUL.md`
- `<workspacePath>/IDENTITY.md`
- `<workspacePath>/USER.md`
- `<workspacePath>/skills/website-api/SKILL.md`

All files must be filled with customer-provided values (website/product, API details, tone/personality).

### Step 3 — Register agent in OpenClaw config via `read` + `edit`
1. `read` `~/openclaw/config/openclaw.json5`
2. `edit` `agents.list` to add:
   - `id`: `<agentSlug>`
   - `name`: `<agentName>`
   - `workspace`: `<workspacePath>`
   - `skills`: `["website-api"]`
   - `heartbeat`: `{ every: "30m" }`

Mention to the customer/operator that OpenClaw uses **hybrid hot-reload**, so `agents.*` config updates are picked up without full restart.

### Step 4 — Register in proxy DB via HTTP POST (no curl/exec)
Use built-in `web`/`fetch` tool to call:
- `POST http://localhost:3001/api/internal/agents`

JSON body:
```json
{
  "customerId": "<from session context>",
  "openclawAgentId": "<agentSlug>",
  "name": "<agentName>",
  "websiteUrl": "<websiteUrl>",
  "apiDescription": "<apiDescription>"
}
```

Expect response shape:
```json
{ "agent": { ... }, "embedToken": "..." }
```

### Step 5 — Generate embed snippet and deliver usage
Use returned `embedToken` to create:
- `<workspacePath>/embed-snippet.html`

Snippet format:
```html
<script
  src="https://{{DOMAIN}}/widget.js"
  data-agent-token="{{embedToken}}"
  data-user-id=""
></script>
```

Then present:
1. Agent ID and name
2. The embed snippet
3. Where to paste it (`before </body>`)
4. Reminder that they can return to update behavior or API actions
