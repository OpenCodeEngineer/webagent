---
name: create-agent
description: Create and configure a new customer AI agent for the WebAgent platform. Generates workspace files, API skill, and embeddable widget code.
user-invocable: true
metadata: {"openclaw": {"always": true}}
---

# create-agent

Creates a fully configured customer agent. Assumes discovery is already done (AGENTS.md Phase 1).

## Hard rules
- **Never use `exec`, shell commands, or CLI process spawning.**
- Use only built-in file tools (`read`, `write`, `edit`).
- `write` creates missing parent directories automatically.

## 3-Step Flow

### Step 1 — Generate workspace files via `write`

Derive:
- `agentSlug` = website name lowercased, non-alphanumeric collapsed to hyphens, trim edge hyphens.
- `workspacePath` = `workspaces/<agentSlug>/` (relative to current workspace root)

Read templates from `templates/` as starting point, then `write`:
- `<workspacePath>/AGENTS.md` — agent personality and instructions
- `<workspacePath>/SOUL.md` — brand voice and values
- `<workspacePath>/IDENTITY.md` — name and role
- `<workspacePath>/USER.md` — expected user context
- `<workspacePath>/skills/website-api/SKILL.md` — API interaction skill (if API exists, else knowledge-base skill)

Fill all files with customer-specific values (website name, product, API details, tone).

### Step 2 — Write agent config file

`write` a JSON file at `<workspacePath>/agent-config.json`:
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

### Step 3 — Signal completion to proxy

Include the exact marker `[AGENT_CREATED::<agentSlug>]` in your response message. The proxy will:
1. Read `agent-config.json` from the workspace
2. Create DB records (agent + embed token)
3. Register the agent in OpenClaw gateway config
4. Restart the gateway so it picks up the new agent
5. Append the widget embed code to the response

Tell the customer: "Your agent has been created! The embed code will appear below."

**Do NOT** attempt to edit `openclaw.json` or `openclaw.json5` — the proxy handles registration automatically.
