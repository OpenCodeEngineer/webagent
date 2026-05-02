# WebAgent Project Knowledgebase

## Purpose

WebAgent is a pnpm/Turborepo monorepo for the Lamoom/OpenClaw web agent platform. It combines:

- a Fastify proxy gateway that brokers REST, OpenAI-compatible, and WebSocket traffic to OpenClaw;
- a Next.js admin/customer console for creating and managing website agents;
- an embeddable browser chat widget;
- shared TypeScript protocol/types used across packages;
- OpenClaw agent workspace templates and deployment infrastructure.

## Package layout

- `packages/shared`: TypeScript-only shared package. Exports domain types, WebSocket message protocol, constants, and default ports/paths.
- `packages/proxy`: Fastify service. Owns REST API routes, `/ws` widget/admin WebSocket handling, OpenAI-compatible endpoints, Drizzle schema/migrations, OpenClaw client/reconciler integration, and widget bundle serving.
- `packages/admin`: Next.js 15 App Router admin UI using React 19, NextAuth/Auth.js, Drizzle auth tables, Tailwind 4, and shadcn-style components.
- `packages/widget`: Vite-built embeddable widget script. Mounts into a Shadow DOM, derives `/ws` from the script URL, authenticates with an embed token, and renders chat UI.
- `openclaw/`: local OpenClaw config, meta-agent workspace, workspace templates, agent templates, and generated/seeded skills/knowledgebase files.
- `infra/`: deployment, nginx, systemd, DNS, and LibreChat integration assets.

## Architecture notes

- Runtime flow: admin UI and widget call the proxy; proxy validates auth, persists state in Postgres via Drizzle, and sends agent messages to the OpenClaw gateway.
- Proxy startup (`packages/proxy/src/index.ts`) registers Fastify websocket/rate-limit/db plugins, then health, widget, customer API, admin API, and OpenAI-compatible routes. It also reconciles `openclaw/config/openclaw.json5` with on-disk workspaces before listening.
- Database schema lives in `packages/proxy/src/db/schema.ts`; migrations are under `packages/proxy/drizzle/`. Core tables: `customers`, `agents`, `widget_sessions`, `widget_embeds`, `audit_log`, `meta_agent_sessions`, `meta_agent_messages`.
- Shared WebSocket protocol is in `packages/shared/src/protocol.ts`. Client messages include `auth`, `message`, and `ping`; server messages include `auth_ok`, `auth_error`, `history`, `message`, `error`, and `pong`.
- The proxy serves `/widget.js` from the built widget bundle and exposes the default WebSocket path `/ws` from `@webagent/shared/constants`.

## Dev/test commands

Root commands:

- `pnpm install`
- `pnpm dev` — runs `turbo run dev`
- `pnpm build` — runs package builds with Turbo dependency ordering
- `pnpm lint` — currently TypeScript/Next lint tasks through Turbo
- `pnpm typecheck` — TypeScript checking through Turbo

Useful package commands:

- `pnpm --filter @webagent/shared build`
- `pnpm --filter @webagent/proxy build`
- `pnpm --filter @webagent/proxy dev`
- `pnpm --filter @webagent/proxy test` — Node test runner for proxy tests, with stub env in script
- `pnpm --filter @webagent/proxy db:generate|db:migrate|db:studio`
- `pnpm --filter @webagent/admin dev|build|start|typecheck`
- `pnpm --filter @webagent/widget dev|build|typecheck`

Deployment from local repo state is documented in `README.md`: `bash infra/deploy.sh dev.lamoom.com`.

## Environment conventions

- Root `.env.example` contains the main required variables: `DATABASE_URL`, `OPENCLAW_GATEWAY_TOKEN`, `AUTH_SECRET`, `PORT`, `PROXY_BIND_HOST`, `PROXY_API_TOKEN`, `PROXY_CUSTOMER_API_TOKEN`, `OPENCLAW_GATEWAY_URL`, OAuth/email variables, and Azure OpenAI variables for OpenClaw agents.
- Proxy config defaults: bind host `127.0.0.1`, port `3001`, OpenClaw gateway URL from shared defaults when unset, and gateway token from `OPENCLAW_GATEWAY_TOKEN` with fallbacks to proxy tokens.
- `OPENCLAW_WORKSPACES_DIR` and `OPENCLAW_CONFIG_PATH` override local OpenClaw workspace/config discovery.
- Admin API helpers prefer `NEXT_PUBLIC_PROXY_URL`; server-side fall back to `http://127.0.0.1:${PROXY_PORT ?? 3001}`.
- Next rewrites `/api/agents/create-via-meta` and `/api/agents/:path*` to the proxy using `PROXY_URL`/`PROXY_PORT`.

## Frontend route conventions

