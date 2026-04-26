---
name: create-agent
description: Create and configure a new customer AI agent for the WebAgent platform. Generates workspace files, API skill, and embeddable widget code.
user-invocable: true
metadata: {"openclaw": {"always": true}}
---

# create-agent

This skill creates a fully configured customer agent for the WebAgent platform with a strict no-shell workflow.

## Hard rules
- **Never use `exec`, shell commands, or CLI process spawning** during this flow.
- Use only built-in file tools (`read`, `write`, `edit`).
- For file creation, prefer `write` directly: **`write` creates missing parent directories automatically**.

## 4-Step Flow

### Step 1 — Discover and confirm
When the customer provides a website URL:
1. Use the `web` tool to fetch the website homepage
2. Try to fetch API documentation (`/api`, `/docs`, `/swagger.json`, `/openapi.json`)
3. From the fetched content, infer: `websiteName`, `websiteUrl`, product summary, audience, tone, and API details
4. Present a compact summary and get explicit customer confirmation

If web fetch fails or returns limited info, fall back to asking the customer directly.
Collect and confirm: `websiteName`, `websiteUrl`, product summary, API style/base URL/key endpoints, and personality/tone.

### Step 2 — Generate workspace files via `write`
Derive:
- `agentSlug` = website name lowercased, non-alphanumeric collapsed to hyphens, trim edge hyphens.
- `workspacePath` = `~/openclaw/workspaces/<agentSlug>/`

Using templates in `~/openclaw/templates/` as the starting point (these are inside the workspace), render and `write`:
- `<workspacePath>/AGENTS.md`
- `<workspacePath>/SOUL.md`
- `<workspacePath>/IDENTITY.md`
- `<workspacePath>/USER.md`
- `<workspacePath>/skills/website-api/SKILL.md`

All files must be filled with customer-provided values (website/product, API details, tone/personality).

### Step 3 — Write agent config file
After generating workspace files, `write` a structured JSON file:
- Path: `<workspacePath>/agent-config.json`
- Content:
```json
{
  "agentSlug": "<agentSlug>",
  "agentName": "<agentName>",
  "websiteName": "<websiteName>",
  "websiteUrl": "<websiteUrl>",
  "apiDescription": "<short description of API capabilities>",
  "apiBaseUrl": "<API base URL if provided>",
  "createdAt": "<ISO timestamp>"
}
```

### Step 4 — Signal completion to proxy
Include the exact marker `[AGENT_CREATED::<agentSlug>]` somewhere in the response message. The proxy will:
1. Read `agent-config.json` from the workspace
2. Create DB records (agent + embed token)
3. Register the agent in OpenClaw gateway config
4. Restart the gateway so it picks up the new agent
5. Append the widget embed code to the response

Tell the customer: "Your agent has been created! The embed code will appear below."

**Do NOT** attempt to edit `openclaw.json` or `openclaw.json5` — the proxy handles agent registration automatically.
