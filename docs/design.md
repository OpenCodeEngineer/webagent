# Web MCP Agent — Design Document

> Single source of truth for the entire system.
> Read this FIRST before exploring files.

## TL;DR

SaaS platform where business owners create AI chat agents for their websites.
Customers describe their site/API in natural language to a **meta-agent**, which
provisions a dedicated OpenClaw agent, generates workspace files and an API skill,
and outputs an embeddable widget `<script>` tag. Website visitors chat through the
widget; a proxy gateway maps each visitor to an isolated OpenClaw session.

**Repo:** `OpenCodeEngineer/webagent` (pnpm monorepo + Turborepo)

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
Meta-agent asks:
  • What is your website / product?
  • What API does it expose? (endpoints, auth, base URL)
  • What should the agent's personality be?
        │
        ▼
Meta-agent generates:
  ├─ AGENTS.md   (operating instructions)
  ├─ SOUL.md     (persona & tone)
  ├─ IDENTITY.md (name, emoji, vibe)
  ├─ USER.md     (visitor context template)
  └─ skills/website-api/SKILL.md  (how to call customer's API)
        │
        ▼
Meta-agent registers new agent in OpenClaw config
        │
        ▼
Meta-agent calls proxy internal API → DB records + embed token
        │
        ▼
Customer copies widget code → pastes into their site
```

### Flow 2 — Website visitor chats (code-level trace)

```
Widget (browser)
  │ WS: { type: "message", content: "..." }
  ▼
Proxy WS handler (ws/handler.ts)
  │ 1. Validate auth (embed token → agentId lookup via DB)
  │ 2. Build sessionKey: "widget:<agentId>:<userId>"
  │ 3. Look up or create widget_session in DB
  ▼
Proxy → OpenClaw Gateway (shared WS connection)
  │ Same WS used for admin + widget traffic, multiplexed by sessionKey
  │ Model: "openclaw/<agentId>" — routes to correct customer agent
  │ Agent processes message, may call customer API via skill
  │ Streamed response via WS `agent` events (token-by-token)
  ▼
Proxy relays back over WS: { type: "message", content, done: boolean }
  │ Streams tokens as they arrive (done: false → ... → done: true)
```

### Flow 3 — Customer creates an agent (code-level trace)

```
Admin UI /create page
  │ Chat interface (WS to proxy)
  ▼
Proxy WS — routes to OpenClaw gateway WS (model: "openclaw/meta")
  │ sessionKey: "admin:<customerId>"
  ▼
OpenClaw meta-agent (workspace: openclaw/workspaces/meta/)
  │ Follows create-agent skill (SKILL.md):
  │ 1. Ask about website, API, personality
  │ 2. Generate AGENTS.md, SOUL.md, IDENTITY.md, USER.md, skill
  │ 3. Create workspace dir on filesystem (read/write tools)
  │ 4. Edit openclaw.json5 to register new agent
  │ 5. Write agent-config.json to workspace (slug, name, url, api details)
  │ 6. Respond with "agent ready, slug=<slug>"
  ▼
Proxy detects agent creation in response
  │ Reads <workspace>/agent-config.json
  │ Creates DB records (agent + widget_embed)
  │ Generates embed token
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
new workspace directories and edit `openclaw.json5`. Customer agents are restricted
to their own workspace via workspace-scoped tool access.

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
│   │   │   ├── openclaw/client.ts    WS client for OpenClaw gateway protocol
│   │   │   ├── openclaw/sessions.ts  Session key management
│   │   │   ├── ws/handler.ts         WebSocket auth + message relay
│   │   │   ├── routes/health.ts      Health check endpoints
│   │   │   └── routes/widget.ts      Serves widget.js bundle
│   │   ├── drizzle.config.ts
│   │   └── drizzle/                  Generated SQL migrations
│   │
│   ├── admin/        Next.js 15 (App Router) + Tailwind — customer dashboard
│   │   └── src/
│   │       ├── lib/auth.ts           NextAuth v5 config (Google, GitHub, Credentials, Email)
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
│   ├── templates/                    Base templates for new customer agents (AGENTS/SOUL/IDENTITY/USER.md)
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
- Sessions identified by `sessionKey` — e.g. `"widget:<agentId>:<userId>"` or `"admin:<customerId>"`
- Streaming: gateway sends `agent` events token-by-token; proxy relays to client
- Fallback: `/v1/responses` HTTP endpoint available for simple request-response
- Hooks API (`/hooks/agent`) kept only for fire-and-forget (wake, cron triggers)

### OpenClaw Session Persistence
- Each `sessionKey` maintains isolated multi-turn conversation state
- `hooks.allowRequestSessionKey: true` in config
- Constrained with `allowedSessionKeyPrefixes: ["widget:", "admin:"]`

### Sandbox Model (NO Docker)
- `sandbox.mode: "off"` — no containers
- `tools.deny: ["exec", "process", "browser", "canvas", "nodes", "gateway"]`
- Agent read/write/edit tools are workspace-scoped by default in OpenClaw
- Each agent can only access files within its own workspace directory
- Meta-agent is the exception: `sandbox: { mode: "off" }` with minimal deny list
  (it needs fs access to create workspaces and edit openclaw.json5)

### Agent Creation: No Callback Required
- Meta-agent writes workspace files + `agent-config.json` to filesystem
- Proxy detects agent creation in meta-agent's response
- Proxy reads the config file, creates DB records, generates embed token
- Proxy appends embed snippet to the response before sending to customer
- Meta-agent never needs to POST anywhere — it just writes files and talks

### OpenClaw Config Hot-Reload
- `hybrid` reload mode: changes to `agents.*` hot-apply without restart
- When meta-agent adds new agent to openclaw.json5, gateway picks it up automatically

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
  openclawSessionKey TEXT NOT NULL         ← "widget:<agentId>:<userId>"
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
│ widget:a:X  │ │widget:a:Y│  │ widget:b:P  │ │widget:b:Q│
└─────────────┘ └──────────┘  └─────────────┘ └──────────┘

Sandbox approach: WORKSPACE-SCOPED TOOL ACCESS (no Docker)
─────────────────────────────────────────────────────────
• sandbox.mode: "off" — no containers, no Docker overhead
• tools.deny: ["exec", "process", "browser", "canvas", ...] — no shell/system
• read/write/edit are workspace-scoped by default in OpenClaw
  → each agent can only access files within its own workspace dir
• Each visitor = unique sessionKey ("widget:<agentId>:<userId>")
  → OpenClaw isolates conversation state per sessionKey
• Cron/heartbeat scoped per agent, never touches other agents' sessions
• Meta-agent is the only agent with sandbox: "off" + elevated access
  (it needs to create workspaces and update config for new agents)
```

---

## WebSocket Protocol (packages/shared/src/protocol.ts)

### Client → Server
```typescript
{ type: "auth", token: string, userId: string }       // First message, must arrive within 30s
{ type: "message", content: string }                    // Chat message
{ type: "ping" }                                        // Keepalive
```

### Server → Client
```typescript
{ type: "auth_ok", agentId: string }                    // Auth succeeded
{ type: "auth_error", reason: string }                  // Auth failed
{ type: "message", content: string, done: boolean }     // Agent response
{ type: "error", code: string, message: string }        // Error
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

## Production Gaps (updated 2026-04-24)

### ✅ Done & Working
- Monorepo scaffold (pnpm + Turborepo, all packages build)
- Proxy: Fastify boot, WS handler with auth protocol, health routes, widget serving
- Proxy: OpenClaw CLI integration works (sync responses, AI liveness confirmed)
- DB: Complete Drizzle schema + migrations
- Admin: NextAuth v5 config, login page, /create chat UI, middleware
- Shared: Types, protocol, constants (complete)
- OpenClaw: Multi-agent config, meta-agent workspace, create-agent skill doc
- Infra: Full setup.sh, production nginx (rate limiting, SSL), systemd units
- E2E: AI liveness test (7/7 passing), visual demo recorder

### 🔴 Must Fix — Architecture (blocking)

1. **Rewrite OpenClaw client: CLI → WS** — Current `openclaw/client.ts` spawns
   child processes via `execFile`. Must rewrite to use OpenClaw gateway WS protocol
   (single persistent connection, multiplexed by session ID, streaming support).
   Same WS connection serves both admin and widget traffic.

2. **Proxy-side agent creation** — When meta-agent responds with agent config,
   proxy must detect it, read `agent-config.json` from workspace, create DB records,
   generate embed token, and append widget snippet to response. Remove Step 4 from
   create-agent skill (no more callback to internal API).

3. **Build widget.js** — Embeddable chat widget: chat bubble, WS client, auth
   handshake, message display, streaming. Served from proxy at `/widget.js`.
   Must work cross-origin on any customer website.

4. **Create workspace templates** — `~/openclaw/templates/` is empty. Need
   AGENTS.md, SOUL.md, IDENTITY.md, USER.md, skills/website-api/SKILL.md base files.

### 🟡 Must Fix — Integration

5. **DB not wired to proxy runtime** — `createDb()` exists but handlers use
   in-memory Maps. Wire Drizzle into Fastify as decorator/plugin.

6. **Auth has no DB persistence** — Credentials provider returns hardcoded user.

7. **No embed token generation/validation** — Schema exists, no code creates tokens.

8. **No CORS/origin validation** — `allowedOrigins` in schema, never enforced.

### 🟢 Nice to Have

9. **Let's Encrypt** — Replace self-signed cert on dev.lamoom.com.
10. **Graceful shutdown** — SIGTERM handler, WS drain.
11. **E2E test: full flow** — Drive conversation to widget generation, verify DB + WS.
