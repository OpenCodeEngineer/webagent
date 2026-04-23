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
Proxy OpenClaw client (openclaw/client.ts)
  │ POST http://127.0.0.1:18789/hooks/agent
  │ Body: { agentId, sessionKey, message }
  │ Header: Authorization: Bearer $OPENCLAW_HOOKS_TOKEN
  ▼
OpenClaw Gateway
  │ Routes to correct agent by agentId
  │ Loads agent workspace (AGENTS.md, skills, memory)
  │ sessionKey ensures persistent multi-turn conversation
  │ Agent processes message, may call customer API via skill
  ▼
Response: { response, sessionKey, agentId }
  │
  ▼
Proxy relays back over WS: { type: "message", content, done: true }
```

### Flow 3 — Customer creates an agent (code-level trace)

```
Admin UI /create page
  │ Chat interface to meta-agent
  ▼
Proxy REST API: POST /api/agents/create-via-meta
  │ sessionKey: "admin:<customerId>"
  ▼
OpenClaw meta-agent (workspace: openclaw/workspaces/meta/)
  │ Follows create-agent skill (SKILL.md):
  │ 1. Ask about website, API, personality
  │ 2. Generate AGENTS.md, SOUL.md, IDENTITY.md, USER.md, skill
  │ 3. Create workspace dir on filesystem (read/write tools)
  │ 4. Call proxy internal API to register agent in DB
  │ 5. Return embed snippet
  ▼
Proxy: POST /api/internal/agents (internal only)
  │ Creates DB records (agent + widget_embed)
  │ Returns embed token
  ▼
