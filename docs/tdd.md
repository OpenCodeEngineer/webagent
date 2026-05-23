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
| `tools.deny` | `["browser", "canvas"]` only | `["exec", "process", "browser", "canvas", "nodes", "gateway"]` |
| `skills` | `["create-agent"]` | `["website-api"]` (generated per customer) |
| `heartbeat` | `{ every: "0m" }` — on-demand only | `{ every: "30m" }` |
| Purpose | Creates other agents | Serves website visitors |

The meta-agent does NOT edit `openclaw.json` directly — the proxy handles agent registration
automatically when it detects the `[AGENT_CREATED::]` marker.

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
- `hooks.allowRequestSessionKey: true` in config
- Constrained with `allowedSessionKeyPrefixes: ["agent:", "widget-", "admin-", "hook:"]`
- Widget session mapping persisted in DB (`widget_sessions.openclawSessionKey`)

### Sandbox Model (NO Docker)

- `sandbox.mode: "off"` — no containers
- `tools.deny: ["exec", "process", "browser", "canvas", "nodes", "gateway"]`
- Agent read/write/edit tools are workspace-scoped by default in OpenClaw
- Meta-agent is the exception: `sandbox: { mode: "off" }` with minimal deny list

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

```
customers
  id            UUID PK
  email         TEXT UNIQUE NOT NULL
  name          TEXT
  passwordHash  TEXT
  oauthProvider TEXT (google | github | email)
  oauthId       TEXT
  plan          TEXT DEFAULT 'free'
  createdAt     TIMESTAMP
  updatedAt     TIMESTAMP

agents
  id              UUID PK
  customerId      UUID FK → customers.id (CASCADE)
  openclawAgentId TEXT UNIQUE NOT NULL    ← matches agent.id in openclaw.json5
  name            TEXT NOT NULL
  websiteUrl      TEXT
  status          TEXT DEFAULT 'active' (active | paused | deleted)
  paperclipAgentId TEXT                  ← optional Paperclip integration ID
  widgetConfig    JSONB DEFAULT '{}'
  apiDescription  TEXT
  createdAt       TIMESTAMP
  updatedAt       TIMESTAMP

widget_sessions
  id                UUID PK
  agentId           UUID FK → agents.id (CASCADE)
  externalUserId    TEXT NOT NULL          ← visitor's userId from widget
  openclawSessionKey TEXT NOT NULL
  lastActiveAt      TIMESTAMP
  createdAt         TIMESTAMP
  UNIQUE(agentId, externalUserId)

widget_embeds
  id              UUID PK
  agentId         UUID FK → agents.id (CASCADE)
  embedToken      TEXT UNIQUE NOT NULL    ← used in <script data-agent-token="...">
  allowedOrigins  TEXT[]
  createdAt       TIMESTAMP

audit_log
  id          BIGSERIAL PK
  customerId  UUID FK → customers.id
  action      TEXT NOT NULL
  details     JSONB DEFAULT '{}'
  createdAt   TIMESTAMP

meta_agent_sessions                        ← one per customer
  id                  UUID PK
  customerId          UUID FK → customers.id (CASCADE)
  openclawSessionKey  TEXT UNIQUE NOT NULL  ← "agent:meta:admin-<customerId>"
  lastActiveAt        TIMESTAMP
  createdAt           TIMESTAMP
  UNIQUE(customerId)

meta_agent_messages                        ← ordered message log
  id          UUID PK
  sessionId   UUID FK → meta_agent_sessions.id (CASCADE)
  role        TEXT NOT NULL                ← 'user' | 'assistant'
  content     TEXT NOT NULL
  createdAt   TIMESTAMP
  INDEX(sessionId, createdAt)
```

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

### 🔴 BLOCKING — Must Fix Before Production Launch

1. Password stored in `access_token` column — bcrypt hash in wrong column; breaks if adapter reads `access_token` for OAuth token.
2. No CI/CD pipeline — deploy is fully manual.
3. No error tracking — no Sentry, Datadog, or equivalent.
4. No external uptime monitoring.
5. Admin auth tables have no migration — `users`, `accounts`, `sessions`, `verification_tokens` rely on adapter auto-creation (fragile).
6. Hardcoded `localhost:3001` rewrite in `next.config.ts` — must be configurable via env var.
7. Hardcoded secrets in `openclaw.json5` — gateway token and hooks secret are inline strings.

