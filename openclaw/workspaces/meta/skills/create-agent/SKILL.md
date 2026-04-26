---
name: create-agent
description: Create and configure a new customer AI agent for the WebAgent platform. Generates workspace files, API skill, and embeddable widget code.
user-invocable: true
metadata: {"openclaw": {"always": true}}
---

# create-agent

Creates a fully configured customer agent after Phase 1 discovery.

## Hard rules
- **Never use `exec`, shell commands, or CLI process spawning.**
- Use only built-in file tools (`read`, `write`, `edit`).
- `write` creates missing parent directories automatically.

## Inputs you must carry from discovery

Before writing files, ensure you have:
- website name + URL
- product summary and top use cases
- API status (API available vs knowledge-base-only)
- canonical links (docs/get-started, pricing, support/contact, install/extension if available)

If links are missing, infer from fetched content and include only verified URLs.

## 4-Step Flow

### Step 1 — Generate workspace files via `write`

Derive:
- `agentSlug` = website name lowercased, non-alphanumeric collapsed to hyphens, trim edge hyphens, then append `-<customerIdFirst8>` (first 8 chars of customer ID) for customer-unique slugs.
- `workspacePath` = `/opt/webagent/openclaw/workspaces/<agentSlug>`

Read templates from `templates/` directory (relative to this workspace) as starting point, then `write`:
- `<workspacePath>/AGENTS.md` — agent personality and instructions
- `<workspacePath>/SOUL.md` — brand voice and values
- `<workspacePath>/IDENTITY.md` — name and role
- `<workspacePath>/USER.md` — expected user context
- `<workspacePath>/skills/website-knowledge/SKILL.md` — knowledge skill grounded in website facts and links
- `<workspacePath>/skills/website-api/SKILL.md` — API interaction skill (only if API exists)
- `<workspacePath>/knowledgebase/overview.md` — product summary + capabilities
- `<workspacePath>/knowledgebase/key-links.md` — canonical visitor links
- `<workspacePath>/knowledgebase/use-cases.md` — concrete role/use-case examples

Fill all files with customer-specific values (website name, product, API details, tone, links).

### Step 2 — Quality bar for generated knowledge

In generated files, always include:
1. What the product does (plain language, no hype).
2. Who it is for (audiences/use-cases).
3. What can be done right now vs future/unknown.
4. Direct links for:
   - install/onboarding (if present),
   - docs/get-started,
   - pricing,
   - support/contact.
5. A rule in AGENTS/knowledge skill: when asked "how do I install", return the direct install link (and docs link) explicitly.

### Step 3 — Write agent config file

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

### Step 4 — Signal completion to proxy

Include the exact marker `[AGENT_CREATED::<agentSlug>]` in your response message. The proxy will:
1. Read `agent-config.json` from the workspace
2. Create DB records (agent + embed token)
3. Register the agent in OpenClaw gateway config
4. Restart the gateway so it picks up the new agent
5. Append the widget embed code to the response

Tell the customer: "Your agent has been created! The embed code will appear below."
Also include discovered onboarding/install links in the response when available.

**Do NOT** attempt to edit `openclaw.json` or `openclaw.json5` — the proxy handles registration automatically.