Meta-agent returns widget <script> snippet to customer
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
  └──────────┘          │  └──┬──────────┬──────────────┬──────────────────┘  │
                        │     │          │              │                      │
  ┌──────────┐          │     │ /*       │ /ws, /api    │ /hooks              │
  │ Website  │─── WSS ──│─────│──────────│──────────────│──────────────────┐  │
  │ Visitor  │          │     ▼          ▼              ▼                  │  │
  └──────────┘          │  ┌────────┐ ┌──────────┐ ┌──────────────────┐   │  │
                        │  │ Admin  │ │  Proxy   │ │    OpenClaw      │   │  │
                        │  │ Next.js│ │ Gateway  │ │    Gateway       │   │  │
                        │  │ :3000  │ │ :3001    │ │    :18789        │   │  │
                        │  │        │ │          │ │                  │   │  │
                        │  │ • Auth │ │ • WS hub │ │ • Multi-agent    │   │  │
                        │  │ • Chat │ │ • Session│ │ • Sandbox/session│   │  │
                        │  │   UI   │ │   routing│ │ • Hooks API      │   │  │
                        │  │ • Dash │ │ • Widget │ │ • Cron/heartbeat │   │  │
                        │  │  board │ │   JS CDN │ │                  │   │  │
                        │  └────────┘ └─────┬────┘ └────────┬─────────┘   │  │
                        │                   │               │              │  │
                        │                   │  HTTP hooks   │              │  │
                        │                   └───────────────┘              │  │
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

---

## Package Map

```
webagent/
├── packages/
│   ├── proxy/        Fastify+WS gateway — session routing, OpenClaw hooks client, REST API
│   │   ├── src/
│   │   │   ├── index.ts              Server entrypoint (Fastify boot)
│   │   │   ├── config.ts             Env validation
│   │   │   ├── db/schema.ts          Drizzle ORM schema (all tables)
│   │   │   ├── db/client.ts          Neon serverless + Drizzle client factory
│   │   │   ├── openclaw/client.ts    HTTP client for OpenClaw hooks API
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

### OpenClaw Session Persistence
- `/hooks/agent` creates isolated one-shot sessions by DEFAULT
- For persistent multi-turn: `hooks.allowRequestSessionKey: true` in config
- Pass `sessionKey: "widget:<agentId>:<userId>"` in each request
- Constrained with `allowedSessionKeyPrefixes: ["widget:", "admin:"]`

### Sandbox Model (NO Docker)
- `sandbox.mode: "off"` — no containers
- `tools.deny: ["exec", "process", "browser", "canvas", "nodes", "gateway"]`
- Agent read/write/edit tools are workspace-scoped by default in OpenClaw
- Each agent can only access files within its own workspace directory
- Meta-agent is the exception: `sandbox: { mode: "off" }` with no tool restrictions
  (it needs fs access to create workspaces and update config)

### OpenClaw Config Hot-Reload
- `hybrid` reload mode: changes to `agents.*` hot-apply without restart
- When meta-agent adds new agent to openclaw.json5, gateway picks it up automatically

### Hooks API Limitation
- Hooks API is synchronous HTTP — no token-by-token streaming
- Full response relayed over WS as single message with `done: true`
- Streaming can be added later if OpenClaw supports SSE/chunked hooks responses

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

## Proxy REST API (needed)

```
# Internal (called by meta-agent, localhost only)
POST   /api/internal/agents          Create agent + embed token
GET    /api/internal/agents/:id      Get agent details

# Customer-facing (called by admin UI, authed)
GET    /api/agents                   List customer's agents
PATCH  /api/agents/:id               Update agent status
DELETE /api/agents/:id               Delete agent
POST   /api/agents/:id/embed-token   Regenerate embed token

# Meta-agent bridge
POST   /api/agents/create-via-meta   Forward to meta-agent session

# Health
GET    /health                       Proxy health
GET    /health/openclaw              OpenClaw reachability
```

---

## Environment Variables

```bash
# Required
DATABASE_URL=              # Neon PostgreSQL connection string
OPENCLAW_HOOKS_TOKEN=      # Bearer token for OpenClaw hooks API
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
OPENCLAW_HOOKS_URL=http://127.0.0.1:18789   # Local OpenClaw gateway
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

## Production Gaps (updated 2026-04-23)

### ✅ Done & Working
- Monorepo scaffold (pnpm + Turborepo, all packages build)
- Proxy: Fastify boot, WS handler with auth protocol, OpenClaw hooks HTTP client, health routes, widget serving
- DB: Complete Drizzle schema + migrations
- Admin: NextAuth v5 config, login page UI, middleware
- Shared: Types, protocol, constants (complete)
- OpenClaw: Multi-agent config, templates, meta-agent workspace, create-agent skill doc
- Infra: Full setup.sh, production nginx (rate limiting, SSL), systemd units

### 🔴 Must Fix for Production

1. **DB not wired to proxy runtime** — `createDb()` exists but no handler imports it.
   Token validation, session persistence, agent lookups all use in-memory Maps.
   Wire Drizzle into Fastify as a decorator/plugin.

2. **Widget is a shell** — 39 lines, purple bubble only. Needs: chat panel UI,
   WS connection, message list, text input, open/close toggle, reconnection, typing indicator.

3. **No agent CRUD REST API** — See "Proxy REST API" section above.
   Both admin UI and meta-agent need these endpoints.

4. **No /create page in admin** — Dashboard links to it, doesn't exist.
   Needs chat UI talking to meta-agent via proxy.

5. **Meta-agent exec paradox** — create-agent skill uses shell commands but
   `exec` is in `tools.deny` for customer agents (meta-agent has its own override).
   Verify meta-agent override works; rewrite skill to prefer read/write/edit + HTTP calls.

6. **Auth has no DB persistence** — Credentials provider returns hardcoded user.
   `@auth/drizzle-adapter` in deps but not wired. Need DB-backed auth.

7. **No embed token generation/validation** — Schema field exists, no code
   creates tokens, WS auth checks empty in-memory Map instead of DB.

8. **No CORS/origin validation** — `allowedOrigins` in schema, never enforced.

9. **No graceful shutdown** — No SIGTERM handler, no WS drain.

10. **Zero tests** — No test runner, no test files.
