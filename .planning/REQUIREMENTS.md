# Requirements: Lamoom

**Defined:** 2026-05-25  
**Core Value:** A business owner can provision a live, site-specific AI support agent in one conversation, zero engineering beyond pasting a script tag.

## v1.0 Requirements

Requirements for MVP launch. Each maps to a roadmap phase.

### Production Observability

- [ ] **OBS-01**: Sentry error tracking wired into proxy service — unhandled exceptions captured with stack traces in Sentry
- [ ] **OBS-02**: Sentry error tracking wired into admin Next.js app — both client-side and server-side errors captured
- [ ] **OBS-03**: External uptime monitor configured and alerting — automated alert fires within 5 minutes of site outage

### CI Quality Gates

- [ ] **CI-01**: Widget bundle size check runs in CI pipeline — build fails automatically if `widget.js` exceeds 51200 bytes (50 KiB NFR)
- [ ] **CI-02**: CI pipeline blocks PR merge when bundle check fails — enforcement, not just reporting

### Data Integrity

- [ ] **DB-01**: Password column reconciled to single source of truth — `customers.passwordHash` and `users.hashedPassword` unified; one column dropped or both routed through one identity model

### Test Coverage (PRD §4 User Loop)

- [ ] **TEST-01**: Test skill covers full onboarding loop (PRD §4 steps ①–⑦) — signup → visit `/create` → type website URL → meta-agent crawls → confirmation → agent provisioned → embed code displayed
- [ ] **TEST-02**: Test skill covers runtime loop (PRD §4 steps ⑨–⑬) — widget appears on page → visitor opens chat → asks question → streaming response < 3 s → multi-turn context preserved
- [ ] **TEST-03**: Test skill covers retention check (PRD §4 step ⑭) — dashboard shows resolved visitor session count > 0 after widget interaction
- [ ] **TEST-04**: G-Eval scoring gate enforced as hard release gate — widget response to both eval questions must score ≥ 3/5; score < 3 = NOT READY
- [ ] **TEST-05**: Test skill documents subagent execution pattern — AI coding subagents can read SKILL.md and run the full test protocol autonomously without human hand-holding

### Docs Reconciliation

- [ ] **DOC-01**: TDD `§Known Debt` table updated to reflect all Phase 0 items now shipped — items confirmed delivered marked as resolved
- [ ] **DOC-02**: TDD `§Production Status → BLOCKING` list reconciled with current state — no stale blockers listed that are actually shipped

## v2 Requirements

Deferred — acknowledged but not in current roadmap.

### Auth & Security

- **AUTH-01**: Forgot password / reset flow via email
- **AUTH-02**: Server-side signed visitor tokens (close session hijack vector — Known Debt #15)

### Developer Experience

- **DX-01**: `NEXT_PUBLIC_PROXY_URL` configurable (kill hardcoded `localhost:3001` — Known Debt #9)
- **DX-02**: Admin auth tables shipped as checked-in Drizzle migration (Known Debt #8)
- **DX-03**: Move hardcoded secrets out of `openclaw.json5` into env (Known Debt #10)

### Reliability

- **REL-01**: Agent registration TOCTOU race fix with file locking (Known Debt #11)
- **REL-02**: `detectAgentCreation` DB insert race fixed with `onConflictDoNothing` (Known Debt #12)
- **REL-03**: Widget preview auto-reconnect on disconnect (Known Debt #20)

### Analytics

- **ANA-01**: Visitor analytics — message counts per agent, top questions

## Out of Scope

| Feature | Reason |
|---------|--------|
| Mobile SDK (iOS/Android) | Web widget reaches mobile browsers; native adds unsupportable per-platform pipeline |
| White-label/reseller | Pricing complexity not validated |
| On-premise deployment | Single-VM Hetzner is the ops story |
| Multi-language admin UI | English only until PMF |
| SOC2/HIPAA compliance | Multi-quarter program; pursue when enterprise deal requires |
| Human handoff / live agent inbox | AI-first thesis; handoff is Intercom-shaped, not MVP |
| Vector DB / RAG over uploads | After live-site agents hit NFR targets |
| Pricing tiers + Stripe | Phase 3 |
| Voice I/O | Phase 3 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| OBS-01 | Phase 3 | Pending |
| OBS-02 | Phase 3 | Pending |
| OBS-03 | Phase 3 | Pending |
| CI-01 | Phase 2 | Pending |
| CI-02 | Phase 2 | Pending |
| DB-01 | Phase 4 | Pending |
| TEST-01 | Phase 5 | Pending |
| TEST-02 | Phase 5 | Pending |
| TEST-03 | Phase 5 | Pending |
| TEST-04 | Phase 5 | Pending |
| TEST-05 | Phase 5 | Pending |
| DOC-01 | Phase 1 | Pending |
| DOC-02 | Phase 1 | Pending |

**Coverage:**
- v1.0 requirements: 13 total
- Mapped to phases: 13 (roadmap complete)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-25*  
*Last updated: 2026-05-25 after roadmap creation — all 13 requirements mapped*
