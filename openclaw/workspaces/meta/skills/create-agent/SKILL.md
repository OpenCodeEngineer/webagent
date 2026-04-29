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

### Step 0 — Select templates (BEFORE writing files)

Before generating, scan the `templates/` directory (relative to this workspace) for **specialized templates** that match the target website. Specialized templates have a site-specific suffix — for example:
- `AGENTS-openclaw-console-navigation.md` → use for openclaw console agents instead of generic `AGENTS.md`
- `skills/openclaw-console-navigation/SKILL.md` → include as an extra skill
- `knowledgebase/openclaw-console-navigation.md` → fallback specialized knowledgebase template

For OpenClaw Console targets (`openclaw.vibebrowser.app/console`), deterministically prefer the canonical KB at:
- `openclaw/workspaces/meta/knowledgebase/openclaw-console-api-surface.md`

Copy this canonical KB into `<workspacePath>/knowledgebase/api-reference.md` as the primary API reference, then layer customer-specific naming/context only if needed without changing endpoint/auth contract semantics.
Do not synthesize or rewrite OpenClaw `/api/v1` contracts from memory when this KB is available.

**Selection rule:** if a specialized template matches the website being onboarded, prefer it over the generic template. Copy its content as-is (filling only genuinely dynamic values like names/URLs), because specialized templates already contain verified endpoint tables, auth flows, and canonical links.

### Step 1 — Generate workspace files via `write`

Derive:
- `agentSlug` = website name lowercased, non-alphanumeric collapsed to hyphens, trim edge hyphens, then append `-<customerIdFirst8>` (first 8 chars of customer ID) for customer-unique slugs.
- `workspacePath` = `/opt/webagent/openclaw/workspaces/<agentSlug>`

Read templates from `templates/` directory as starting point (using specialized templates from Step 0 when available), then `write`:
- `<workspacePath>/AGENTS.md` — agent personality and instructions (use specialized AGENTS template if found)
- `<workspacePath>/SOUL.md` — brand voice and values
- `<workspacePath>/IDENTITY.md` — name and role
- `<workspacePath>/TOOLS.md` — environment/local operational notes (no secrets)
- `<workspacePath>/USER.md` — expected user context
- `<workspacePath>/skills/website-knowledge/SKILL.md` — knowledge skill grounded in website facts and links
- `<workspacePath>/skills/website-api/SKILL.md` — API interaction skill (only if API exists)
- Any specialized skills found in Step 0 (e.g., `<workspacePath>/skills/openclaw-console-navigation/SKILL.md`)
- `<workspacePath>/knowledgebase/overview.md` — product summary + capabilities
- `<workspacePath>/knowledgebase/key-links.md` — canonical visitor links
- `<workspacePath>/knowledgebase/use-cases.md` — concrete role/use-case examples
- `<workspacePath>/knowledgebase/api-reference.md` — **required when API exists**: full endpoint table with method, path, request body, response shape, and auth requirements. For OpenClaw Console targets, use `openclaw/workspaces/meta/knowledgebase/openclaw-console-api-surface.md` first; otherwise use specialized template if found.

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
6. `TOOLS.md` entries for practical operator context (API base URL, auth scheme, important integration labels) without storing credentials or secrets.

**API quality bar (when API exists):**
7. `knowledgebase/api-reference.md` must contain a **structured endpoint table** with columns: Method, Path, Description, Request Body (if applicable), Response Shape.
8. The `website-api` skill's `Available Actions` section must list **every** API endpoint as a table row — never omit endpoints mentioned in the user prompt or discovered during due diligence.
9. The `website-api` skill must include `fetch` tool usage examples specific to the API (correct base URL, auth header format, content type).
10. For mutating endpoints (POST, PUT, DELETE, PATCH), the skill must include the exact request body shape.
11. Credential source policy must be explicit: use platform-provided session auth context; never instruct end users to scrape DevTools/localStorage/cookies for tokens.
12. Missing-credential fallback must be concrete and safe: ask admin/integrator to configure backend session auth context keys in this exact order (`Authorization`, `Bearer`, `apiToken`, `headers`), then retry the named API call.
13. For OpenClaw Console targets, `website-api/SKILL.md` must explicitly include:
   - `GET /api/v1/tenants` (list) and
   - `POST /api/v1/tenants/:id/restart` (restart, no body required; `{}` accepted),
   plus exact auth context mapping for `Authorization`/`Bearer`/`apiToken`/`headers`.
14. For OpenClaw Console targets, fail generation if output is vague (for example "I can manage instances") without endpoint+method details and concrete auth context guidance.

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
  "skills": ["website-api", "website-knowledge"],
  "userTokenKey": "<localStorage key holding user JWT, if discoverable — e.g. 'access_token'>",
  "createdAt": "<ISO timestamp>"
}
```

The `userTokenKey` field is **optional but recommended** when the target website stores authentication tokens in `localStorage`. If discovered during website analysis (look for keys like `access_token`, `token`, `jwt`, `auth_token`, `oc_access_token` in the site's JavaScript), include it so the widget can automatically pass the user's token to the agent as session context. If the site uses httpOnly cookies or server-side sessions instead, omit this field.

The `skills` array **must list every skill directory name** created in the workspace. Always include `"website-api"` when an API exists and `"website-knowledge"` for all agents. Add any specialized skills created in Step 1 (e.g., `"openclaw-console-navigation"`). The proxy reads this array to register skills in the gateway config.

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
