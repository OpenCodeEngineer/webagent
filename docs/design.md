# Web MCP Agent — Design Document

## TL;DR

SaaS platform where business owners create AI chat agents for their websites.
Customers describe their site/API in natural language to a **meta-agent**, which
provisions a dedicated OpenClaw agent, generates workspace files and an API skill,
and outputs an embeddable widget `<script>` tag. Website visitors chat through the
widget; a proxy gateway maps each visitor to an isolated OpenClaw session.

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
Meta-agent generates embed snippet & stores it in workspace
        │
        ▼
Customer copies widget code → pastes into their site
```

### Flow 2 — Website visitor chats

```
Visitor lands on customer's site
        │
        ▼
Widget JS loads (from <script data-agent-token="..." data-user-id="...">)
        │
        ▼
Widget opens WebSocket → wss://host/ws
        │
        ▼
Proxy authenticates: resolves agent-token → agentId, validates userId
        │
        ▼
Proxy looks up or creates OpenClaw session for (agentId, userId)
        │
        ▼
Visitor sends message → Proxy relays to OpenClaw hooks API
        │
        ▼
OpenClaw agent processes (in isolated sandbox session)
  • reads AGENTS.md, SOUL.md, skills
  • optionally calls customer's API via website-api skill
        │
        ▼
Response streams back: OpenClaw → Proxy → WebSocket → Widget
```

### Flow 3 — Customer manages agents

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
                        │  │          Docker (sandbox sessions)        │   │  │
                        │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐    │   │  │
                        │  │  │Session A│ │Session B│ │Session C│    │   │  │
                        │  │  │(visitor)│ │(visitor)│ │(visitor)│    │   │  │
                        │  │  └─────────┘ └─────────┘ └─────────┘    │   │  │
                        │  └───────────────────────────────────────────┘   │  │
                        └──────────────────────────────────────────────────┘  │
                                                                              │
                        ┌──────────────────┐                                  │
                        │ Neon (PostgreSQL) │◀── DB queries ───────────────────┘
                        │ (serverless, ext) │
                        └──────────────────┘
```

---

## Component Map

```
webagent/
├── packages/
│   ├── proxy/          Node.js gateway — WS hub, auth, session routing, OpenClaw hooks client
│   ├── admin/          Next.js app — auth, dashboard, meta-agent chat UI
│   ├── widget/         Embeddable JS — chat bubble, WS client (Vite → single bundle)
│   └── shared/         Types, WS protocol definitions, constants
├── openclaw/
│   ├── config/         openclaw.json5 — multi-agent, sandbox, cron, hooks
│   ├── templates/      Base AGENTS.md / SOUL.md / USER.md / IDENTITY.md for new agents
│   └── workspaces/
│       └── meta/       Meta-agent workspace + create-agent skill
├── infra/              Hetzner setup, Nginx config, systemd units, certbot
└── docs/               This file, ADRs, API spec
```

---

## Key Data Entities

```
┌──────────────┐       ┌───────────────┐       ┌─────────────────┐
│   customer   │──1:N─▶│     agent     │──1:N─▶│  widget_session  │
│              │       │               │       │                 │
│ id visitorId │       │ openclaw_id   │       │ external_user_id│
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
       │  sandbox scope=session    │  sandbox scope=session
       ▼                           ▼
┌─────────────┐ ┌──────────┐  ┌─────────────┐ ┌──────────┐
│ Visitor X   │ │Visitor Y │  │ Visitor P   │ │Visitor Q │
│ (sandboxed) │ │(sandboxed│  │ (sandboxed) │ │(sandboxed│
│  session)   │ │ session) │  │  session)   │ │ session) │
└─────────────┘ └──────────┘  └─────────────┘ └──────────┘

• Each agent = isolated workspace (no cross-customer leakage)
• Each visitor = isolated sandbox session (no cross-visitor leakage)
• Cron/heartbeat scoped per agent, never touches other agents' sessions
```

---

## Hetzner VM Choice

**CAX11 (ARM Ampere)** — cheapest option, fully compatible with our stack.

| | CAX11 (ARM) | CX22 (x86) |
|---|---|---|
| CPU | 2 vCPU Ampere | 2 vCPU Intel/AMD |
| RAM | 4 GB | 4 GB |
| Disk | 40 GB SSD | 40 GB SSD |
| Price | ~€3.79/mo | ~€4.35/mo |
| + IPv4 | +€0.50/mo | +€0.50/mo |
| **Total** | **~€4.29/mo** | **~€4.85/mo** |

ARM works because:
- Node.js 22/24 → native `linux-arm64` builds
- OpenClaw → pure Node.js, no native binaries
- Docker → ARM images for Ubuntu/Debian sandbox containers
- Nginx → native ARM packages

If 4 GB RAM gets tight under load, upgrade to **CAX21** (4 vCPU, 8 GB, ~€7.49/mo).
