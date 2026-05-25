# Requirements: Lamoom

**Defined:** 2026-05-25  
**Revised:** 2026-05-25 — reoriented to product-working-first (observability/CI/password deferred)  
**Core Value:** A business owner can provision a live, site-specific AI support agent in one conversation, zero engineering beyond pasting a script tag.

## v1.0 Requirements

Requirements for MVP: product must work end-to-end on staging. Each maps to a roadmap phase.

### E2E Product Flow (Onboarding Loop — PRD §4 steps ①–⑦)

- [ ] **FLOW-01**: User can sign up and reach the dashboard without errors
- [ ] **FLOW-02**: User can navigate to `/create`, see native WebSocket chat load (dark theme, no auth errors)
- [ ] **FLOW-03**: Meta-agent fetches and summarises the target website when user provides a URL (site-specific content, not generic response)
- [ ] **FLOW-04**: Meta-agent creates an agent upon confirmation — workspace files, knowledgebase, embed token provisioned
- [ ] **FLOW-05**: Embed `<script>` tag appears in chat after agent creation with copy button

### E2E Product Flow (Runtime Loop — PRD §4 steps ⑨–⑬)

- [ ] **FLOW-06**: Widget preview on agent detail page connects and enters "Connected" state
- [ ] **FLOW-07**: Widget answers visitor questions with site-specific content, first token in < 3 s
- [ ] **FLOW-08**: Multi-turn conversation context is preserved in the widget

### E2E Product Flow (Retention — PRD §4 step ⑭)

- [ ] **FLOW-09**: Dashboard session count increments after a real widget interaction (owner can see resolved sessions)

### Test Skill Coverage

- [ ] **TEST-01**: Test skill phases map to PRD §4 steps ①–⑭ explicitly — each test phase references the loop step it validates
- [ ] **TEST-02**: G-Eval scoring gate enforced as hard release gate — widget responses to both eval questions must score ≥ 3/5; score < 3 = NOT READY verdict
- [ ] **TEST-03**: Test skill documents subagent execution pattern — AI coding subagent can follow SKILL.md and run the full protocol autonomously without human intervention
- [ ] **TEST-04**: Test skill run against current staging produces a written PASS/FAIL table with per-phase verdict

## v2 Requirements

Deferred — not blocking MVP.

### Production Observability

- **OBS-01**: Sentry error tracking wired into proxy service
- **OBS-02**: Sentry error tracking wired into admin Next.js app
- **OBS-03**: External uptime monitor configured and alerting

### CI Quality Gates

- **CI-01**: Widget bundle size check in CI (blocks merge if > 51200 bytes)
- **CI-02**: CI enforces bundle limit on every PR

### Data Integrity

- **DB-01**: `customers.passwordHash` and `users.hashedPassword` reconciled to single source of truth

### Docs Reconciliation

- **DOC-01**: TDD `§Known Debt` updated for Phase 0 shipped items
- **DOC-02**: TDD `§Production Status → BLOCKING` reconciled

## Out of Scope

| Feature | Reason |
|---------|--------|
| Sentry / error tracking | Deferred to v2 — product must work first |
| Uptime monitoring | Deferred to v2 |
| Widget bundle CI check | Deferred to v2 |
| Password column reconciliation | Deferred to v2 |
| Mobile SDK (iOS/Android) | Web widget reaches mobile; native out of scope |
| White-label/reseller | Not validated |
| On-premise deployment | Single-VM Hetzner only |
| Multi-language admin UI | English only until PMF |
| SOC2/HIPAA compliance | Post-enterprise deal |
| Human handoff / live agent inbox | AI-first thesis |
| Vector DB / RAG over uploads | After live-site agents hit NFR targets |
| Pricing tiers + Stripe | Phase 3 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FLOW-01 | Phase 2 | Pending |
| FLOW-02 | Phase 2 | Pending |
| FLOW-03 | Phase 2 | Pending |
| FLOW-04 | Phase 2 | Pending |
| FLOW-05 | Phase 2 | Pending |
| FLOW-06 | Phase 2 | Pending |
| FLOW-07 | Phase 2 | Pending |
| FLOW-08 | Phase 2 | Pending |
| FLOW-09 | Phase 2 | Pending |
| TEST-01 | Phase 3 | Pending |
| TEST-02 | Phase 3 | Pending |
| TEST-03 | Phase 3 | Pending |
| TEST-04 | Phase 4 | Pending |

**Coverage:**
- v1.0 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-25*  
*Last updated: 2026-05-25 — traceability updated for 4-phase product-first roadmap*
