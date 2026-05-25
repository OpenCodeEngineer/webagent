# Lamoom

## What This Is

Lamoom turns "I have a website" into "my website has an AI support agent" in under ten minutes. Business owners visit the platform, tell a meta-agent their website URL, and get a site-grounded chat widget with one `<script>` tag — no prompt engineering, no vector DBs, no backend to run.

## Core Value

A business owner can provision a live, site-specific AI support agent for their website in one conversation, with zero engineering beyond pasting a script tag.

## Requirements

### Validated

- ✓ Account creation (Google / GitHub / email + bcrypt) — Phase 0
- ✓ Invite-gated signup — Phase 0
- ✓ Meta-agent chat on `/create` (WebSocket, streaming) — Phase 0
- ✓ Website crawl + due-diligence summary — Phase 0
- ✓ Agent provisioning (workspace files + skills + knowledgebase + DB rows + embed token) — Phase 0
- ✓ Specialized template selection by domain — Phase 0
- ✓ Workflow-as-Code for product-agent actions — Phase 0
- ✓ Embed `<script>` tag generation — Phase 0
- ✓ Dashboard: agent list with status badges + session count — Phase 0
- ✓ Agent detail page with live widget preview — Phase 0
- ✓ Inline agent editing (name, URL, description) with workspace file sync — Phase 0
- ✓ Pause / resume / delete agent end-to-end + widget cache invalidation — Phase 0
- ✓ Paused-agent widget UX — Phase 0
- ✓ Settings page (Account, Security, Embed API, Danger Zone) — Phase 0
- ✓ Widget WebSocket chat with token-by-token streaming — Phase 0
- ✓ Markdown rendering (widget + admin) — Phase 0
- ✓ Meta-agent conversation persistence across refresh — Phase 0
- ✓ HMAC-signed customer API auth — Phase 0
- ✓ Rate limiting on WS + REST — Phase 0
- ✓ CORS / origin validation in WS handshake — Phase 0
- ✓ CI workflow (typecheck + test on PR) — Phase 0
- ✓ Deploy workflow (rsync + migrate + admin-static-sync) — Phase 0

### Active

- [ ] Sentry / error tracking (proxy + admin) — no production visibility today
- [ ] External uptime monitoring — no alert if site goes down
- [ ] Widget bundle size check in CI — NFR enforcement currently only manual
- [ ] Password column reconciliation (`customers.passwordHash` vs `users.hashedPassword`)
- [ ] Test skill aligned to PRD §4 user loop steps ①–⑭
- [ ] AI subagent-driven execution for each gap item

### Out of Scope

- Mobile SDK (iOS/Android) — web widget reaches mobile browsers; native SDK adds unsupportable per-platform pipeline
- White-label/reseller program — pricing complexity not validated
- On-premise deployment — single-VM Hetzner is the ops story
- Multi-language admin UI — English only until PMF
- Compliance certifications (SOC2, HIPAA) — pursue when enterprise deal requires
- Synchronous human handoff / live agent inbox — thesis is AI-first
- Vector DB / RAG over user-uploaded documents — after live-site agents hit NFR targets

## Context

- **Stack**: pnpm monorepo + Turborepo; Next.js admin, Node.js proxy, OpenClaw gateway
- **Deploy**: single Hetzner VM, systemd services (`webagent-admin`, `webagent-proxy`, `openclaw-gateway`)
- **Test skill**: `docs/tdd.md` §NFR Measurement Strategy; E2E via `test-lamoom` browser skill
- **Known debt**: ~25 items in TDD §Known Debt; several are Phase 1 launch blockers
- **PRD Phase 0 fully shipped** — all Phase 0 items confirmed in production (2026-05-24)
- **TDD §Known Debt / §Production Status → BLOCKING**: needs reconciliation to reflect Phase 0 ship

## Constraints

- **Timeline**: MVP target — close Phase 1 blockers before public launch
- **Ops**: single VM, no Docker, systemd-only deployment
- **Budget**: Hetzner-class hosting; per-tenant cost must stay trivial
- **Test gate**: test-lamoom QA verdict must be READY before launch
- **Subagent execution**: implementation gaps driven by AI coding subagents, not manual edits

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Native WebSocket chat (no LibreChat) | Removes external auth dependency, faster to ship | ✓ Good — shipped Phase 0 |
| Workspace-per-customer (not packed gateway) | Isolation, simpler agent scoping | — Pending (revisit at 100-agent scale) |
| Browser-driven E2E QA (not shell scripts) | Shell scripts miss UI regression; browser tools catch real UX | ✓ Good |
| Single-VM Hetzner deploy | Minimizes ops overhead at MVP stage | ✓ Good |

## Current Milestone: v1.0 MVP Launch Readiness

**Goal:** Close implementation gaps (Phase 1 PRD blockers), align test skill to PRD user journeys, drive completion via AI subagents, reach READY verdict from test-lamoom QA.

**Target features:**
- Sentry error tracking (proxy + admin)
- External uptime monitoring
- Widget bundle size CI check
- Password column reconciliation
- Test skill gap closure (PRD §4 loop coverage, G-Eval gate, subagent execution)

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-25 after milestone v1.0 start*
