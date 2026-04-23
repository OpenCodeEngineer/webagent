# Web MCP Agent — Architecture & Implementation Reference

> Single source of truth for any agent working on this codebase.
> Read this FIRST before exploring files.

---

## What This Is

SaaS platform where business owners create AI chat agents for their websites.
Powered by OpenClaw multi-agent system. Deployed on a single Hetzner CAX11 ARM VM.

**Repo:** `OpenCodeEngineer/webagent` (pnpm monorepo + Turborepo)

---

## System Architecture

```
  Customer Browser ──HTTPS──▶ Nginx (:443)
  Visitor Browser  ──WSS────▶   │
                                 │
                    ┌────────────┼────────────────┐
                    │ Hetzner CAX11 (4GB ARM)     │
                    │                              │
                    │  ┌────────┐  ┌──────────┐   │
                    │  │ Admin  │  │  Proxy   │   │
                    │  │Next.js │  │ Fastify  │   │
                    │  │ :3000  │  │  :3001   │   │
                    │  └────────┘  └────┬─────┘   │
                    │                   │ HTTP     │
                    │              ┌────▼──────┐   │
                    │              │ OpenClaw  │   │
                    │              │ Gateway   │   │
                    │              │  :18789   │   │
                    │              └─────┬─────┘   │
                    │                    │         │
                    │  Agent Workspaces (fs)       │
                    │  ┌───────┐ ┌───────┐        │
                    │  │cust_a/│ │cust_b/│ ...    │
                    │  └───────┘ └───────┘        │
                    └──────────────────────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ Neon PostgreSQL (ext)     │
                    └──────────────────────────┘
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
│   │   │   ├── db/schema.ts          Drizzle ORM schema (customers, agents, widget_sessions, widget_embeds, audit_log)
│   │   │   ├── db/client.ts          Neon serverless + Drizzle client factory
│   │   │   ├── openclaw/client.ts    HTTP client for OpenClaw hooks API
│   │   │   ├── openclaw/sessions.ts  Session key management (currently in-memory Map — NEEDS DB)
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
│   │           ├── login/page.tsx    Login UI (complete)
│   │           └── dashboard/page.tsx Welcome card (placeholder)
│   │
│   ├── widget/       Embeddable JS chat — Vite IIFE bundle → widget.js
│   │   └── src/index.ts              Currently just a purple bubble placeholder
│   │
│   └── shared/       Types, WS protocol, constants (COMPLETE)
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
└── docs/design.md                    User flows, ASCII diagrams, isolation model, VM choice
```

---

## Key Flows

### Flow 1: Visitor sends a chat message

```
Widget (browser)
  │ WS: { type: "message", content: "..." }
  ▼
Proxy WS handler (ws/handler.ts)
  │ 1. Validate auth (embed token → agentId lookup)
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

### Flow 2: Customer creates an agent

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
  │ 3. Create workspace dir on filesystem
  │ 4. Call proxy internal API to register agent in DB
  │ 5. Return embed snippet
  ▼
Proxy: POST /api/internal/agents (internal only)
  │ Creates DB records (agent + widget_embed)
  │ Returns embed token
  ▼
Meta-agent returns widget <script> snippet to customer
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
- Meta-agent is the exception: `sandbox: { mode: "off" }` with no tool restrictions (needs fs access to create workspaces)

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

## Current State & Production Gaps (as of 2026-04-23)

### ✅ Done & Working
- Monorepo scaffold (pnpm + Turborepo, all packages build)
- Proxy: Fastify boot, WS handler with auth protocol, OpenClaw hooks HTTP client, health routes, widget serving
- DB: Complete Drizzle schema + migrations (NOT YET WIRED to runtime)
- Admin: NextAuth v5 config, login page UI, middleware
- Shared: Types, protocol, constants (complete)
- OpenClaw: Multi-agent config, templates, meta-agent workspace, create-agent skill doc
- Infra: Full setup.sh, production nginx (rate limiting, SSL), systemd units

### 🔴 Must Fix for Production

1. **DB not wired to proxy runtime** — `createDb()` exists but no handler imports it. Token validation, session persistence, and agent lookups all use in-memory Maps that die on restart. Wire Drizzle into Fastify as a decorator or plugin.

2. **Widget is a shell** — 39 lines, just a purple bubble. Needs: chat panel UI, WS connection, message list with scrolling, text input, open/close toggle, reconnection logic, typing indicator.

3. **No agent CRUD REST API** — Proxy needs endpoints:
   - `POST /api/internal/agents` — create agent + embed token (called by meta-agent)
   - `GET /api/agents` — list customer's agents (called by admin)
   - `PATCH /api/agents/:id` — update agent status
   - `DELETE /api/agents/:id` — delete agent
   - `POST /api/agents/:id/embed-token` — regenerate embed token

4. **No /create page in admin** — Dashboard links to it but it doesn't exist. Needs chat UI that talks to meta-agent via proxy, displays the embed snippet result.

5. **Meta-agent exec paradox** — create-agent skill tells the LLM to run shell commands, but `exec` is in `tools.deny`. Fix: either (a) grant meta-agent `exec` via per-agent tool override, or (b) rewrite skill to use only read/write/edit tools + HTTP calls to proxy API.

6. **Auth has no DB persistence** — NextAuth Credentials provider returns hardcoded user. Drizzle adapter is in package.json but not configured. Wire `@auth/drizzle-adapter` with the proxy DB.

7. **No embed token generation/validation** — Schema exists, no code creates UUIDs, no WS auth checks the DB. The WS handler's `tokenAgentMap` is an empty in-memory Map that nothing populates.

8. **No CORS/origin validation** — `allowedOrigins` field in DB schema but never enforced in WS handler or widget serving.

9. **No graceful shutdown** — No SIGTERM handler, no WS drain, no cleanup.

10. **Zero tests** — No test runner, no test files anywhere.

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
