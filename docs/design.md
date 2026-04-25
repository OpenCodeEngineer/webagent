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
  │ 4. Write agent-config.json to workspace (slug, name, url, api details)
  │ 5. Emit [AGENT_CREATED::<slug>] marker in response
  ▼
Proxy detects [AGENT_CREATED::<slug>] marker in response
  │ Reads <workspace>/agent-config.json
  │ Registers agent in ~/.openclaw/openclaw.json
  │ Reloads openclaw-gateway (SIGHUP, systemctl fallback)
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
│   │   │   ├── openclaw/client.ts    CLI wrapper (execFile → openclaw agent -m)
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

### OpenClaw Config Registration
- Proxy writes to `~/.openclaw/openclaw.json` (standard JSON, NOT json5)
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

## Production Gaps (updated 2026-04-25)

### ✅ Done & Working
- Monorepo scaffold (pnpm + Turborepo, all packages build)
- Proxy: Fastify boot, WS handler with auth protocol, health routes, widget serving
- Proxy: OpenClaw CLI integration works (sync responses, AI liveness confirmed)
- Proxy: Agent creation detection (`[AGENT_CREATED::]` marker → DB + embed token + embed snippet)
- Proxy: Auto-registers new agents in `~/.openclaw/openclaw.json` + reloads gateway (SIGHUP)
- Proxy: Audit log wired — 5 mutation points write to `audit_log` table
- DB: Neon PostgreSQL + complete Drizzle schema + migrations, wired via Fastify plugin
- DB: Embed token generation, validation, and regeneration endpoint
- Admin: NextAuth v5 + DrizzleAdapter, bcrypt credentials, auto-signup, Email provider
- Admin: WS-based create-agent chat (not REST), admin auth mode in proxy
- Admin: Dashboard with agent list, agent detail page, live widget preview
- Admin: Login page (credentials, Google, GitHub, magic-link email)
- Widget: Vite IIFE bundle + esbuild standalone, served from proxy at `/widget.js`
- Shared: Types, protocol (standardized `token` field + admin mode), constants
- OpenClaw: Multi-agent config, meta-agent workspace + create-agent skill (4-step flow)
- OpenClaw: Workspace templates populated (AGENTS, SOUL, IDENTITY, USER, website-api skill)
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

2. **Open registration — no signup gate** — Credentials provider auto-creates an
   account on first login (any email + any password). No email verification, no
   invite-only gate, no admin approval. Anyone can create an admin account.
   **Fix:** Add email verification flow, or require invite codes for MVP.

3. **No rate limiting** — No `@fastify/rate-limit` or equivalent on WS connections,
   REST API, or auth endpoints. Trivial to DoS (each message spawns a CLI process).
   **Fix:** Install `@fastify/rate-limit`, add per-IP limits on WS upgrade + REST.

4. **Single shared API token = no tenant isolation** — `requireCustomerAuth()` uses
   one static bearer token. Any authenticated customer can access any other's agents
   by passing a different `customerId` query param. **Fix:** Per-customer JWT tokens
   derived from NextAuth session, validated by proxy.

5. **setup.sh missing build + migrate** — Fresh deploy will crash: no `pnpm build`
   step, no `db:migrate` step. Tables won't exist, `dist/` will be empty.

6. **CLI → WS rewrite still pending** — `openclaw/client.ts` spawns child processes
   via `execFile`. No streaming, process-per-message overhead, no connection reuse.
   This is the #1 scalability blocker. Blocked on OpenClaw `/v1/responses` API.

### 🟠 HIGH — Should Fix Before Launch

7. **Token comparison not timing-safe** — `api.ts` and `handler.ts` use `!==` for
   token comparison. Must use `crypto.timingSafeEqual` to prevent timing attacks.

8. **Password stored in `access_token` column** — bcrypt hash is placed in
   `accounts.access_token` instead of a dedicated column. Semantically wrong and
   will break if adapter logic reads `access_token` expecting an OAuth token.

9. **No JWT expiry configured** — NextAuth `session.strategy: "jwt"` but no
   `maxAge`. Stolen JWTs persist indefinitely.

10. **No WS `maxPayload` limit** — Default `ws` library allows 100MB frames. No
    explicit limit configured. Add `maxPayload: 65536` to `@fastify/websocket`.

11. **No `unhandledRejection` / `uncaughtException` handlers** — Only SIGTERM/SIGINT
    handled. An unhandled promise rejection crashes the process.

12. **Agent registration TOCTOU race** — `registerAgentInOpenClaw` reads config,
    checks slug, writes. Two concurrent creates for same slug can both pass the
    check. Needs file locking or atomic compare-and-write.

13. **`detectAgentCreation` DB insert race** — No `onConflictDoNothing` on agent
    insert. Concurrent creation of same `openclawAgentId` throws unhandled unique
    violation.

14. **No circuit breaker / concurrency limit for OpenClaw CLI** — Under load,
    hundreds of concurrent `execFile` processes can be spawned. No semaphore, no
    circuit breaker to fail fast after repeated failures.

15. **No connection limit per IP** — Single IP can open unlimited WS connections,
    exhausting server memory.

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
