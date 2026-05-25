# Roadmap: Lamoom — v1.0 MVP Launch Readiness

## Overview

Phase 0 is fully shipped. This roadmap closes the remaining launch blockers before public traffic: accurate documentation, CI enforcement, production error visibility, data-layer correctness, and a test skill that can give a READY verdict against the full PRD user loop.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Docs Reconciliation** - Update TDD Known Debt and Production Status to reflect Phase 0 ship reality
- [ ] **Phase 2: CI Quality Gates** - Enforce widget bundle size limit automatically in CI before PR merge
- [ ] **Phase 3: Production Observability** - Wire Sentry and external uptime monitoring so errors and outages are caught automatically
- [ ] **Phase 4: Data Integrity** - Reconcile the password column split so auth writes to a single source of truth
- [ ] **Phase 5: Test Coverage Alignment** - Align the test skill to the full PRD §4 user loop, enforce G-Eval gate, document subagent execution pattern

## Phase Details

### Phase 1: Docs Reconciliation
**Goal**: Documentation accurately reflects what is live in production so no one acts on stale debt or phantom blockers.
**Depends on**: Nothing (first phase)
**Requirements**: DOC-01, DOC-02
**Success Criteria** (what must be TRUE):
  1. Every item in TDD `§Known Debt` that shipped in Phase 0 is marked resolved with a delivery reference.
  2. TDD `§Production Status → BLOCKING` contains no items that are confirmed shipped — the list only holds genuine open work.
  3. A developer reading both sections gets an accurate picture of current debt without cross-checking git history.
**Plans**: TBD

### Phase 2: CI Quality Gates
**Goal**: The CI pipeline automatically blocks any PR that would ship a widget bundle exceeding the 50 KiB NFR.
**Depends on**: Phase 1
**Requirements**: CI-01, CI-02
**Success Criteria** (what must be TRUE):
  1. A CI step runs on every PR and measures the built `widget.js` byte size against the 51200-byte threshold.
  2. A PR that produces a widget over 51200 bytes cannot be merged — the CI check fails and blocks the merge button.
  3. A PR within the limit passes the check without manual intervention.
**Plans**: TBD
**UI hint**: no

### Phase 3: Production Observability
**Goal**: Unhandled errors in proxy and admin are captured in Sentry, and an external monitor alerts within 5 minutes of a site outage.
**Depends on**: Phase 2
**Requirements**: OBS-01, OBS-02, OBS-03
**Success Criteria** (what must be TRUE):
  1. An unhandled exception thrown in the proxy service appears in the Sentry project with a full stack trace within seconds.
  2. An unhandled client-side or server-side error in the Next.js admin app appears in Sentry with context (URL, user session if available).
  3. An external uptime monitor (e.g. BetterUptime, UptimeRobot) is configured on the public domain and fires an alert within 5 minutes when the site is unreachable.
  4. The Sentry DSN and uptime monitor are configured via environment variables, not hardcoded values.
**Plans**: TBD

### Phase 4: Data Integrity
**Goal**: The platform writes and reads passwords through a single column so there is no risk of auth failures from a split source of truth.
**Depends on**: Phase 3
**Requirements**: DB-01
**Success Criteria** (what must be TRUE):
  1. Either `customers.passwordHash` or `users.hashedPassword` is the sole column used for password storage — the other is dropped or unused.
  2. All auth code paths (login, registration, password change) read and write only the surviving column.
  3. A migration or reconciliation script exists that documents how existing rows were unified.
**Plans**: TBD

### Phase 5: Test Coverage Alignment
**Goal**: The test-lamoom skill covers every step of the PRD §4 user loop, enforces a G-Eval quality gate, and is self-contained enough for an AI coding subagent to run the full protocol without human help.
**Depends on**: Phase 4
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05
**Success Criteria** (what must be TRUE):
  1. Running the test skill exercises all 14 PRD §4 steps — onboarding (①–⑦), runtime (⑨–⑬), and retention check (⑭) — and reports PASS or FAIL per step.
  2. The G-Eval gate scores widget responses to both eval questions; a score below 3/5 on either question produces a NOT READY verdict and halts the run.
  3. After a successful widget interaction the dashboard session count increments, and the test records this as a PASS for step ⑭.
  4. SKILL.md contains a self-contained "Subagent Execution" section that an AI coding subagent can follow to run the full protocol autonomously — no human steps required mid-run.
  5. A full test run against the deployed site concludes with either a READY or NOT READY verdict and a per-step breakdown.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Docs Reconciliation | 0/TBD | Not started | - |
| 2. CI Quality Gates | 0/TBD | Not started | - |
| 3. Production Observability | 0/TBD | Not started | - |
| 4. Data Integrity | 0/TBD | Not started | - |
| 5. Test Coverage Alignment | 0/TBD | Not started | - |
