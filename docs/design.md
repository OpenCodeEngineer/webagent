# Web MCP Agent — Design Document

> Single source of truth for the entire system.
> Read this FIRST before exploring files.

## TL;DR

SaaS platform where business owners create AI chat agents for their websites.
Customers describe their site/API in natural language to a **meta-agent**, which
provisions a dedicated OpenClaw agent, generates workspace files (`AGENTS.md`,
`SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `USER.md`) plus skills/knowledgebase files,
and outputs an embeddable widget `<script>` tag. Website visitors chat through the
widget; the proxy maps each `(agent, visitor)` pair to a deterministic OpenClaw
session key.

**Repo:** `OpenCodeEngineer/webagent` (pnpm monorepo + Turborepo)

---

## Agent Generation Flow (sequence diagram)

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
     │    data-agent-token="<embedToken>" async></script>                │
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
     │                     │         │            │                      │
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
  │ sessionKey:
  │ - REST path: "agent:meta:admin-<customerId>-<sessionId>"
  │ - WS path:   "agent:meta:admin-<customerId>-<randomUUID>"
  ▼
OpenClaw meta-agent (workspace: openclaw/workspaces/meta/)
  │ Phase 1: fetch + due diligence packet + one confirmation
  │ Phase 2: create-agent skill writes customer workspace from templates:
  │    AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md, USER.md
  │    + skills + knowledgebase + agent-config.json
  │ Emits [AGENT_CREATED::<slug>] marker in response
  ▼
Proxy detects [AGENT_CREATED::<slug>] marker in response
  │ Reads <workspace>/agent-config.json
  │ Registers slug in OpenClaw config (configured path precedence)
  │ Reloads openclaw-gateway (SIGHUP, systemctl fallback)
  │ Upserts DB records (agent + widget_embed) and embed token
  │ Appends embed snippet to response
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

## Agent & Session Mapping (runtime contract)

| Product concept | Persistent key(s) | Runtime mapping |
|---|---|---|
| Business owner (tenant) | `customers.id` (UUID) | Used for admin auth, audit, and meta session scoping |
| Customer agent | `agents.id` + `agents.openclawAgentId` | `openclawAgentId` is the OpenClaw model slug (`openclaw/<openclawAgentId>`) |
| Widget embed identity | `widget_embeds.embedToken` | Script token resolves to one active `agents` row |
| Website visitor identity | `widget_sessions.externalUserId` | Provided by widget auth payload (`userId`) |
| Widget chat session | `widget_sessions` row keyed by `(agentId, externalUserId)` | `openclawSessionKey = agent:<openclawAgentId>:widget-<openclawAgentId>-<externalUserId>` |
| Admin create/manage session | Session key only | `agent:meta:admin-<customerId>-<sessionId-or-uuid>` |

Deterministic mapping in proxy:
- `getOrCreateSession(agentId, externalUserId, openclawAgentId)` upserts one `widget_sessions` row per `(agentId, externalUserId)`.
- Reconnecting with same `agentToken + userId` reuses the same OpenClaw conversation context.
- Changing `userId` creates a different OpenClaw session key and isolated thread.

## Meta-agent template generation process

`openclaw/workspaces/meta/skills/create-agent/SKILL.md` is the source-of-truth workflow for generation.
After discovery is confirmed, the meta-agent derives customer-specific values and writes files into:
`/opt/webagent/openclaw/workspaces/<agentSlug>/`.

Template roles used for each customer agent:
- `AGENTS.md` — operating instructions, scope boundaries, and behavior rules.
- `SOUL.md` — persona/tone profile for response style.
- `IDENTITY.md` — identity metadata (name, creature, vibe, emoji, optional avatar).
- `TOOLS.md` — local operational notes (API base URL/auth scheme/integration labels); never secrets.
- `USER.md` — per-session visitor context assumptions.

Generation inputs come from meta-agent due diligence:
- verified website facts and product summary,
- canonical links (install/docs/pricing/support),
- API capabilities/auth/base URL (when available),
- brand voice cues.

The meta-agent then writes skills + knowledgebase files, emits `[AGENT_CREATED::<slug>]`,
and the proxy completes registration + embed issuance.

OpenClaw template references:
- `https://docs.openclaw.ai/reference/templates/AGENTS`
- `https://docs.openclaw.ai/reference/templates/SOUL`
- `https://docs.openclaw.ai/reference/templates/IDENTITY`
- `https://docs.openclaw.ai/reference/templates/TOOLS`

---

## What is the "Meta-Agent"?

The meta-agent is **not** a special OpenClaw concept — it's a regular agent with
`id: "meta"` in the `agents.list` config. OpenClaw treats it the same as any
customer agent. What makes it different is how we configure it:

| Property | Meta-agent | Customer agents |
|---|---|---|
| `sandbox.mode` | `"off"` — can write files anywhere | `"off"` + workspace-scoped tools |
| `tools.deny` | `["browser", "canvas"]` only | `["exec", "process", "browser", "canvas", "nodes", "gateway"]` |
| `skills` | `["create-agent"]` | `["website-api"]` (generated per customer) |
| `heartbeat` | `{ every: "0m" }` — on-demand only | `{ every: "30m" }` |
| Purpose | Creates other agents | Serves website visitors |

The meta-agent has `sandbox: "off"` because it needs filesystem access to create
new workspace directories. It does NOT edit `openclaw.json` directly — the proxy
handles agent registration automatically when it detects the `[AGENT_CREATED::]`
marker. Customer agents are restricted to their own workspace via workspace-scoped
tool access.

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
                        │                   │  (multiplexed by │           │  │
                        │                   │   session ID)    │           │  │
                        │                   └──────────────────┘           │  │
                        │                                                  │  │
                        │  ┌───────────────────────────────────────────┐   │  │
                        │  │      Agent Workspaces (filesystem)       │   │  │
                        │  │  ┌─────────────┐ ┌─────────────┐        │   │  │
                        │  │  │ customer_a/ │ │ customer_b/ │  ...   │   │  │
                        │  │  │  AGENTS.md  │ │  AGENTS.md  │        │   │  │
                        │  │  │  skills/    │ │  skills/    │        │   │  │
                        │  │  └─────────────┘ └─────────────┘        │   │  │
                        │  │  Sandbox: workspace-scoped tool access   │   │  │
                        │  │  (read/write/edit restricted to workspace│   │  │
                        │  │   dir; exec/process/browser denied)      │   │  │
                        │  └───────────────────────────────────────────┘   │  │
                        └──────────────────────────────────────────────────┘  │
                                                                               │
                        ┌──────────────────┐                                  │
                        │ Neon (PostgreSQL) │◀── DB queries ───────────────────┘
                        │ (serverless, ext) │
                        └──────────────────┘
```

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
│   │       ├── middleware.ts         Route protection (/dashboard/*, /create/*)
│   │       └── app/
│   │           ├── login/page.tsx    Login UI
│   │           └── dashboard/page.tsx Dashboard
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
│   ├── templates/                    Base templates for new customer agents (AGENTS/SOUL/IDENTITY/TOOLS/USER.md)
│   └── workspaces/
│       └── meta/                     Meta-agent workspace + create-agent skill
│
├── infra/
│   ├── setup.sh                      Full VM provisioning (Node, pnpm, nginx, certbot, systemd, UFW)
│   ├── nginx/webagent.conf           Rate limiting, SSL, WS upgrade, caching
│   └── systemd/                      3 service units (openclaw-gateway, webagent-proxy, webagent-admin)
│
└── docs/design.md                    This file
```

---

## Critical Technical Decisions

### Proxy ↔ OpenClaw: Single WS Connection
- Proxy maintains ONE persistent WebSocket to OpenClaw gateway (`:18789`)
- Both admin (meta-agent) and widget (customer agent) traffic multiplexed on same WS
- Agent selected via `model: "openclaw/<agentId>"` in each request
- Widget session key format:
  `agent:<openclawAgentId>:widget-<openclawAgentId>-<externalUserId>`
- Admin/meta session key format:
  `agent:meta:admin-<customerId>-<sessionId-or-uuid>`
- Streaming: gateway sends `agent` events token-by-token; proxy relays to client
- Fallback: `/v1/responses` HTTP endpoint available for simple request-response
- Hooks API (`/hooks/agent`) kept only for fire-and-forget (wake, cron triggers)

### OpenClaw Session Persistence
- Each `sessionKey` maintains isolated multi-turn conversation state
- `hooks.allowRequestSessionKey: true` in config
- Constrained with `allowedSessionKeyPrefixes: ["agent:", "widget-", "admin-", "hook:"]`
- Widget session mapping is persisted in DB (`widget_sessions.openclawSessionKey`)

### Sandbox Model (NO Docker)
- `sandbox.mode: "off"` — no containers
- `tools.deny: ["exec", "process", "browser", "canvas", "nodes", "gateway"]`
- Agent read/write/edit tools are workspace-scoped by default in OpenClaw
- Each agent can only access files within its own workspace directory
- Meta-agent is the exception: `sandbox: { mode: "off" }` with minimal deny list
  (it needs filesystem access to create customer workspaces and generated files)

### Agent Creation: No Callback Required
- Meta-agent writes workspace files from templates:
  `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `USER.md`
  plus customer skills/knowledgebase and `agent-config.json`
- Proxy detects agent creation in meta-agent's response
- Proxy reads the config file, creates DB records, generates embed token
- Proxy appends embed snippet to the response before sending to customer
- Meta-agent never needs to POST anywhere — it just writes files and talks

### OpenClaw Config Registration
- Proxy config path precedence:
  `OPENCLAW_CONFIG_PATH` → `<repo>/openclaw/config/openclaw.json5` → `~/.openclaw/openclaw.json`
- Proxy parses JSON5, appends agent entry when missing, then writes back config JSON
- Gateway is reloaded via SIGHUP (no root needed); falls back to `sudo systemctl restart openclaw-gateway`
- Note: design originally planned `hybrid` hot-reload, but gateway requires restart
  for new agent entries — this is acceptable for MVP scale

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
  widgetConfig    JSONB DEFAULT '{}'
  apiDescription  TEXT
  createdAt       TIMESTAMP
  updatedAt       TIMESTAMP

widget_sessions
  id                UUID PK
  agentId           UUID FK → agents.id (CASCADE)
  externalUserId    TEXT NOT NULL          ← visitor's userId from widget
  openclawSessionKey TEXT NOT NULL         ← "agent:<openclawAgentId>:widget-<openclawAgentId>-<externalUserId>"
  lastActiveAt      TIMESTAMP
  createdAt         TIMESTAMP
  UNIQUE(agentId, externalUserId)

widget_embeds
  id              UUID PK
  agentId         UUID FK → agents.id (CASCADE)
  embedToken      TEXT UNIQUE NOT NULL    ← used in <script data-agent-token="...">
  allowedOrigins  TEXT[]                  ← CORS origin validation
  createdAt       TIMESTAMP

audit_log
  id          BIGSERIAL PK
  customerId  UUID FK → customers.id
  action      TEXT NOT NULL
  details     JSONB DEFAULT '{}'
  createdAt   TIMESTAMP
```

---

## Data Entity Relationships

```
┌──────────────┐       ┌───────────────┐       ┌─────────────────┐
│   customer   │──1:N─▶│     agent     │──1:N─▶│  widget_session  │
│              │       │               │       │                 │
│ id           │       │ openclaw_id   │       │ external_user_id│
│ email        │       │ website_url   │       │ openclaw_session│
│ oauth_*      │       │ status        │       │ _key            │
│ plan         │       │ widget_config │       │ last_active_at  │
└──────────────┘       └───────┬───────┘       └─────────────────┘
                               │
                               │ 1:1
                               ▼
                       ┌───────────────┐
                       │ widget_embed  │
                       │               │
                       │ embed_token   │
                       │ allowed_origins│
                       └───────────────┘
```

---

## Isolation Model

```
Customer A                          Customer B
    │                                   │
    ▼                                   ▼
┌──────────────────────┐    ┌──────────────────────┐
│ Agent: customer_a    │    │ Agent: customer_b    │
│ workspace-customer_a/│    │ workspace-customer_b/│
│  ├ AGENTS.md         │    │  ├ AGENTS.md         │
│  ├ SOUL.md           │    │  ├ SOUL.md           │
│  ├ skills/           │    │  ├ skills/           │
│  └ memory/           │    │  └ memory/           │
└──────┬───────────────┘    └──────┬───────────────┘
       │                           │
       │  sessionKey isolation     │  sessionKey isolation
       ▼                           ▼
┌─────────────┐ ┌──────────┐  ┌─────────────┐ ┌──────────┐
│ Visitor X   │ │Visitor Y │  │ Visitor P   │ │Visitor Q │
│ session:    │ │session:  │  │ session:    │ │session:  │
│ agent:a:suffix-x │ │agent:a:suffix-y│  │ agent:b:suffix-p │ │agent:b:suffix-q│
└─────────────┘ └──────────┘  └─────────────┘ └──────────┘

Sandbox approach: WORKSPACE-SCOPED TOOL ACCESS (no Docker)
─────────────────────────────────────────────────────────
• sandbox.mode: "off" — no containers, no Docker overhead
• tools.deny: ["exec", "process", "browser", "canvas", ...] — no shell/system
• read/write/edit are workspace-scoped by default in OpenClaw
  → each agent can only access files within its own workspace dir
• Each visitor = unique sessionKey ("agent:<openclawAgentId>:widget-<openclawAgentId>-<externalUserId>")
  → OpenClaw isolates conversation state per sessionKey
• Cron/heartbeat scoped per agent, never touches other agents' sessions
• Meta-agent is the only agent with sandbox: "off" + elevated access
  (it creates workspaces/files; proxy owns OpenClaw config registration)
```

---

## WebSocket Protocol (packages/shared/src/protocol.ts)

### Client → Server
```typescript
{ type: "auth", userId: string, mode?: "widget" | "admin", token: string, agentToken?: string, ticket?: string } | { type: "auth", userId: string, mode?: "widget" | "admin", agentToken: string, token?: string, ticket?: string } // First message within 30s; one of token or agentToken required, mode optional
{ type: "message", content: string }                    // Chat message
{ type: "ping" }                                        // Keepalive
```

### Server → Client
```typescript
{ type: "auth_ok", sessionId: string }                  // Auth succeeded
{ type: "auth_error", reason: string }                  // Auth failed
{ type: "message", content: string, done: boolean }     // Agent response
{ type: "error", message: string }                      // Error
{ type: "pong" }                                        // Keepalive response
```

---

## Proxy REST API

```
# Customer-facing (called by admin UI, authed)
GET    /api/agents                   List customer's agents
PATCH  /api/agents/:id               Update agent status
DELETE /api/agents/:id               Delete agent
POST   /api/agents/:id/embed-token   Regenerate embed token

# Meta-agent chat (admin UI WS or REST fallback)
POST   /api/agents/create-via-meta   Send message to meta-agent, returns response
                                     Proxy detects agent creation in response,
                                     auto-creates DB records + embed token

# Health
GET    /health                       Proxy health
GET    /health/openclaw              OpenClaw reachability
```

---

## Environment Variables

```bash
# Required
DATABASE_URL=              # Neon PostgreSQL connection string
OPENCLAW_GATEWAY_TOKEN=    # Auth token for OpenClaw gateway WS/HTTP
AUTH_SECRET=               # NextAuth.js secret (or NEXTAUTH_SECRET)

# Optional (OAuth)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Optional (Email auth)
EMAIL_SERVER=              # SMTP connection string
EMAIL_FROM=

# Defaults
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789   # Local OpenClaw gateway WS
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
pnpm --filter @webagent/proxy drizzle-kit generate   # Generate migration
pnpm --filter @webagent/proxy drizzle-kit push        # Push schema to Neon

# OpenClaw (must be installed separately on the VM)
openclaw start                         # Start OpenClaw gateway
openclaw agents list                   # List configured agents
```

---

## Deployment (Hetzner CAX11)

- **VM:** 2 ARM vCPU, 4GB RAM, 40GB SSD, ~€4.29/mo
- **OS:** Ubuntu 24.04 ARM
- **Provisioning:** `bash infra/setup.sh` (installs Node 24, pnpm, nginx, certbot, creates systemd services)
- **Services:** openclaw-gateway → webagent-proxy → webagent-admin (dependency chain)
- **SSL:** Let's Encrypt via certbot + nginx
- **Firewall:** UFW (SSH + Nginx only)
- **No Docker** — workspace-scoped tool sandboxing instead
- **Upgrade path:** CAX21 (4 vCPU, 8GB, ~€7.49/mo) if RAM gets tight

---

## v0.0.1 Milestone (tagged 2026-04-26)

Widget shipped with:
- Markdown rendering (bold, italic, code blocks, links, lists, headings) — XSS-safe
- Streaming re-render on each delta (`innerHTML` for assistant, `textContent` for user)
- Monochrome redesign — LibreChat-inspired gray palette (`#0d0d0d`→`#ececec`), zero color
- Round send button with arrow SVG icon

Full E2E verified: signup → meta-agent discovery → agent creation → embed code → widget chat.

---

## Phase Next: LibreChat Integration (Admin UI)

### Why

Our custom Next.js admin chat (`/create`) works but lacks markdown rendering, voice I/O,
file uploads, conversation persistence, and mobile UX. LibreChat (MIT license) provides
all of these battle-tested. Rather than re-implementing, deploy LibreChat as the admin
chat UI and point it at our proxy via a custom endpoint.

### What stays / what changes

| Component | Before | After |
|---|---|---|
| Admin chat UI | Next.js `/create` page | **LibreChat** (custom endpoint → our proxy) |
| Dashboard / agent mgmt | Next.js `/dashboard` | Keep Next.js (or migrate later) |
| Embeddable widget | Custom IIFE (`widget.ts`) | **No change** — LibreChat has no embed mode |
| Proxy gateway | Fastify + WS | Add `/v1/chat/completions` (OpenAI-compat) |
| Database | Neon PostgreSQL | Add **MongoDB** (LibreChat requirement) |
| Auth | NextAuth v5 | LibreChat's own auth (separate system) |

### Architecture with LibreChat

```
┌──────────────────┐     ┌──────────────────────────────────┐
│  Customer Admin   │────▶│  LibreChat (React + Express)      │
│  (browser)        │     │  - Markdown, voice, file uploads  │
│                   │     │  - Custom endpoint → our proxy    │
└──────────────────┘     └──────────┬───────────────────────┘
                                    │ POST /v1/chat/completions
┌──────────────────┐     ┌──────────▼───────────────────────┐
│  Website Visitor  │────▶│  Proxy Gateway (Fastify)          │
│  (widget)         │ WS  │  - /v1/chat/completions (new)     │
└──────────────────┘     │  - /ws (widget)                   │
                         │  - /widget.js                     │
                         └──────────┬───────────────────────┘
                                    │ WS
                         ┌──────────▼───────────────────────┐
                         │  OpenClaw Gateway (:18789)         │
                         └────────────────────────────────────┘
```

### LibreChat custom endpoint config (`librechat.yaml`)

```yaml
version: 1.2.1
cache: true
endpoints:
  custom:
    - name: "Lamoom Agent Builder"
      apiKey: "${PROXY_LIBRECHAT_KEY}"
      baseURL: "http://localhost:3001/v1"
      models:
        default: ["meta-agent"]
      titleConvo: true
      dropParams: ["stop", "frequency_penalty", "presence_penalty"]
```

### New proxy endpoint: `/v1/chat/completions`

OpenAI-compatible wrapper that routes to the meta-agent:

```
POST /v1/chat/completions
Authorization: Bearer <PROXY_LIBRECHAT_KEY>
Content-Type: application/json

{
  "model": "meta-agent",
  "messages": [{ "role": "user", "content": "Create an agent for mysite.com" }],
  "stream": true
}
```

Proxy maps this to the existing OpenClaw WS transport (same as admin chat flow).
Response is SSE with `data: {"choices":[{"delta":{"content":"..."}}]}` chunks.

### New dependencies on VM

| Service | Purpose | RAM estimate |
|---|---|---|
| MongoDB | LibreChat data store | ~200MB |
| LibreChat API | Express backend | ~150MB |
| LibreChat Client | Served by Express | 0 (static) |
| **Total new** | | **~350MB** |

Current VM usage ~1.5GB → total ~1.85GB on 4GB CAX11. Feasible.

### Migration steps

1. Add `/v1/chat/completions` endpoint to proxy (OpenAI-compat SSE)
2. Deploy MongoDB on VM (Docker or apt)
3. Deploy LibreChat (Docker Compose or bare)
4. Configure `librechat.yaml` with custom endpoint
5. Update nginx: route `/chat` → LibreChat, keep `/api` → proxy, `/*` → admin
6. Optional: Write MCP server for OpenClaw agent management (list/delete/edit agents)
7. Optional: Deprecate Next.js `/create` page (keep dashboard)

### Voice I/O (free with LibreChat)

- **STT**: OpenAI Whisper API or local Whisper model
- **TTS**: OpenAI TTS, Azure Speech, ElevenLabs, or browser Web Speech API
- Configured in LibreChat admin panel, no proxy changes needed

---

## Production Gaps (updated 2026-04-25)

### ✅ Done & Working
- Monorepo scaffold (pnpm + Turborepo, all packages build)
- Proxy: Fastify boot, WS handler with auth protocol, health routes, widget serving
- Proxy: OpenClaw Gateway WS integration (streaming responses, single persistent connection)
- Proxy: Agent creation detection (`[AGENT_CREATED::]` marker → DB + embed token + embed snippet)
- Proxy: Auto-registers new agents in OpenClaw config + restarts gateway
- ✅ Proxy: `@fastify/rate-limit` enabled; WS + REST throttling enforced
- ✅ Infra: `infra/setup.sh` and deploy workflow include both `pnpm build` and `db:migrate`
- ✅ Proxy: Gateway WS transport replaces CLI process spawning (single shared connection)
- ✅ Security: Timing-safe token comparison in API + WS auth handlers
- ✅ Proxy: WS `maxPayload: 65536` configured
- ✅ Proxy: `unhandledRejection` / `uncaughtException` handlers wired
- ✅ Proxy: OpenClaw gateway request concurrency guard (`MAX_CONCURRENT_REQUESTS`) in place
- ✅ Proxy: Per-IP WS connection cap enforced (`MAX_WS_PER_IP=20`)
- Proxy: Audit log wired — 5 mutation points write to `audit_log` table
- DB: Neon PostgreSQL + complete Drizzle schema + migrations, wired via Fastify plugin
- DB: Embed token generation, validation, and regeneration endpoint
- Admin: NextAuth v5 + DrizzleAdapter, bcrypt credentials, invite-gated first-time signup, Email provider
- ✅ Proxy/Admin customer API auth uses signed `x-customer-id` + `x-customer-sig` headers (no `customerId` query fallback)
- Admin: WS-based create-agent chat (not REST), admin auth mode in proxy
- Admin: Dashboard with agent list, agent detail page, live widget preview
- Admin: Login page (credentials, Google, GitHub, magic-link email)
- Widget: Vite IIFE bundle + esbuild standalone, served from proxy at `/widget.js`
- Shared: Types, protocol (standardized `token` field + admin mode), constants
- OpenClaw: Multi-agent config, meta-agent workspace + create-agent skill (4-step flow)
- OpenClaw: Workspace templates populated (AGENTS, SOUL, IDENTITY, TOOLS, USER, website-api skill)
- Infra: Full setup.sh, production nginx (rate limiting, SSL), systemd units
- CORS: Widget embed origin validation enforced in WS auth handshake
- Graceful shutdown: SIGTERM/SIGINT handlers with WS drain
- E2E: Full agent creation flow verified (BookNest: create → register → chat → widget preview)

### 🔴 BLOCKING — Must Fix Before Any Production Launch

1. **API token exposed client-side** — `NEXT_PUBLIC_PROXY_API_TOKEN` is bundled into
   browser JS. Anyone can extract it and call backend APIs directly with any
   `customerId`. Client components (`AgentCards`, `AgentDetailActions`) call
   mutating endpoints directly. **Fix:** Route all mutations through Next.js server
   actions or API routes; remove `NEXT_PUBLIC_*` token vars.

2. **(resolved 2026-04-26)** Signup is invite-gated via `AUTH_INVITE_EMAILS`; existing users can still sign in.
3. **(resolved 2026-04-26)** Customer routes require signed `x-customer-id` + `x-customer-sig` headers (deprecated bearer + `customerId` query fallback removed).

### 🟠 HIGH — Should Fix Before Launch

8. **Password stored in `access_token` column** — bcrypt hash is placed in
   `accounts.access_token` instead of a dedicated column. Semantically wrong and
   will break if adapter logic reads `access_token` expecting an OAuth token.

9. **No JWT expiry configured** — NextAuth `session.strategy: "jwt"` but no
   `maxAge`. Stolen JWTs persist indefinitely.

12. **Agent registration TOCTOU race** — `registerAgentInOpenClaw` reads config,
    checks slug, writes. Two concurrent creates for same slug can both pass the
    check. Needs file locking or atomic compare-and-write.

13. **`detectAgentCreation` DB insert race** — No `onConflictDoNothing` on agent
    insert. Concurrent creation of same `openclawAgentId` throws unhandled unique
    violation.

16. **Admin auth tables have no migration** — `users`, `accounts`, `sessions`,
    `verification_tokens` tables are defined in `auth-schema.ts` but have no
    Drizzle migration file. Rely on adapter auto-creation (fragile).

17. **Two widget implementations — better one unused** — `packages/widget/` has a
    full-featured class widget (Shadow DOM, reconnect, ping/pong). `packages/proxy/
    src/widget/widget.ts` is a simpler version actually served. The better one is dead code.

18. **Hardcoded secrets in `openclaw.json5`** — Gateway token and hooks secret are
    inline strings, not env var references.

19. **No CI/CD pipeline** — No GitHub Actions. Deploy is fully manual.

20. **No error tracking** — No Sentry, Datadog, or equivalent.

21. **No external uptime monitoring** — No Uptime Robot or similar.

22. **Hardcoded `localhost:3001` rewrite in admin** — `next.config.ts` rewrites to
    localhost. Must be configurable via env var for production.

23. **`.env.example` incomplete** — ~20 env vars read by code, only ~12 documented.
    Missing: `PROXY_CUSTOMER_API_TOKEN`, `NEXT_PUBLIC_*`, `AUTH_URL`, etc.

### 🟡 MEDIUM — Fix Soon After Launch

24. `/health` doesn't check DB connectivity — returns `ok` based on uptime only.
25. Middleware checks cookie existence, not JWT validity — server-side auth re-checks.
26. No CORS headers on `/api/*` REST routes.
27. Widget `userId` is client-generated — any user can impersonate another's session.
28. `touchSessionLastActiveAt` await blocks message processing on DB failure.
29. No server-side WS heartbeat — stale sockets accumulate.
30. No WS backpressure handling — `send()` doesn't check buffer state.
31. Magic link form shown even when `EMAIL_SERVER` is unset — will error on click.
32. Widget preview has no auto-reconnect on disconnect.
33. No inline agent editing (name, URL, prompt) after creation.
34. No conversation persistence in create-agent-chat across page refresh.
35. Hardcoded `dev.lamoom.com` fallbacks in proxy and admin code.
36. Settings page is a non-functional stub.
37. No migration rollback strategy.
38. Meta-agent `sandbox: "off"` — no sandboxing for the agent builder.

### 🟢 Nice to Have

39. Gateway config file divergence (json5 vs json) — configs drift as agents are created.
40. Agent health check endpoint — verify registered agents are reachable.
41. Widget preview doesn't render streaming partial text in real-time (ref vs state).
42. OAuth providers registered without env var guards — crash if clicked without config.
43. No light/dark theme toggle — dark is hardcoded.
44. No loading skeleton / Suspense boundary on dashboard.
45. Token cache in WS handler has no max size — unbounded map growth.
46. No "forgot password" or "back to dashboard" link on /create page.
47. `next-auth@5.0.0-beta.31` — pre-release software in production.