Admin uses Next.js App Router under `packages/admin/src/app`:

- `/` (`app/page.tsx`) landing/root page.
- `/login` (`app/login/page.tsx`) Auth.js login.
- `/create` (`app/create/page.tsx`) agent creation flow.
- `/dashboard` (`app/dashboard/page.tsx`) customer dashboard, with nested `/dashboard/settings` and `/dashboard/agents/[id]`.
- `/admin` (`app/admin/page.tsx`) internal/admin CRM area.
- `app/api/auth/[...nextauth]/route.ts` exposes Auth.js handlers.
- `app/api/auth/ws-ticket/route.ts` issues signed WebSocket tickets for authenticated sessions.

Middleware protects `/dashboard/:path*`, `/create/:path*`, and `/admin/:path*` by checking Auth.js session cookies and redirecting to `/login`.

Shared frontend helpers live in `packages/admin/src/lib`; API wrappers are in `src/lib/api.ts`, auth in `src/lib/auth.ts`, proxy signing in `src/lib/proxy-auth.ts`, and DB/auth schema mirrors in `src/lib/db.ts` and `src/lib/auth-schema.ts`. UI components live in `src/components` and `src/components/ui`.

## API patterns

Proxy route files are split by concern in `packages/proxy/src/routes`:

- `health.ts`: `GET /health`, `GET /health/openclaw`.
- `widget.ts`: `GET /widget.js` and CORS preflight.
- `api.ts`: customer-facing agent APIs.
- `admin-api.ts`: internal admin APIs protected by bearer token.
- `openai-compat.ts`: OpenAI-compatible `/v1/*` endpoints.

Customer-facing REST APIs generally return `{ data: ... }` and errors as `{ error: { code, message, details? } }`. Inputs are validated with Zod and mutation routes use stricter rate limits. Customer auth is HMAC-style headers: `x-customer-id` plus `x-customer-sig` formatted as `<hex_hmac>:<unix_ts>` using `PROXY_INTERNAL_SECRET` or proxy token fallbacks.

Important customer routes:

- `POST /api/agents/create-via-meta` — sends the latest user message to OpenClaw meta agent and detects/records created agents.
- `GET /api/agents/meta-history` — returns persisted meta-agent conversation history.
- `GET /api/agents` — lists non-deleted agents for the authenticated customer.
- `GET /api/agents/:id` — fetches an agent plus embed/widget metadata.
- `PATCH /api/agents/:id` — updates agent fields; deep-merges `widgetConfig` and invalidates embed token cache as needed.
- `DELETE /api/agents/:id` — soft-deletes by setting status `deleted`.
- `POST /api/agents/:id/embed-token` — rotates/creates an embed token.
- `POST /api/internal/agents` — localhost-only internal creation path.

Admin/internal routes use bearer auth from `PROXY_CUSTOMER_API_TOKEN`, `PROXY_API_TOKEN`, or `OPENCLAW_GATEWAY_TOKEN`:

- `GET /api/admin/stats`
- `GET /api/admin/users`
- `GET /api/admin/users/:id`
- `GET /api/admin/agents`
- `POST /api/admin/agents/:id/refresh-workspace`
- `GET /api/admin/audit-log`

OpenAI-compatible routes:

- `POST /v1/chat/completions` accepts `model`, `messages`, optional `stream`, and optional `user`; bearer auth required. Model `meta-agent` maps to OpenClaw agent `meta`, otherwise model maps to the agent id. Streaming uses server-sent-event chunks.
- `GET /v1/models` returns available model metadata.

## Agent/OpenClaw workspace conventions

- OpenClaw agent ids are stored as `agents.openclawAgentId` and are used to locate workspaces under `openclaw/workspaces/<slug>` or `OPENCLAW_WORKSPACES_DIR/<slug>`.
- Agent creation/registration updates both database rows and OpenClaw config/workspaces. The proxy prefers skills from on-disk `agent-config.json`, then request widget config, then defaults.
- Website API skill templates are under `openclaw/workspaces/meta/templates/skills/website-api/SKILL.md` and `openclaw/templates/skills/website-api/SKILL.md`.
- Reconciler behavior can be influenced with `OPENCLAW_RECONCILE_REMOVE_ORPHANS=true`.

## Future-agent guidance

- Do not modify application code when only updating project knowledge. Keep docs under `.agents/knowledgebase/`.
- Prefer adding API surface in the relevant proxy route file and keep request validation close to the route using Zod.
- Keep shared wire protocol changes in `packages/shared` and update both widget/admin/proxy consumers.
- For admin UI routes, follow App Router filesystem conventions and place shared data access in `packages/admin/src/lib/api.ts`.
- For DB changes, update Drizzle schema and generate a migration in `packages/proxy/drizzle/`.
