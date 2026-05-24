# Lamoom — Technical Design Document

> Last updated: 2026-05-23  
> Companion to `docs/prd.md` (product requirements).

**How to read this document:**  
Part I covers system design — architecture, data flows, protocol, schema, and production status.  
Part II covers implementation conventions, testing strategy, known debt, and ADRs.

---

# Part I: System Design

## TL;DR

SaaS platform where business owners create AI chat agents for their websites.
Customers describe their site/API in natural language to a **meta-agent**, which
provisions a dedicated OpenClaw **product-agent**, generates workspace files (`AGENTS.md`,
`SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `USER.md`) plus skills/knowledgebase files,
and outputs an embeddable widget `<script>` tag. Website visitors chat through the
widget; the proxy maps each `(agent, visitor)` pair to a deterministic OpenClaw
session key.

## Terminology

- **Meta-agent**: the admin-facing agent used on `/create` to discover requirements and generate new agents.
- **Product-agent**: the generated runtime agent that powers widget chat and executes domain tasks (for example, HubSpot CRM actions).

**Repo:** `OpenCodeEngineer/webagent` (pnpm monorepo + Turborepo)

---

## Agent Generation Flow

```
  CUSTOMER                 PROXY                META-AGENT            OPENCLAW
  (Browser)             (Node.js)           (OpenClaw Agent)         (Gateway)
     │                     │                      │                      │
     │  1. Sign up/login   │                      │                      │
     ├────────────────────►│                      │                      │
     │  ◄── customerId ────┤                      │                      │
     │      (UUID v4)      │                      │                      │
     │                     │                      │                      │
═══════════════════════════╪══════════════════════╪══════════════════════╪═══
  PHASE 1 — DISCOVERY      │                      │                      │
═══════════════════════════╪══════════════════════╪══════════════════════╪═══
     │                     │                      │                      │
     │  2. "Create agent   │                      │                      │
     │   for mysite.com"   │                      │                      │
     ├────────────────────►│  3. Forward to meta  │                      │
     │  POST /api/agents/  ├─────────────────────►│                      │
     │  create-via-meta    │  (WS + session key)  │                      │
     │                     │                      │  4. Fetch website    │
     │                     │                      ├──── GET mysite.com   │
     │                     │                      │     GET /docs        │
     │                     │                      │     GET /pricing     │
     │                     │                      │     GET /api         │
     │                     │                      │                      │
     │                     │  5. Due-diligence    │                      │
     │  ◄─────────────────────────────────────────┤                      │
     │  "Here's what I     │  packet: summary,    │                      │
     │   found..."         │  links, use cases    │                      │
     │                     │                      │                      │
     │  6. "Yes, create    │                      │                      │
     │      the agent"     │                      │                      │
     ├────────────────────►├─────────────────────►│                      │
     │                     │                      │                      │
═══════════════════════════╪══════════════════════╪══════════════════════╪═══
  PHASE 2 — GENERATION     │                      │                      │
═══════════════════════════╪══════════════════════╪══════════════════════╪═══
     │                     │                      │                      │
     │                     │                      │  7. create-agent     │
     │                     │                      │     skill runs       │
     │                     │                      │         │            │
     │                     │                      │    ┌────▼──────────┐ │
     │                     │                      │    │ WRITE FILES:  │ │
     │                     │                      │    │               │ │
     │                     │                      │    │ AGENTS.md     │ │
     │                     │                      │    │ SOUL.md       │ │
     │                     │                      │    │ IDENTITY.md   │ │
     │                     │                      │    │ TOOLS.md      │ │
     │                     │                      │    │ USER.md       │ │
     │                     │                      │    │ skills/       │ │
     │                     │                      │    │ knowledgebase/│ │
     │                     │                      │    │ agent-config  │ │
     │                     │                      │    │   .json       │ │
     │                     │                      │    └───────────────┘ │
     │                     │                      │         │            │
     │                     │  8. Response with     │         │            │
     │                     │◄─────────────────────┤         │            │
     │                     │  [AGENT_CREATED::     │    writes to:       │
     │                     │   mysite-<id>]        │    /opt/webagent/   │
     │                     │                      │    openclaw/         │
     │                     │                      │    workspaces/       │
     │                     │                      │    <slug>/           │
═══════════════════════════╪══════════════════════╪══════════════════════╪═══
  PHASE 3 — REGISTRATION   │                      │                      │
═══════════════════════════╪══════════════════════╪══════════════════════╪═══
     │                     │                      │                      │
     │                     │  9. detectAgentCreation()                   │
     │                     │  ┌──────────────────────────┐               │
     │                     │  │ • Read agent-config.json │               │
     │                     │  │ • Add to openclaw.json5  │──────────────►│
     │                     │  │ • INSERT into Postgres   │  SIGHUP       │
     │                     │  │   (agents, widget_embeds)│  reload       │
     │                     │  │ • Generate embedToken    │               │
     │                     │  └──────────────────────────┘               │
     │                     │                      │                      │
═══════════════════════════╪══════════════════════╪══════════════════════╪═══
  PHASE 4 — DELIVERY       │                      │                      │
═══════════════════════════╪══════════════════════╪══════════════════════╪═══
     │                     │                      │                      │
     │  10. Embed code     │                      │                      │
     │◄────────────────────┤                      │                      │
     │                     │                      │                      │
     │  <script src="https://dev.lamoom.com/widget.js"                   │
     │    data-agent-token="<embedToken>"                                │
     │    data-user-id="<stable-or-random-visitor-id>" async></script>   │
     │                     │                      │                      │
     │  Customer pastes    │                      │                      │
     │  before </body>     │                      │                      │
     │                     │                      │                      │
═══════════════════════════╪══════════════════════╪══════════════════════╪═══
  RUNTIME — VISITOR CHAT   │                      │                      │
═══════════════════════════╪══════════════════════╪══════════════════════╪═══
     │                     │                      │                      │
  VISITOR                  │                      │                      │
     │  11. Open widget    │                      │                      │
     ├─── WS connect ─────►│                      │                      │
     │  {type:"auth",      │                      │                      │
     │   token, userId}    │  12. Lookup token    │                      │
     │                     │  Map to session key: │                      │
     │                     │  agent:<id>:widget-  │                      │
     │                     │    <id>-<visitorId>  │                      │
     │                     │         │            │                      │
     │  13. "How do I      │         │            │                      │
     │    install?"        │         │            │                      │
     ├────────────────────►├─────────┼───────────────────────────────────►│
     │                     │         │            │   Forward to agent   │
     │                     │         │            │   session (isolated) │
     │                     │         │            │         │            │
     │  14. Streamed       │◄────────┼───────────────────────────────────┤
     │      response       │         │            │   Agent response     │
     │◄────────────────────┤         │            │                      │
     ▼                     ▼         ▼            ▼                      ▼
```

---

## User Flows

### Flow 1 — Customer creates an agent

```
Customer signs up / logs in
        │
        ▼
Opens "Create Agent" (chat UI)
        │
        ▼
Meta-agent Phase 1 (discovery, mandatory):
  • Fetches website + key pages
  • Builds due-diligence packet (product summary, intents, canonical links, API status)
  • Asks one confirmation ("Should I create your agent now?")
        │
        ▼
Customer confirms
        │
        ▼
Meta-agent runs create-agent skill and writes:
  ├─ AGENTS.md   (operating instructions)
  ├─ SOUL.md     (persona & tone)
  ├─ IDENTITY.md (name, emoji, vibe)
  ├─ TOOLS.md    (workspace-local operational notes; no secrets)
  ├─ USER.md     (visitor context template)
  ├─ skills/website-knowledge/SKILL.md
  ├─ skills/website-api/SKILL.md   (only when API exists)
  ├─ knowledgebase/{overview.md,key-links.md,use-cases.md}
  └─ agent-config.json
        │
        ▼
Meta-agent response includes marker: [AGENT_CREATED::<slug>]
        │
        ▼
Proxy detects marker and:
  • Reads <workspace>/agent-config.json
  • Upserts DB rows (agents + widget_embeds)
  • Registers agent in OpenClaw config and reloads gateway
  • Appends widget <script> snippet
        │
        ▼
Customer copies widget code → pastes into their site
```

### Flow 2 — Website visitor chats (code-level trace)

```
Widget (browser)
  │ WS auth: { type: "auth", agentToken, userId }
  ▼
Proxy WS handler (ws/handler.ts)
  │ 1. Validate embed token → DB lookup:
  │    - agents.id (internal UUID)
  │    - agents.openclawAgentId (OpenClaw slug)
  │ 2. Upsert widget_sessions on UNIQUE(agentId, externalUserId)
  │ 3. Build/reuse openclawSessionKey:
  │    "agent:<openclawAgentId>:widget-<openclawAgentId>-<userId>"
  ▼
Proxy → OpenClaw Gateway (shared WS connection)
  │ Model: "openclaw/<openclawAgentId>"
  │ Same WS transport used for admin + widget traffic, isolated by sessionKey
  │ Agent processes message with customer workspace + skills
  │ Streamed response via gateway `agent` events (token-by-token)
  ▼
Proxy relays back over WS: { type: "message", content, done: boolean }
  │ Streams tokens as they arrive (done: false → ... → done: true)
```

### Flow 3 — Customer creates an agent (code-level trace)

```
Admin UI /create page (WS) or POST /api/agents/create-via-meta (REST)
  │ Sends latest customer message
  ▼
Proxy routes to OpenClaw (model: "openclaw/meta")
  │ sessionKey: stable per-customer from DB
  │ - "agent:meta:admin-<customerId>"
  │   (stored in meta_agent_sessions; one row per customer;
  │    reused on every reconnect for conversation continuity)
  ▼
WS auth flow:
  │ 1. proxy calls getMetaHistory(customerId)
  │ 2. sends { type: "history", messages[], embedCode? } to client
  │ 3. client restores chat state from history
  ▼
OpenClaw meta-agent (workspace: openclaw/workspaces/meta/)
  │ Phase 1: fetch + due diligence packet + one confirmation
  │ Phase 2: create-agent skill (Step 0: select specialized templates if available)
  │   writes customer workspace from templates:
  │    AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md, USER.md
  │    + skills (website-knowledge, website-api, any specialized skills)
  │    + knowledgebase (overview, key-links, use-cases, api-reference)
  │    + agent-config.json  ← includes skills[] array
  │ Emits [AGENT_CREATED::<slug>] marker in response
  │ Streaming: tokens delivered via onDelta → { type:"message", done:false }
  ▼
Proxy detects [AGENT_CREATED::<slug>] marker in response
  │ Reads <workspace>/agent-config.json
  │ Registers slug + skills[] in OpenClaw config (path precedence)
  │ Reloads openclaw-gateway (SIGHUP, systemctl fallback)
  │ Upserts DB records (agent + widget_embed) and embed token
  │ Appends embed snippet to done:true message (admin WS)
  │ Persists user + assistant messages to meta_agent_messages
  ▼
Customer sees agent confirmation + widget <script> snippet
```

### Flow 4 — Customer manages agents

```
Customer logs in → Dashboard
        │
        ├─ List agents (name, status, visitor count)
        ├─ View / copy widget embed code
        ├─ Chat with meta-agent to update agent config
        └─ Pause / delete agent
```

---

## Agent & Session Mapping

| Product concept | Persistent key(s) | Runtime mapping |
|---|---|---|
| Business owner (tenant) | `customers.id` (UUID) | Used for admin auth, audit, and meta session scoping |
| Product-agent | `agents.id` + `agents.openclawAgentId` | `openclawAgentId` is the OpenClaw model slug (`openclaw/<openclawAgentId>`) |
| Widget embed identity | `widget_embeds.embedToken` | Script token resolves to one active `agents` row |
| Website visitor identity | `widget_sessions.externalUserId` | Provided by widget auth payload (`userId`) |
| Widget chat session | `widget_sessions` row keyed by `(agentId, externalUserId)` | `openclawSessionKey = agent:<openclawAgentId>:widget-<openclawAgentId>-<externalUserId>` |
| Admin create/manage session | `meta_agent_sessions` row keyed by `customerId` | `openclawSessionKey = agent:meta:admin-<customerId>` (stable; one per customer) |

Deterministic mapping in proxy:
- `getOrCreateSession(agentId, externalUserId, openclawAgentId)` upserts one `widget_sessions` row per `(agentId, externalUserId)`.
- Reconnecting with same `agentToken + userId` reuses the same OpenClaw conversation context.
- Changing `userId` creates a different OpenClaw session key and isolated thread.
- Admin WS auth retrieves the persisted `meta_agent_sessions.openclawSessionKey` and sends the full `history` message before the first response.

---

## Meta-Agent Template Generation

`openclaw/workspaces/meta/skills/create-agent/SKILL.md` is the source-of-truth workflow for generation.
After discovery is confirmed, the meta-agent derives customer-specific values and writes files into:
`/opt/webagent/openclaw/workspaces/<agentSlug>/`.

### Step 0 — Specialized template selection

Before writing any files, the meta-agent scans the `templates/` directory (relative to its workspace)
for site-specific templates matching the target website. Specialized templates are identified by suffix,
for example `AGENTS-openclaw-console-navigation.md` or `skills/openclaw-console-navigation/SKILL.md`.
When a match is found, the specialized template is used **instead of** the generic base template, since
it already contains verified endpoint tables, auth flows, and canonical links for that site.

### Template roles

- `AGENTS.md` — operating instructions, scope boundaries, and behavior rules.
- `SOUL.md` — persona/tone profile for response style.
- `IDENTITY.md` — identity metadata (name, creature, vibe, emoji, optional avatar).
- `TOOLS.md` — local operational notes (API base URL/auth scheme/integration labels); never secrets.
- `USER.md` — per-session visitor context assumptions.

### Skills and knowledgebase generation

Always written:
- `skills/website-knowledge/SKILL.md` — knowledge skill grounded in verified website facts.
- `knowledgebase/overview.md`, `key-links.md`, `use-cases.md`.

Written when API is detected:
- `skills/website-api/SKILL.md` — API interaction skill with full endpoint table, `fetch` tool usage examples, exact request body shapes for all mutating endpoints.
- `knowledgebase/api-reference.md` — structured endpoint reference table.

Written for specialized sites (from Step 0):
- Any specialized skills found in the templates directory.

### `agent-config.json`

```json
{
  "agentSlug": "<agentSlug>",
  "agentName": "<agentName>",
  "websiteName": "<websiteName>",
  "websiteUrl": "<websiteUrl>",
  "apiDescription": "<short description of API capabilities>",
  "apiBaseUrl": "<API base URL if provided>",
  "skills": ["website-api"],
  "createdAt": "<ISO timestamp>"
}
```

The `skills` array lists all skill directory names created in the workspace. The proxy reads this
array and propagates it into the OpenClaw gateway config entry for the new agent (`agents.list[].skills`).
This is the mechanism by which generated skills become active on the gateway.

---

## What is the Meta-Agent?

The meta-agent is **not** a special OpenClaw concept — it's a regular agent with
`id: "meta"` in the `agents.list` config. What makes it different is its configuration:

| Property | Meta-agent | Product-agents |
|---|---|---|
| `sandbox.mode` | `"off"` — can write files anywhere | `"off"` + workspace-scoped tools |
| `tools.deny` | `["exec", "process", "browser", "canvas", "nodes", "gateway"]` | `["process", "browser", "canvas", "nodes", "gateway"]` (exec allowed) |
| `skills` | `["create-agent", "manage-agents"]` | `["website-api", "website-knowledge", ...specialized]` |
| `heartbeat` | `{ every: "0m" }` — on-demand only | `{ every: "30m" }` |
| Purpose | Creates other agents | Serves website visitors via workflow scripts |

The meta-agent does NOT edit `openclaw.json` directly — the proxy handles agent registration
automatically when it detects the `[AGENT_CREATED::]` marker.

**Why product-agents allow `exec`:** product-agents implement actions as Python scripts under
`workflows/` and execute them via `exec python3 workflows/<file>.py`. See "Workflow-as-Code"
below. Meta-agent continues to deny `exec` (no need to run scripts; only writes workspace files).

---

## Workflow-as-Code (Product-Agent Action Pattern)

**Rule:** any product-agent action that mutates state, calls an API, or requires credentials
MUST be implemented as a Python script written to `workflows/<verb>-<noun>-<YYYYMMDD-HHMMSS>.py`
and then executed via the `exec` tool. Read-only conversational answers may skip the workflow.

### Why

- **Auditability** — every action leaves an artifact on disk (workspace path persists across sessions).
- **Reproducibility** — re-running a workflow gives the same result; supports rollback inspection.
- **Composability** — workflows become building blocks for cron/automation (already wired in
  openclaw.json5: `cron.enabled: true`).
- **Quality signal** — judges/evals can deterministically check "did the agent produce a workflow?"
  instead of guessing intent from natural-language replies.

### Convention

- **Path:** `<workspacePath>/workflows/<verb>-<noun>-<YYYYMMDD-HHMMSS>.py`
  (example: `workflows/create-contact-20260523-143200.py`).
- **Structure:** top docstring describes action + params; load auth from `os.environ`; use
  `requests`; print structured JSON to stdout; exit 0 on success / non-zero on failure.
- **Idempotency:** scripts must be safely re-runnable. Generate an idempotency key at the top
  when the target API supports it.
- **Workspace seeding:** `create-agent` writes `<workspacePath>/workflows/README.md` describing
  the convention (Step 1 of the create-agent skill).

### Source of truth

- Rule baked into BOTH `openclaw/templates/AGENTS.md` and `openclaw/workspaces/meta/templates/AGENTS.md`
  as a top-level "Workflow-as-Code (Required for Actions)" section + numbered "Workflow-first" rule.
- API call flow rewritten in BOTH `openclaw/templates/skills/website-api/SKILL.md` and the meta
  copy under `openclaw/workspaces/meta/templates/skills/website-api/SKILL.md`.
- Reconciler (`packages/proxy/src/openclaw/reconciler.ts`) registers new product-agents WITHOUT
  any `tools.deny` block — they inherit the global `tools.allow` which includes `exec`.

### Verification

- E2E judge (`.agents/skills/test-e2e/SKILL.md` Phase 4.5) SSHes to the gateway host and asserts
  a `workflows/*.py` file exists with mtime within the action window AND that gateway logs show
  `python3` was invoked on it.
- Product-agent eval skill (`.agents/skills/product-agent-eval/SKILL.md`) scores "Workflow
  Discipline" as a g-eval dimension (1–5).

---

## Product-Agent Evaluation (G-Eval)

A deployed product-agent passes through three quality gates before being declared MVP-ready.

### Gate 1 — Workspace validation (proxy-side)

Runs at agent creation time. Validator (`packages/proxy/src/openclaw/workspace-validator.ts`)
rejects workspaces containing unresolved `{{...}}` placeholders. Force-retries if found.

### Gate 2 — E2E judge (`.agents/skills/test-e2e/SKILL.md`)

User-journey test across 6 phases:
- Phase 0: pre-flight health checks (proxy, gateway, widget bundle, admin UI).
- Phase 1: login via UI succeeds.
- Phase 2: agent created via meta-agent chat (< 3 min, embed code returned).
- Phase 3: agent visible in dashboard with detail page + widget preview.
- Phase 4: widget chat returns scored responses (rubric ≥ 3.0 avg).
- **Phase 4.5: workflow artifact audit** — agent produced `workflows/*.py` for action question,
  file present on host with valid structure, gateway logs show `python3` invocation.
- Phase 5: UX audit checklist per page.
- Phase 6: time-to-first-agent ≤ 10 min (PRD SLA).

Verdicts: PASS / CONDITIONAL / NOT READY.

### Gate 3 — Product-agent g-eval (`.agents/skills/product-agent-eval/SKILL.md`)

12-prompt battery scored by LLM-as-judge across 6 dimensions (1–5):
- **Task Completion** (weight 0.30) — did agent accomplish user goal?
- **Workflow Discipline** (weight 0.20) — for action prompts, did it write+run a `workflows/*.py`?
- **Factual Accuracy** (weight 0.20) — grounded in site/API knowledge, no hallucination?
- **Tool Selection** (weight 0.15) — chose right endpoint / skill?
- **Communication** (weight 0.10) — concise, on-brand, no exposed internals?
- **Refusal Quality** (weight 0.05) — out-of-scope/missing-auth handled with actionable next step?

Test battery covers: Knowledge Recall (3), API Action (2), Multi-step Reasoning (2),
Out-of-scope Refusal (2), Auth-missing Fallback (2), Canonical-link probe (1).

**Thresholds:**
- ≥ 3.5 composite → ship to dev/staging.
- ≥ 4.0 composite → mark "production ready" / public MVP eligible.

**Output:**
- Per-run scorecard at `evals/product-agent/<agentSlug>-<ISOdate>.md`.
- Cumulative log at `evals/eval.csv` (header: run_id, timestamp, agent_slug, agent_type,
  target_url, category, prompt, expected_behavior, response_summary, workflow_file,
  workflow_ran, task_completion, workflow_discipline, factual_accuracy, tool_selection,
  communication, refusal_quality, composite, verdict, notes).

### Eval infrastructure dependencies (current gaps)

1. **Judge LLM credentials** — `JUDGE_MODEL` + API key not yet in env. Bitwarden folder
   `webagent` should hold `OPENAI_API_KEY` or `AZURE_OPENAI_KEY`; surface in proxy `.env`
   for eval skill to consume.
2. **Embed-token → agentSlug lookup** — eval skill needs to SSH-inspect `workflows/`; requires
   either (a) new route `GET /api/agents/embed/:token/slug` or (b) DB query helper exposed in
   admin. Currently must be derived manually from `agent-config.json`.
3. **Workflow execution evidence** — current judge greps `journalctl --user -u openclaw-gateway.service`
   for `python3.*workflows`. Fragile to log format drift. **Preferred replacement:** have the
   `create-agent` template wrap workflow execution in a short shell prelude that appends an
   audit line to `<workspace>/workflows/.exec.log` (`<ISO-timestamp>\t<script>\t<exit_code>`),
   then have the judge read that file. Removes dependency on journald and survives gateway
   log-format changes. Track as eval-infra task; not in Phase 1.

---

## System Architecture

```
                        ┌──────────────────────────────────────────────────────┐
                        │                   Hetzner CAX11                      │
                        │             (2 ARM vCPU, 4GB, 40GB)                  │
                        │                   ~€4.29/mo                          │
                        │                                                      │
  ┌──────────┐          │  ┌────────────────────────────────────────────────┐  │
  │ Customer │─── HTTPS ──▶│              Nginx (reverse proxy)             │  │
  │ Browser  │          │  │         SSL termination (Let's Encrypt)        │  │
  └──────────┘          │  └──┬──────────┬─────────────────────────────────┘  │
                        │     │          │                                     │
  ┌──────────┐          │     │ /*       │ /ws, /api                          │
  │ Website  │─── WSS ──│─────│──────────│─────────────────────────────────┐  │
  │ Visitor  │          │     ▼          ▼                                 │  │
  └──────────┘          │  ┌────────┐ ┌──────────┐    ┌──────────────────┐│  │
                        │  │ Admin  │ │  Proxy   │◀WS▶│    OpenClaw      ││  │
                        │  │ Next.js│ │ Fastify  │    │    Gateway       ││  │
                        │  │ :3000  │ │ :3001    │    │    :18789        ││  │
                        │  │        │ │          │    │                  ││  │
                        │  │ • Auth │ │ • WS hub │    │ • Multi-agent    ││  │
                        │  │ • Chat │ │ • Session│    │ • /v1/responses  ││  │
                        │  │   UI   │ │   routing│    │ • WS protocol    ││  │
                        │  │ • Dash │ │ • Widget │    │ • Cron/heartbeat ││  │
                        │  │  board │ │   JS CDN │    │                  ││  │
                        │  └────────┘ └─────┬────┘    └────────┬─────────┘│  │
                        │                   │                  │           │  │
                        │                   │  single WS conn  │           │  │
                        │                   └──────────────────┘           │  │
                        │                                                  │  │
                        │  ┌───────────────────────────────────────────┐   │  │
                        │  │      Agent Workspaces (filesystem)       │   │  │
                        │  │  ┌─────────────┐ ┌─────────────┐        │   │  │
                        │  │  │ customer_a/ │ │ customer_b/ │  ...   │   │  │
                        │  │  │  AGENTS.md  │ │  AGENTS.md  │        │   │  │
                        │  │  │  skills/    │ │  skills/    │        │   │  │
                        │  │  └─────────────┘ └─────────────┘        │   │  │
                        │  └───────────────────────────────────────────┘   │  │
                        └──────────────────────────────────────────────────┘  │
                                                                               │
                        ┌──────────────────┐                                  │
                        │ Neon (PostgreSQL) │◀── DB queries ───────────────────┘
                        │ (serverless, ext) │
                        └──────────────────┘
```

---

## Package Map

```
webagent/
├── packages/
│   ├── proxy/        Fastify+WS — session routing, OpenClaw WS client, REST API
│   │   ├── src/
│   │   │   ├── index.ts              Server entrypoint (Fastify boot)
│   │   │   ├── config.ts             Env validation
│   │   │   ├── db/schema.ts          Drizzle ORM schema (all tables)
│   │   │   ├── db/client.ts          Neon serverless + Drizzle client factory
│   │   │   ├── openclaw/client.ts    Shared Gateway WS transport (connect/agent protocol)
│   │   │   ├── openclaw/sessions.ts  Session key management
│   │   │   ├── ws/handler.ts         WebSocket auth + message relay
│   │   │   ├── routes/health.ts      Health check endpoints
│   │   │   └── routes/widget.ts      Serves widget.js bundle
│   │   ├── drizzle.config.ts
│   │   └── drizzle/                  Generated SQL migrations
│   │
│   ├── admin/        Next.js 15 (App Router) + Tailwind — customer dashboard
│   │   └── src/
│   │       ├── lib/auth.ts           NextAuth v5 config (Google, GitHub, Credentials)
│   │       ├── middleware.ts         Route protection (/dashboard/*, /create/*, /admin/*)
│   │       └── app/
│   │           ├── login/page.tsx    Login UI
│   │           ├── dashboard/page.tsx Dashboard
│   │           ├── create/page.tsx   Create agent (meta-agent chat)
│   │           └── admin/page.tsx    Internal CRM (admin-only)
│   │
│   ├── widget/       Embeddable JS chat — Vite IIFE bundle → widget.js
│   │   └── src/index.ts
│   │
│   └── shared/       Types, WS protocol, constants
│       └── src/
│           ├── types.ts              Customer, Agent, WidgetSession, WidgetEmbed, HealthResponse
│           ├── protocol.ts           ClientMessage / ServerMessage discriminated unions
│           └── constants.ts          Ports, WS path, close codes
│
├── openclaw/
│   ├── config/openclaw.json5         Multi-agent config (hooks, sandbox, cron, session)
│   ├── templates/                    Base templates for new product-agents
│   └── workspaces/
│       └── meta/                     Meta-agent workspace + create-agent skill
│
├── infra/
│   ├── setup.sh                      Full VM provisioning
│   ├── nginx/webagent.conf           Rate limiting, SSL, WS upgrade, caching
│   └── systemd/                      2 service units (webagent-proxy, webagent-admin)
│
└── docs/
    ├── tdd.md                        This file
    ├── prd.md                        Product requirements
    ├── deployment.md                 Deployment runbook
    ├── openclaw.md                   OpenClaw install/service notes
    └── design.paperclip.md           Paperclip orchestration layer design
```

---

## Critical Technical Decisions

### Proxy ↔ OpenClaw: Single WS Connection

- Proxy maintains ONE persistent WebSocket to OpenClaw gateway (`:18789`)
- Both admin (meta-agent) and widget (product-agent) traffic multiplexed on same WS
- Agent selected via `model: "openclaw/<agentId>"` in each request
- Widget session key: `agent:<openclawAgentId>:widget-<openclawAgentId>-<externalUserId>`
- Admin/meta session key: `agent:meta:admin-<customerId>` (stable; stored in `meta_agent_sessions`)
- Streaming: gateway sends `agent` events token-by-token; proxy relays to client
- Fallback: `/v1/responses` HTTP endpoint available for simple request-response

### OpenClaw Session Persistence

- Each `sessionKey` maintains isolated multi-turn conversation state
- `hooks.allowRequestSessionKey: true` in `openclaw.json5`
- `allowedSessionKeyPrefixes: ["agent:", "widget-", "admin-", "hook:"]` — OpenClaw matches any of these as the leading substring. In practice all production keys begin with `agent:` (widget: `agent:<id>:widget-...`, admin/meta: `agent:meta:admin-...`); the bare `widget-`/`admin-` entries exist for backward compatibility with pre-`agent:` namespacing and may be pruned once no live sessions use them.
- Widget session mapping persisted in DB (`widget_sessions.openclawSessionKey`)

### Sandbox Model (NO Docker)

- `sandbox.mode: "off"` for all agents — no containers
- Agent read/write/edit tools are workspace-scoped by default in OpenClaw
- **Tool deny lists vary by agent role:**

| Agent role | `tools.deny` | Why |
|---|---|---|
| Meta-agent | `["exec", "process", "browser", "canvas", "nodes", "gateway"]` | Only writes workspace files; no need to run scripts |
| Product-agent | `["process", "browser", "canvas", "nodes", "gateway"]` (no `exec`) | Must execute `workflows/*.py` scripts (see Workflow-as-Code) |
| Global `tools.allow` | `["group:fs", "group:web", "group:memory", "session_status", "exec"]` | Inherited by product-agents that omit a deny block |

See cross-reference: "Meta-Agent vs Product-Agent" table above and "Workflow-as-Code" section.

### Agent Creation: No Callback Required

- Meta-agent writes workspace files from templates
- Proxy detects agent creation in meta-agent's response via `[AGENT_CREATED::]` marker
- Proxy reads config, creates DB records, generates embed token, appends embed snippet
- Meta-agent never needs to POST anywhere — it just writes files and talks

### OpenClaw Config Registration

- Config path precedence: `OPENCLAW_CONFIG_PATH` → `<repo>/openclaw/config/openclaw.json5` → `~/.openclaw/openclaw.json`
- Proxy parses JSON5, appends agent entry when missing, then writes back config JSON
- Gateway reloaded via SIGHUP; falls back to `sudo systemctl restart openclaw-gateway`

---

## Database Schema (Drizzle ORM)

Source of truth: `packages/proxy/src/db/schema.ts`. Tables below mirror the live Drizzle schema.

```
customers
  id            UUID PK
  email         TEXT UNIQUE NOT NULL
  name          TEXT
  passwordHash  TEXT                       ← bcrypt hash; see Known Debt #1 for migration from access_token
  oauthProvider TEXT (google | github | email)
  oauthId       TEXT
  plan          TEXT NOT NULL DEFAULT 'free'
  createdAt     TIMESTAMPTZ
  updatedAt     TIMESTAMPTZ

agents
  id                 UUID PK
  customerId         UUID NOT NULL FK → customers.id (CASCADE)
  openclawAgentId    TEXT UNIQUE NOT NULL    ← matches agent.id in openclaw.json5
  paperclipAgentId   TEXT                    ← optional Paperclip integration ID
  name               TEXT NOT NULL
  websiteUrl         TEXT
  description        TEXT                    ← customer-supplied instructions (used by PATCH /api/agents/:id)
  status             TEXT NOT NULL DEFAULT 'provisioning'  ← provisioning | active | paused | deleted
  widgetConfig       JSONB NOT NULL DEFAULT '{}'
  apiDescription     TEXT
  createdAt          TIMESTAMPTZ
  updatedAt          TIMESTAMPTZ

widget_sessions
  id                  UUID PK
  agentId             UUID NOT NULL FK → agents.id (CASCADE)
  externalUserId      TEXT NOT NULL          ← visitor's userId from widget
  openclawSessionKey  TEXT NOT NULL
  lastActiveAt        TIMESTAMPTZ
  createdAt           TIMESTAMPTZ
  UNIQUE INDEX widget_sessions_agent_user_idx (agentId, externalUserId)

widget_embeds
  id              UUID PK
  agentId         UUID NOT NULL FK → agents.id (CASCADE)
  embedToken      TEXT UNIQUE NOT NULL    ← used in <script data-agent-token="...">
  allowedOrigins  TEXT[]
  createdAt       TIMESTAMPTZ

audit_log
  id          BIGSERIAL PK
  customerId  UUID FK → customers.id
  action      TEXT NOT NULL
  details     JSONB
  createdAt   TIMESTAMPTZ

meta_agent_sessions                        ← one per customer
  id                  UUID PK
  customerId          UUID NOT NULL FK → customers.id (CASCADE)
  openclawSessionKey  TEXT UNIQUE NOT NULL  ← "agent:meta:admin-<customerId>"
  lastActiveAt        TIMESTAMPTZ
  createdAt           TIMESTAMPTZ
  UNIQUE INDEX meta_agent_sessions_customer_idx (customerId)

meta_agent_messages                        ← ordered message log
  id          UUID PK
  sessionId   UUID NOT NULL FK → meta_agent_sessions.id (CASCADE)
  role        TEXT NOT NULL                ← 'user' | 'assistant'
  content     TEXT NOT NULL
  createdAt   TIMESTAMPTZ
  INDEX meta_agent_messages_session_created_idx (sessionId, createdAt)
```

### NextAuth adapter tables (managed by adapter, no Drizzle migration yet — see Known Debt #8)

Defined in `packages/admin/src/lib/auth-schema.ts`. NextAuth `DrizzleAdapter` auto-creates these on first run; production should ship a checked-in migration before launch.

```
users                    ← admin user identity (separate from customers row)
  id, email, emailVerified, name, image, hashedPassword

accounts                 ← OAuth provider links (Google, GitHub)
  userId, type, provider, providerAccountId, access_token, refresh_token, ...

sessions                 ← active NextAuth sessions
  sessionToken, userId, expires

verification_tokens      ← magic-link / email verification
  identifier, token, expires
```

**Identity model note:** `customers` is the business-tenant row used by the proxy/widget pipeline. `users` is the NextAuth row used by the admin UI. Both are keyed by email; production reconciliation between the two is tracked in Known Debt #8.

---

## WebSocket Protocol (`packages/shared/src/protocol.ts`)

### Client → Server

```typescript
{ type: "auth", userId: string, mode?: "widget" | "admin", token: string, agentToken?: string, ticket?: string }
{ type: "message", content: string, attachments?: { name: string, type: string, data: string }[] }
{ type: "ping" }
```

Admin attachment limits: max 5 files, max 2 MiB decoded per file, max 8 MiB decoded total.
Proxy `maxPayload` is configured to 12 MiB.

### Server → Client

```typescript
{ type: "auth_ok", sessionId: string }
{ type: "auth_error", reason: string }
{ type: "history", sessionId: string, messages: Array<{ role: "user" | "assistant", content: string }>, embedCode?: string }
{ type: "message", content: string, done: boolean }
{ type: "error", message: string }
{ type: "pong" }
```

---

## Proxy REST API

```
# Customer-facing (authed via HMAC headers)
GET    /api/agents                   List customer's agents
PATCH  /api/agents/:id               Update agent status
DELETE /api/agents/:id               Delete agent
POST   /api/agents/:id/embed-token   Regenerate embed token
POST   /api/agents/create-via-meta   Send message to meta-agent
GET    /api/agents/meta-history      Retrieve meta-agent conversation history

# Admin / internal
GET    /api/admin/stats
GET    /api/admin/users
GET    /api/admin/agents
POST   /api/admin/agents/:id/refresh-workspace
GET    /api/admin/audit-log
POST   /api/internal/agents          localhost-only agent creation

# OpenAI-compatible
POST   /v1/chat/completions
GET    /v1/models

# Health
GET    /health
GET    /health/openclaw
```

---

## Environment Variables

```bash
# Required
DATABASE_URL=              # Neon PostgreSQL connection string
OPENCLAW_GATEWAY_TOKEN=    # Auth token for OpenClaw gateway WS/HTTP
AUTH_SECRET=               # NextAuth.js secret (32+ chars)
AUTH_URL=                  # Full URL of admin (e.g. https://dev.lamoom.com)

# Customer API auth
PROXY_CUSTOMER_API_TOKEN=
PROXY_API_TOKEN=

# Optional (OAuth)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Optional (Email auth)
EMAIL_SERVER=
EMAIL_FROM=

# Defaults
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
PROXY_PORT=3001
ADMIN_PORT=3000

# Phase 1 launch-critical (see §Phase 1 Implementation Specs)
SENTRY_DSN=                # Proxy + admin server-side error tracking
NEXT_PUBLIC_SENTRY_DSN=    # Admin client-side error tracking
NEXT_PUBLIC_PROXY_URL=     # Replaces hardcoded localhost:3001 in next.config.ts (Known Debt #9)

# Eval infrastructure (see §Product-Agent Evaluation gaps)
JUDGE_MODEL=               # e.g. gpt-4o, gpt-4.1
OPENAI_API_KEY=            # or AZURE_OPENAI_KEY; consumed by product-agent-eval skill

# CI/CD (stored as GitHub Actions secrets, not on the VM)
HETZNER_SSH_KEY=           # GitHub Actions secret only
```

---

## Build & Dev Commands

```bash
pnpm install                          # Install all deps
pnpm build                            # Build all packages (Turborepo)
pnpm --filter @webagent/proxy dev     # Dev proxy with watch
pnpm --filter @webagent/admin dev     # Dev admin Next.js
pnpm --filter @webagent/widget build  # Build widget IIFE bundle

# Database
pnpm --filter @webagent/proxy db:generate   # Generate migration after schema change
pnpm --filter @webagent/proxy db:migrate    # Apply checked-in migrations
pnpm --filter @webagent/proxy db:studio     # Drizzle Studio UI

# Tests
pnpm --filter @webagent/proxy test          # Unit tests (Node test runner)
pnpm --filter @webagent/admin typecheck
pnpm --filter @webagent/widget typecheck
```

---

## Deployment (Hetzner CAX11)

- **VM:** 2 ARM vCPU, 4GB RAM, 40GB SSD — `root@78.47.152.177`
- **OS:** Ubuntu 24.04 ARM
- **Domain:** `dev.lamoom.com` (BIND9 self-hosted DNS on VM; NS delegated from Route 53)
- **SSL:** Let's Encrypt via certbot + nginx
- **No Docker** — workspace-scoped tool sandboxing instead

```bash
./infra/deploy.sh [host]   # default: 78.47.152.177
```

Deploy script: rsync → preserve `.env` → merge OpenClaw agents back into config → rebuild → `db:migrate` → admin-static-sync → restart services → health checks.

### Services

| Service | Managed by | Restart |
|---|---|---|
| `webagent-admin` | systemd (system) | `systemctl restart webagent-admin` |
| `webagent-proxy` | systemd (system) | `systemctl restart webagent-proxy` |
| `openclaw-gateway` | OpenClaw CLI (user systemd) | `sudo -u openclaw bash -lc "export XDG_RUNTIME_DIR=/run/user/\$(id -u); systemctl --user restart openclaw-gateway.service"` |

**Never** create a competing system-level `openclaw-gateway.service`. The unit is owned and regenerated by `openclaw gateway install`.

### Static Asset Sync (blocking after every deploy)

Next.js standalone output does not bundle `_next/static`. Must clean-copy after every build:

```bash
bash infra/admin-static-sync.sh sync /opt/webagent
bash infra/admin-static-sync.sh check http://127.0.0.1:3000
```

---

## Streaming Behavior

Both admin (WS) and widget (WS) flows stream token-by-token via `onDelta` callbacks.

```
OpenClaw gateway → agent event (delta) → Proxy → { type:"message", content: delta, done: false }
...
last delta → { type:"message", content: embedSuffix or "", done: true }
```

For admin sessions where an agent was just created, the embed code suffix is appended in the `done: true` message.

The REST `create-via-meta` endpoint does not stream — full response returned in one JSON envelope.

---

## Markdown Rendering

**Widget** (`packages/proxy/src/widget/widget.ts`): hand-rolled tokenizer → HTML string → `innerHTML` for assistant messages. Input HTML-escaped before tokenization. User messages use `textContent`. Safe link schemes only (`http:`, `https:`, `mailto:`).

**Admin chat** (`packages/admin/src/lib/markdown.tsx`): `react-markdown` + `remark-gfm` → React nodes. `skipHtml: true`. No `dangerouslySetInnerHTML` path.

---

## Real Widget Embed on Agent Detail Page

`WidgetPreview` renders an `<iframe>` whose `srcDoc` contains the real `<script>` embed tag, not a simulated chat UI. This means the detail page exercises the exact same code path a website visitor sees.

Widget session identity:
- `data-user-id` present → widget sends it in WS auth → per-user session key
- `data-user-id` omitted → falls back to `localStorage.lamoom_uid`
- For E2E isolation: inject a browser-generated UUID + cache-bust the script URL (`widget.js?cb=<ts>`)

---

## Meta-Agent History Persistence

Two tables (`meta_agent_sessions`, `meta_agent_messages`) persist the meta-agent conversation:

- Session key is deterministic: `agent:meta:admin-<customerId>` — no random suffix
- `UNIQUE(customerId)` enforces one thread per customer
- Messages written to DB **only after** successful OpenClaw response (prevents DB/agent state divergence)
- Retrieved via WS auth (`history` message) or `GET /api/agents/meta-history`

---

## Production Status

### ✅ Done & Working

- Monorepo scaffold (pnpm + Turborepo, all packages build)
- Proxy: Fastify boot, WS handler with auth protocol, health routes, widget serving
- Proxy: OpenClaw Gateway WS integration (streaming, single persistent connection)
- Proxy: Agent creation detection → DB + embed token + embed snippet
- Proxy: Auto-registers new agents in OpenClaw config + restarts gateway
- Proxy: `@fastify/rate-limit` on WS + REST; per-IP WS connection cap (MAX_WS_PER_IP=20)
- Proxy: Gateway WS transport (single shared connection)
- Proxy: Timing-safe token comparison; WS `maxPayload: 65536`; `unhandledRejection` handlers
- Proxy: OpenClaw gateway request concurrency guard (MAX_CONCURRENT_REQUESTS)
- Proxy: Audit log wired — 5 mutation points
- DB: Neon PostgreSQL + Drizzle schema + migrations
- Admin: NextAuth v5 + DrizzleAdapter, bcrypt credentials, invite-gated signup, Email provider
- Admin: WS-based create-agent chat; admin auth mode in proxy
- Admin: Dashboard with agent list, detail page, live widget preview (real `widget.js` iframe)
- Admin: Login page (credentials, Google, GitHub, magic-link)
- Widget: Vite IIFE bundle, served from proxy at `/widget.js`
- OpenClaw: Multi-agent config, meta-agent workspace + create-agent skill (4-step flow)
- Meta-agent history persisted to DB; restored on WS auth and REST
- Streaming: token-by-token via `onDelta` in both admin and widget WS flows
- Markdown: widget uses `innerHTML`-based renderer; admin uses `react-markdown` (no raw HTML)
- `agent-config.json` `skills` array propagated to gateway config on registration
- Signed `x-customer-id` + `x-customer-sig` headers (no deprecated bearer fallback)
- CORS: widget embed origin validation enforced in WS auth handshake
- E2E: Full agent creation flow verified (multiple agents created and tested)

> **Single source of truth for issue IDs:** the numbers below are referenced from the Known Debt table (§Known Debt) and the Phase 1 Implementation Specs. Do NOT renumber without updating both.

### 🔴 BLOCKING — Must Fix Before Production Launch (PRD Phase 1 MUST)

1. **Password stored in `access_token` column** — bcrypt hash in wrong column; breaks if adapter reads `access_token` for OAuth token. Fix shipped together with §Settings Page (`POST /api/auth/change-password` migrates value).
2. **No CI/CD pipeline** — deploy is fully manual. See §Phase 1 Specs → CI/CD Pipeline.
3. **No error tracking** — no Sentry, Datadog, or equivalent. See §Phase 1 Specs → Error Tracking.
4. **No external uptime monitoring.** See §Phase 1 Specs → Uptime Monitoring.
5. **No inline agent editing** — user must recreate an agent to change name, URL, or instructions. See §Phase 1 Specs → Agent Editing.
6. **Pause / delete agent not wired end-to-end** — backend handlers unverified; `PATCH /api/agents/:id` (status) + `DELETE /api/agents/:id` must remove from openclaw.json5 and SIGHUP. See §Phase 1 Specs → Pause / Delete Agent.
7. **Settings page at `/dashboard/settings` is a stub** — required for password change, invite management, API key display. See §Phase 1 Specs → Settings Page.

### 🟠 HIGH — Should Fix Before Launch

8. **Admin auth tables have no migration** — `users`, `accounts`, `sessions`, `verification_tokens` rely on adapter auto-creation (fragile). Production reconciliation between `customers` and NextAuth `users` also unresolved.
9. **Hardcoded `localhost:3001` rewrite in `next.config.ts`** — must be configurable via `NEXT_PUBLIC_PROXY_URL`.
10. **Hardcoded secrets in `openclaw.json5`** — gateway token and hooks secret are inline strings. Move to env.
11. **Agent registration TOCTOU race** — `registerAgentInOpenClaw` reads config, checks slug, writes; two concurrent creates for same slug can both pass. Needs file locking.
12. **`detectAgentCreation` DB insert race** — no `onConflictDoNothing` on agent insert; concurrent creation throws unhandled unique violation.
13. **Visitor analytics missing** — dashboard shows no usage data (message count, session count). PRD Phase 2. Need: counter columns on `widget_sessions`; `GET /api/agents/:id/stats` route.

### 🟡 MEDIUM — Fix Soon After Launch

14. **Two widget implementations** — `packages/widget/` (better, unused) vs `packages/proxy/src/widget/widget.ts` (simpler, actually served). Decide one, delete the other.
15. **Widget `userId` is client-generated** — any visitor can impersonate another's session by guessing `userId`. Cross-ref: §Real Widget Embed (`data-user-id` fallback to `localStorage.lamoom_uid`). Mitigation: server-side signed visitor tokens.
16. **No server-side WS heartbeat** — stale sockets accumulate.
17. **No WS backpressure handling.**
18. **`touchSessionLastActiveAt` await blocks message processing on DB failure** — should be fire-and-forget with error log.
19. **Magic link form shown even when `EMAIL_SERVER` is unset.**
20. **Widget preview has no auto-reconnect on disconnect.**
21. **Hardcoded `dev.lamoom.com` fallbacks in proxy and admin code.**
22. **No forgot password / account recovery flow.** PRD Phase 2.

### 🟢 Nice to Have

23. Gateway config file divergence (json5 vs json) — configs drift as agents are created.
24. Token cache in WS handler has no max size — unbounded map growth.
25. No light/dark theme toggle.
26. No loading skeleton / Suspense boundary on dashboard.
27. `next-auth@5.0.0-beta.31` — pre-release in production.

---

---

# Part II: Implementation & Testing

## Critical Implementation Gotchas

### NextAuth v5 JWT — `token.id` not `token.sub`

NextAuth v5 stores the user ID as `token.id`, not `token.sub`. The JWT callback must explicitly set it:

```typescript
// packages/admin/src/lib/auth.ts
async jwt({ token, user }) {
  if (user?.id) token.id = user.id;      // ← MUST set .id
}
async session({ session, token }) {
  if (token.id) session.user.id = token.id; // ← reads .id, not .sub
}
```

**Impact:** If `token.id` is missing → `session.user.id` is undefined → `/api/auth/ws-ticket` returns 401 → WS auth fails → `/create` textarea stays permanently disabled.

**Cookie name:** `__Secure-authjs.session-token` when `AUTH_URL=https://...`, `authjs.session-token` when `AUTH_URL=http://...`.

### Agent Creation Flow (code path)

```
meta-agent writes files → emits [AGENT_CREATED::<slug>] in response text
         ↓
proxy.detectAgentCreation() scans response for marker
         ↓
reads <workspace>/agent-config.json
         ↓
upserts DB: agents + widget_embeds
         ↓
registers slug in openclaw.json5
         ↓
SIGHUP → gateway reloads (falls back to systemctl restart)
         ↓
appends embed <script> snippet to done:true WS message
```

**Race condition (known):** Two concurrent creates for the same slug can both pass the existence check. See Production Status #8 above.

### Stale Embed Token Detection in E2E Tests

The `/create` page renders full chat history, which may include old embed codes. E2E scripts must snapshot existing tokens before sending a message and wait only for tokens **not in the original set**:

```javascript
const existingTokens = new Set(
  [...(await page.content()).matchAll(/data-agent-token="([a-f0-9-]{36})"/g)].map(m => m[1])
);
// ... send message, poll until new tokens appear ...
const newTokens = allTokens.filter(t => !existingTokens.has(t));
if (newTokens.length > 0) { embedToken = newTokens[0]; break; }
```

### `ignoreHTTPSErrors` Scope

Must be set on `browser.newContext()`, not on an existing context. Applying it to an already-open context has no effect.

---

## Database Conventions

Schema: `packages/proxy/src/db/schema.ts`. Migrations: `packages/proxy/drizzle/`.

```bash
pnpm --filter @webagent/proxy db:generate   # after schema change
pnpm --filter @webagent/proxy db:migrate    # apply to DB
```

**Admin auth tables** (`users`, `accounts`, `sessions`, `verification_tokens`) are in `packages/admin/src/lib/auth-schema.ts` but have no Drizzle migration — they rely on NextAuth adapter auto-creation. Known gap; see Production Status #5.

---

## API Conventions

### Customer REST API

- Auth: HMAC-signed headers `x-customer-id` + `x-customer-sig` (`<hex_hmac>:<unix_ts>`)
- Response shape: `{ data: ... }` success / `{ error: { code, message, details? } }` error
- Validation: Zod on all inputs; stricter rate limits on mutation routes

### Admin REST API

- Bearer auth from `PROXY_CUSTOMER_API_TOKEN` / `PROXY_API_TOKEN` / `OPENCLAW_GATEWAY_TOKEN`
- Most internal routes: localhost-only

### WebSocket Auth Flow

1. Client sends auth message within 30s. Shape varies by mode (full type in `packages/shared/src/protocol.ts`):
   - **Widget** (visitor): `{ type: "auth", mode: "widget", userId, agentToken, token }` — `agentToken` is the `data-agent-token` from the `<script>` embed; `token` is the customer-API HMAC-derived value.
   - **Admin** (dashboard): `{ type: "auth", mode: "admin", userId, ticket }` — `ticket` is a short-lived value from `GET /api/auth/ws-ticket` (NextAuth session → ticket exchange).
2. Server responds `{ type: "auth_ok", sessionId }` or `{ type: "auth_error", reason }`. Reason `agent_paused` on paused agents (Phase 1 spec).
3. Admin mode: server immediately sends `{ type: "history", sessionId, messages[], embedCode? }`.
4. Messages stream as `{ type: "message", content, done: boolean }`. For admin sessions that just created an agent, the `done: true` message includes `embedCode` suffix.

---

## Testing Strategy

### Unit Tests

- **Location:** `packages/proxy/src/**/__tests__/`
- **Runner:** Node built-in test runner
- **Command:** `pnpm --filter @webagent/proxy test`
- **Coverage:** WS protocol parsing, runtime policy, embed token validation

### Integration Tests

Not yet systematized. Proxy routes can be tested via Supertest against a real Neon test DB. Gap to address post-launch.

### E2E Test Skills

| Skill | Trigger phrases | Focus |
|---|---|---|
| `.agents/skills/test-lamoom/` | "test lamoom", "run e2e", "smoke test" | Deep technical: JWT auth, agent creation, G-Eval scoring, 10-phase checklist |
| `.agents/skills/test-e2e/` | "test product", "test as user", "qa check" | User journeys: UX, flows, time-to-value |
| `.agents/skills/test-hubspot/` | "test hubspot" | HubSpot CRM scenarios specifically |

For a release gate: run both `test-e2e` (user perspective) **and** `test-lamoom` (protocol). Both must pass.

### Browser Automation

- **Playwright MCP** — primary; works on `dev.lamoom.com` (no headless blocking)
- **VibeBrowser** — fallback for sites that block headless browsers

### Test Credentials

| Service | Email | Password | Notes |
|---|---|---|---|
| Lamoom | `demo@lamoom.com` | `demo123` | Primary test account |
| Google | `dzianis.somewhere.3@gmail.com` | `56JewZNqsX&D0e` | OAuth test |
| HubSpot | — | — | See Bitwarden `webagent` folder |

All credentials stored in Bitwarden. See `~/.agents/agents.md` for CLI workflow.

---

## Development Environment

### First-time Setup

```bash
git clone git@github.com:OpenCodeEngineer/webagent.git
cd webagent
cp .env.example .env
# Required: DATABASE_URL, OPENCLAW_GATEWAY_TOKEN, AUTH_SECRET, AUTH_URL
# Optional: GOOGLE_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET

pnpm install
pnpm --filter @webagent/shared build
pnpm --filter @webagent/proxy build
pnpm dev
```

Admin UI: `http://localhost:3000`  
Proxy API: `http://localhost:3001`

### Production Verification (after every deploy)

```bash
curl -sf https://dev.lamoom.com/health
curl -sf https://dev.lamoom.com/health/openclaw
curl -sf -o /dev/null -w "%{http_code}" https://dev.lamoom.com/login    # expect 200
curl -sf -o /dev/null -w "%{size_download}" https://dev.lamoom.com/widget.js  # expect > 1000
bash infra/admin-static-sync.sh check http://127.0.0.1:3000
```

Automated by `test-lamoom` skill Phase 0–1.

---

## Known Debt (priority-ranked)

Priority legend: **BLOCKING** = blocks launch per PRD Phase 1 MUST; **HIGH** = should fix before launch; **MEDIUM** = fix soon after; **LOW** = nice to have.

> IDs match §Production Status. Update both when adding/removing items.

| # | Issue | Priority | PRD |
|---|---|---|---|
| 1 | Password in `access_token` column | BLOCKING | Phase 1 |
| 2 | No CI/CD | BLOCKING | Phase 1 |
| 3 | No error tracking | BLOCKING | Phase 1 |
| 4 | No uptime monitoring | BLOCKING | Phase 1 |
| 5 | No inline agent editing | BLOCKING | Phase 1 |
| 6 | Pause/delete not wired end-to-end | BLOCKING | Phase 1 |
| 7 | Settings page is a stub | BLOCKING | Phase 1 |
| 8 | Admin auth tables — no Drizzle migration | HIGH | Phase 2 |
| 9 | Hardcoded `localhost:3001` in next.config.ts | HIGH | Phase 2 |
| 10 | Secrets hardcoded in openclaw.json5 | HIGH | — |
| 11 | Agent registration TOCTOU race | HIGH | Phase 2 |
| 12 | `detectAgentCreation` DB insert race | HIGH | Phase 2 |
| 13 | Visitor analytics missing (message/session counts) | HIGH | Phase 2 |
| 14 | Two widget implementations — better one unused | MEDIUM | — |
| 15 | Widget `userId` client-generated (session hijack) | MEDIUM | — |
| 16 | No server-side WS heartbeat | MEDIUM | — |
| 17 | No WS backpressure handling | MEDIUM | — |
| 18 | `touchSessionLastActiveAt` blocks on DB failure | MEDIUM | — |
| 19 | Magic-link form shown when `EMAIL_SERVER` unset | MEDIUM | — |
| 20 | Widget preview no auto-reconnect | MEDIUM | Phase 2 |
| 21 | Hardcoded `dev.lamoom.com` fallbacks | MEDIUM | — |
| 22 | No forgot password flow | MEDIUM | Phase 2 |
| 23 | Gateway config file divergence (json5 vs json) | LOW | — |
| 24 | Token cache in WS handler unbounded | LOW | — |
| 25 | No light/dark theme toggle | LOW | — |
| 26 | No loading skeleton / Suspense boundary on dashboard | LOW | — |
| 27 | `next-auth@5.0.0-beta.31` pre-release in production | LOW | — |

---

## Phase 1 Implementation Specs

These are the PRD Phase 1 MUST items that have no spec yet. Each must ship before launch.

### CI/CD Pipeline

**Provider:** GitHub Actions.  
**Jobs:**

| Job | Trigger | Steps |
|---|---|---|
| `ci` | Every push + PR | `pnpm install` → `pnpm build` → `pnpm test` → widget bundle size check (fail if `wc -c packages/proxy/public/widget.js` > 51200 bytes / 50 KiB; matches PRD §5 NFR) |
| `deploy` | Push to `main` | rsync to Hetzner → `db:migrate` → `admin-static-sync` → health checks |

Required secrets in GitHub: `HETZNER_SSH_KEY`, `DATABASE_URL`, `AUTH_SECRET`, `OPENCLAW_GATEWAY_TOKEN`, `NEXT_PUBLIC_PROXY_URL`.

### Error Tracking

**Service:** Sentry (free tier sufficient for MVP).  
**Integration points:**

- `packages/proxy/src/index.ts` — Fastify Sentry plugin; capture unhandled rejections + route errors
- `packages/admin/src/app/layout.tsx` — `@sentry/nextjs` init
- Widget: no Sentry (bundle size constraint); console-log errors only

Required env vars: `SENTRY_DSN` (proxy + admin), `NEXT_PUBLIC_SENTRY_DSN` (admin client).

### Uptime Monitoring

**Service:** Better Uptime or UptimeRobot (free tier).  
**Monitors:**

| Endpoint | Alert threshold | Alert channel |
|---|---|---|
| `https://dev.lamoom.com/health` | 1 min down | Email + Slack |
| `https://dev.lamoom.com/health/openclaw` | 1 min down | Email + Slack |
| `https://dev.lamoom.com/login` | 1 min down | Email + Slack |

### Agent Editing

PRD: "edit name, URL, instructions without full recreation."

**Data model:** No new column required. `agents.name`, `agents.websiteUrl`, `agents.description` already exist. The PRD's "instructions" field maps to `agents.description` — rename the API parameter or alias it in the validator. (If a longer free-form instructions field is later needed, add `agents.custom_instructions TEXT` in a follow-up migration.)

**API:** `PATCH /api/agents/:id` — body: `{ name?, websiteUrl?, description? }` (Zod-validated). Auth: NextAuth session (admin) OR HMAC headers (customer API). Side effects:
1. UPDATE the `agents` row.
2. Rewrite `AGENTS.md` header + `<workspace>/agent-config.json` to reflect new name/URL/description.
3. SIGHUP gateway only if `name` or workspace-resident metadata changed (`websiteUrl`/`description` edits alone do not require reload).
4. Append `audit_log` entry with action `agent.updated` and a diff of changed fields.

**UI:** On agent detail page (`/dashboard/agents/[id]`), add inline editable fields (name, URL) + a "Custom instructions" textarea. Save button calls PATCH. No new page.

**Scope:** Name + URL edits do NOT re-crawl the site (crawl is expensive). Re-crawl = "update agent" in meta-agent chat (existing flow).

### Pause / Delete Agent

**API:**
- `PATCH /api/agents/:id` with `{ status: "active" | "paused" }` — paused agents return 403 on widget WS auth.
- `DELETE /api/agents/:id` — sets `status = "deleted"`, removes from openclaw.json5, SIGHUP.

**UI:** Dashboard agent row — "Pause" / "Delete" buttons. Delete requires confirmation modal.

**Widget behavior on paused agent:** WS auth returns `{ type: "auth_error", reason: "agent_paused" }`. Widget shows "This assistant is temporarily unavailable."

### Settings Page (`/dashboard/settings`)

Minimum viable content:

| Section | Fields | Actions |
|---|---|---|
| Account | Email (read-only), display name | Save |
| Security | Current password, new password, confirm | Change password |
| Embed API | Customer API token (masked) | Copy, Rotate |
| Danger zone | Delete account | Confirm + delete |

**Password change:** `POST /api/auth/change-password` — validates current bcrypt hash, updates `users.hashedPassword`.  
**Note:** This also fixes Known Debt #1 (password in wrong column) — migrate `access_token` → `hashedPassword` as part of this work.

---

## NFR Measurement Strategy

PRD §5 defines 7 non-functional requirements. Here's how each gets measured.

| NFR | Target | How to Measure | Where to Track |
|---|---|---|---|
| Time-to-first-agent | < 10 min | `test-e2e` Phase 6 timestamps; manual on every release | `e2e-output/<date>/` |
| Widget first response | < 3s p95 | Proxy logs `ws_message_received_at` → `first_token_at`; `test-lamoom` Phase 5 | Proxy logs + Sentry perf |
| Agent creation success rate | ≥ 95% | Proxy counter: `agent_creation_attempts` vs `agent_creation_success`; log to Sentry | Sentry custom metric |
| Visitor satisfaction (G-Eval) | ≥ 3.5/5 | `test-lamoom` Phase 7 G-Eval scoring | `e2e-output/<date>/` |
| Uptime | ≥ 99.5% | Better Uptime / UptimeRobot monthly report | External dashboard |
| Widget load size | < 50 KB | CI job: `ls -la packages/proxy/public/widget.js` → fail build if > 51200 bytes | GitHub Actions `ci` job |
| WS auth latency | < 500 ms | Proxy: log `ws_ticket_requested_at` → `auth_ok_at`; `test-lamoom` Phase 4 | Proxy logs + Sentry |

---

## Architecture Decision Records

### ADR-001: Single VM over Kubernetes

**Decision:** Hetzner CAX11 (€4.29/mo) over managed Kubernetes.  
**Rationale:** MVP scale doesn't justify K8s overhead. Cheaper, faster to iterate, easier to debug.  
**Consequences:** No horizontal scaling. Vertical upgrade path: CAX21 (4 vCPU, 8GB, ~€7.49/mo). Revisit at 10k MAU.

### ADR-002: No Docker Isolation

**Decision:** OpenClaw workspace-scoped tool access over per-agent containers.  
**Rationale:** Containers add ~100–200MB RAM each — unacceptable on 4GB VM. Workspace scoping sufficient for MVP threat model.  
**Consequences:** Meta-agent has elevated filesystem access. Compromised meta-agent prompt could write to any path. Accepted risk for MVP.

### ADR-003: Neon Serverless PostgreSQL

**Decision:** Neon over self-hosted Postgres.  
**Rationale:** Zero DB ops, generous free tier, serverless scale. < 50ms latency from Hetzner Frankfurt to Neon Frankfurt.  
**Consequences:** Cold-start latency on first query after idle. Use connection pooling.

### ADR-004: NextAuth v5 (beta)

**Decision:** `next-auth@5.0.0-beta`.  
**Rationale:** Required for Next.js 15 App Router; v4 incompatible.  
**Consequences:** Pre-release. Pin version. Test before upgrading.

### ADR-005: Widget as Vite IIFE Bundle

**Decision:** Single `.js` IIFE served from proxy at `/widget.js`.  
**Rationale:** Zero dependencies for the website owner — one `<script>` tag, no npm install.  
**Consequences:** Bundle must stay < 50 KiB (51200 bytes). No React in widget code.

### ADR-006: Workflow-as-Code for Product-Agent Actions

**Decision:** Any product-agent action that mutates state, calls an external API, or uses credentials MUST be implemented as a Python script written to `<workspace>/workflows/<verb>-<noun>-<timestamp>.py` and executed via the `exec` tool. Read-only conversational answers MAY skip this.  
**Rationale:**
- **Auditability** — every action leaves a disk artifact, persistent across sessions.
- **Reproducibility** — a workflow can be re-run with the same inputs.
- **Composability** — workflows become building blocks for cron/automation already enabled in `openclaw.json5`.
- **Deterministic eval signal** — Phase 4.5 E2E judge + G-Eval `Workflow Discipline` dimension assert artifact presence rather than parsing intent from natural-language replies.

**Consequences:**
- Product-agents must allow the `exec` tool (see Sandbox Model table); meta-agent continues to deny `exec`.
- `create-agent` seeds `<workspace>/workflows/README.md` and the workflow-first rule into BOTH base templates and meta `templates/` copies (validator in `packages/proxy/src/openclaw/workspace-validator.ts` enforces marker presence on creation).
- Verification depends on filesystem inspection + gateway logs; failure modes here drive the eval gaps listed under §Product-Agent Evaluation.