### 🟠 HIGH — Should Fix Before Launch

8. Agent registration TOCTOU race — `registerAgentInOpenClaw` reads config, checks slug, writes; two concurrent creates for same slug can both pass. Needs file locking.
9. `detectAgentCreation` DB insert race — no `onConflictDoNothing` on agent insert; concurrent creation throws unhandled unique violation.
10. Two widget implementations — `packages/widget/` (better, unused) vs `packages/proxy/src/widget/widget.ts` (simpler, actually served).

### 🔴 BLOCKING (continued) — PRD Phase 1 MUST

8. No inline agent editing — user must recreate an agent to change name, URL, or instructions. PRD Phase 1 MUST. See §Phase 1 Specs below.
9. Pause / delete agent not wired end-to-end — dashboard UI may show buttons but backend action is unconfirmed. PRD Phase 1 MUST. Needs: `PATCH /api/agents/:id` (status), `DELETE /api/agents/:id`; proxy removes from openclaw.json5, SIGHUP.
10. Settings page at `/dashboard/settings` is a stub — required for password change, invite management, API key display. PRD Phase 1 MUST. See §Phase 1 Specs below.

### 🟠 HIGH — Should Fix Before Launch

11. Agent registration TOCTOU race — `registerAgentInOpenClaw` reads config, checks slug, writes; two concurrent creates for same slug can both pass. Needs file locking.
12. `detectAgentCreation` DB insert race — no `onConflictDoNothing` on agent insert; concurrent creation throws unhandled unique violation.
13. Two widget implementations — `packages/widget/` (better, unused) vs `packages/proxy/src/widget/widget.ts` (simpler, actually served).
14. Visitor analytics missing — dashboard shows no usage data (message count, session count). PRD Phase 2. Need: counter columns on `widget_sessions`; `GET /api/agents/:id/stats` route.

### 🟡 MEDIUM — Fix Soon After Launch

15. Widget `userId` is client-generated — any user can impersonate another's session.
16. No server-side WS heartbeat — stale sockets accumulate.
17. No WS backpressure handling.
18. `touchSessionLastActiveAt` await blocks message processing on DB failure.
19. Magic link form shown even when `EMAIL_SERVER` is unset.
20. Widget preview has no auto-reconnect on disconnect.
21. Hardcoded `dev.lamoom.com` fallbacks in proxy and admin code.
22. No forgot password / account recovery flow. PRD Phase 2.

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

1. Client sends `{ type: "auth", userId, token }` within 30s
2. Server responds `auth_ok` or `auth_error`
3. Admin mode: server immediately sends `{ type: "history", messages[], embedCode? }`
4. Messages stream as `{ type: "message", content, done: boolean }`

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
| 12 | Visitor analytics missing (message/session counts) | HIGH | Phase 2 |
| 13 | Two widget implementations — better one unused | MEDIUM | — |
| 14 | No server-side WS heartbeat | MEDIUM | — |
| 15 | Widget `userId` client-generated (session hijack) | MEDIUM | — |
| 16 | No WS backpressure handling | MEDIUM | — |
| 17 | No forgot password flow | MEDIUM | Phase 2 |
| 18 | Widget preview no auto-reconnect | MEDIUM | Phase 2 |
| 19 | Token cache in WS handler unbounded | LOW | — |
| 20 | Hardcoded `dev.lamoom.com` fallbacks | LOW | — |

---

## Phase 1 Implementation Specs

These are the PRD Phase 1 MUST items that have no spec yet. Each must ship before launch.

### CI/CD Pipeline

**Provider:** GitHub Actions.  
**Jobs:**

| Job | Trigger | Steps |
|---|---|---|
| `ci` | Every push + PR | `pnpm install` → `pnpm build` → `pnpm test` → widget bundle size check (fail if > 50 KB) |
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

**Data model change:** No schema change needed. `agents.name`, `agents.websiteUrl` already exist. Add: update endpoint + workspace file rewrite.

**API:** `PATCH /api/agents/:id` — body: `{ name?, websiteUrl?, instructions? }`. Auth: session. Side effects: rewrite `AGENTS.md` header section in workspace; SIGHUP gateway if agent config changes.

**UI:** On agent detail page, add inline editable fields (name, URL) + a "Custom instructions" textarea. Save button calls PATCH. No new page.

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
**Consequences:** Bundle must stay < 50 KB. No React in widget code.
