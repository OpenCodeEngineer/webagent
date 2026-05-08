# Paperclip Orchestration Layer — Design Document

## 1. Overview

Lamoom is a SaaS platform where business owners create AI chat agents for their websites. The platform uses two complementary systems:

- **Paperclip** = Control Plane (orchestration, governance, cost tracking, agent lifecycle)
- **OpenClaw** = Execution Plane (real-time chat streaming, agent workspaces, LLM inference)

They complement each other: Paperclip uses the `openclaw-gateway` adapter to invoke OpenClaw agents for actual LLM work, while providing the orchestration, budgeting, and governance layer on top.

Paperclip is an internal control-plane service. End users never interact with the Paperclip UI directly.

## 2. Deployment Types

The platform supports 4 deployment types:

| Type | Description |
|---|---|
| **OpenClaw** | Current default. Single VM with OpenClaw gateway + proxy + admin. Handles real-time chat. |
| **Paperclip** | Adds Paperclip server alongside OpenClaw for orchestration, cost tracking, governance. |
| **Container** | Docker-based deployment (future). Both services containerized. |
| **VM** | Bare-metal/cloud VM provisioning (Hetzner CAX11 ARM64). |

## 3. Architecture

```
┌─────────────────────────────────────────────────┐
│  Paperclip (Control Plane) — port 3100          │
│  • Agent lifecycle & governance                  │
│  • Cost/budget tracking                          │
│  • Issue/task orchestration                      │
│  • Routine scheduling                            │
│  • Company multi-tenancy                         │
└────────────────────┬────────────────────────────┘
                     │ openclaw-gateway adapter
┌────────────────────▼────────────────────────────┐
│  OpenClaw Gateway (Execution Plane) — port 18789 │
│  • Real-time LLM streaming (WebSocket)           │
│  • Agent workspaces (AGENTS.md, skills, KB)      │
│  • Session isolation per visitor                 │
│  • MCP tool execution                            │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  Proxy (API Gateway) — port 3100                 │
│  • WS relay (widget ↔ OpenClaw)                  │
│  • REST API (agents, embeds, admin)              │
│  • Auth context injection                        │
│  • Agent creation detection                      │
└─────────────────────────────────────────────────┘
```

## 4. What Paperclip Adds

- **Agent Lifecycle Governance**: Board-approved agent creation/modification (hire gates)
- **Cost Tracking**: Per-agent, per-customer, per-model token/cost budgets with auto-pause
- **Routine Tasks**: Scheduled health checks, workspace refreshes, analytics collection
- **Issue-Based Orchestration**: Meta-agent work (agent creation) tracked as issues
- **Multi-Company Isolation**: Maps to Lamoom's customer multi-tenancy
- **Plugin System**: Extensibility for future features (analytics, integrations)

## 5. Integration Points

- Paperclip's `openclaw-gateway` adapter connects to OpenClaw for LLM execution
- Proxy registers new agents in both OpenClaw config AND Paperclip (as company agents)
- Paperclip routines trigger workspace refreshes via proxy admin API
- Cost events flow from OpenClaw token usage → Paperclip budget tracking
- Default adapter for all new agents: `openclaw-gateway`
- Lamoom dashboard remains the only customer-facing UX; Paperclip is backend-only

## 6. VM Provisioning (MVP)

- Paperclip runs as a loopback-only internal service via `paperclip.service`
- Systemd starts `npx paperclipai run --data-dir /var/lib/paperclip --bind loopback`
- Default local port is 3100 (embedded Postgres, no external DB needed)
- No public reverse proxy for Paperclip UI; operator access only via SSH tunnel when needed
- First boot performs onboard + doctor + migrations automatically

## 7. Configuration

| Variable | Description |
|---|---|
| `PAPERCLIP_ENABLED=true\|false` | Feature flag to enable/disable Paperclip |
| `PAPERCLIP_PORT=3100` | Port Paperclip listens on |
| `PAPERCLIP_COMPANY_ID` | Auto-created on first boot |

Default agent adapter: `openclaw-gateway` with gateway URL `http://localhost:18789`

## 8. Migration Path

| Phase | Scope |
|---|---|
| Phase 1 (this PR) | VM provisioning, Paperclip runs alongside, no proxy integration yet |
| Phase 2 | Proxy registers agents in Paperclip on creation |
| Phase 3 | Cost tracking integration (token usage → Paperclip budgets) |
| Phase 4 | Governance gates (board approval for agent creation) |
| Phase 5 | Routines (scheduled health checks, analytics) |

## 9. Decision Log

| Decision | Rationale |
|---|---|
| Paperclip as opt-in layer, not replacement | OpenClaw handles real-time chat (Paperclip can't) |
| Default adapter = openclaw-gateway | All Lamoom agents need interactive chat |
| Embedded Postgres (Paperclip's default) | Minimizes infra; separate from Neon (app DB) |
| Feature-flagged via PAPERCLIP_ENABLED | Gradual rollout, existing deployments unaffected |

## Phase 2 Implementation (completed)

### Changes made
- **`packages/proxy/src/config.ts`** — Added `paperclipEnabled` and `paperclipUrl` to `ProxyConfig`, read from `PAPERCLIP_ENABLED` and `PAPERCLIP_URL` env vars
- **`packages/proxy/src/paperclip/client.ts`** — HTTP client for Paperclip API (health check, company listing, agent CRUD, adapter config). All methods no-op when disabled.
- **`packages/proxy/src/paperclip/plugin.ts`** — Fastify plugin decorating `app.paperclip`. Health-checks on startup when enabled.
- **`packages/proxy/src/paperclip/__tests__/client.test.ts`** — Unit tests for PaperclipClient (16 tests)
- **`packages/proxy/src/db/schema.ts`** — Added nullable `paperclip_agent_id` column to `agents` table
- **`packages/shared/src/types.ts`** — Added `paperclipAgentId: string | null` to `Agent` type
- **`packages/proxy/src/routes/api.ts`** — Added `syncAgentToPaperclip()` helper; called from both `detectAgentCreation()` and `POST /api/internal/agents`. Best-effort — failures are logged but never block agent creation.
- **`infra/paperclip/bootstrap.sh`** — Now actually calls Paperclip API to discover company and configure openclaw-gateway adapter

### How it works
1. On proxy startup, if `PAPERCLIP_ENABLED=true`, the Paperclip plugin connects and health-checks
2. When an agent is created (via meta-agent or internal API), `syncAgentToPaperclip()` is called
3. The sync upserts the agent in Paperclip with `adapter: openclaw-gateway` and stores the returned `paperclip_agent_id`
4. All Paperclip operations are best-effort — the proxy works fine without Paperclip

### Migration note
The `paperclip_agent_id` column must be added to the `agents` table. A Drizzle migration should be generated:
```bash
npx drizzle-kit generate
```
