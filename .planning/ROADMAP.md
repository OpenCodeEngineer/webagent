# Roadmap: Lamoom — v1.0 MVP Launch Readiness

## Overview

Phase 0 is fully shipped. This milestone has one goal: get the full PRD §4 user loop working on staging. Observability, CI bundle gates, and password reconciliation are deferred to v2. The sequence is diagnose → fix → align tests → verify READY.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Test Audit** - Run the test-lamoom skill against staging and produce a written PASS/FAIL table per phase — no code changes, diagnosis only
- [ ] **Phase 2: Fix E2E Blockers** - AI subagents fix every BLOCKING/RELEASE-CRITICAL failure found in Phase 1 so the full PRD §4 user loop works end-to-end
- [ ] **Phase 3: Test Skill Alignment** - Update SKILL.md to map each test phase to PRD §4 steps ①–⑭, harden the G-Eval gate as a hard release gate, and add a self-contained subagent execution section
- [ ] **Phase 4: Final Verification** - Run the full test skill against staging and achieve a READY verdict

## Phase Details

### Phase 1: Test Audit
**Goal**: Know exactly which parts of the PRD §4 user loop are broken on staging before touching any code.
**Depends on**: Nothing (first phase)
**Requirements**: (audit run that seeds Phase 2; TEST-04 success criterion is in Phase 4)
**Success Criteria** (what must be TRUE):
  1. The test-lamoom skill has been run against the current staging deployment from start to finish.
  2. A written PASS/FAIL table exists covering every skill phase (Phase 0 through Phase 10) with a one-line note per failure.
  3. Every BLOCKING and RELEASE-CRITICAL failure is explicitly labelled so Phase 2 has a prioritised fix list.
  4. No code was changed during this phase — the audit reflects the real current state of staging.
**Plans**: TBD

### Phase 2: Fix E2E Blockers
**Goal**: Every BLOCKING and RELEASE-CRITICAL failure from the Phase 1 audit is resolved so a user can complete the full PRD §4 loop on staging without hitting a hard stop.
**Depends on**: Phase 1
**Requirements**: FLOW-01, FLOW-02, FLOW-03, FLOW-04, FLOW-05, FLOW-06, FLOW-07, FLOW-08, FLOW-09
**Success Criteria** (what must be TRUE):
  1. User can sign up, reach the dashboard, and navigate to `/create` — the native WebSocket chat loads with dark theme and no auth errors (FLOW-01, FLOW-02).
  2. The meta-agent fetches the target website and returns a site-specific summary when given a URL — generic or apology responses are absent (FLOW-03).
  3. On confirmation, the meta-agent provisions a real agent: workspace files, knowledgebase, embed token, and DB rows all created; the embed `<script>` tag appears in chat (FLOW-04, FLOW-05).
  4. The widget preview on the agent detail page reaches "Connected" state, answers visitor questions with site-specific content in under 3 s first token, and preserves multi-turn context (FLOW-06, FLOW-07, FLOW-08).
  5. After a real widget interaction the dashboard session count increments and the owner can see the resolved session (FLOW-09).
**Plans**: TBD
**UI hint**: yes

### Phase 3: Test Skill Alignment
**Goal**: SKILL.md is updated so that every test phase explicitly maps to a PRD §4 loop step, the G-Eval gate is a hard non-negotiable release gate, and an AI coding subagent can execute the full protocol autonomously without human intervention.
**Depends on**: Phase 2
**Requirements**: TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. Each skill phase header or annotation references the specific PRD §4 step(s) it validates (e.g. "Phase 2 → PRD §4 step ③") so traceability is explicit (TEST-01).
  2. The G-Eval scoring section states clearly that both eval questions must score ≥ 3/5 and that any score below 3 produces a NOT READY verdict immediately — no escape hatch (TEST-02).
  3. SKILL.md contains a standalone "Subagent Execution" section that lists every tool, credential, and decision point an AI coding subagent needs to run the full protocol start-to-finish without asking a human (TEST-03).
**Plans**: TBD

### Phase 4: Final Verification
**Goal**: The updated test skill is run against staging and returns a READY verdict, confirming the full PRD §4 loop is working and all hard release gates are satisfied.
**Depends on**: Phase 3
**Requirements**: TEST-04
**Success Criteria** (what must be TRUE):
  1. The full test-lamoom skill run produces a written per-phase PASS/FAIL table covering all phases (Phase 0 through Phase 10) (TEST-04).
  2. Every BLOCKING and RELEASE-CRITICAL phase shows PASS.
  3. Both G-Eval questions score ≥ 3/5.
  4. The run concludes with the explicit line **VERDICT: READY**.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Test Audit | 0/TBD | Not started | - |
| 2. Fix E2E Blockers | 0/TBD | Not started | - |
| 3. Test Skill Alignment | 0/TBD | Not started | - |
| 4. Final Verification | 0/TBD | Not started | - |
