# MVP Readiness Report — Lamoom

**Run date:** 2026-05-23  
**Run ID:** mvp-2026-05-23-run3  
**Evaluator:** Claude Sonnet 4.6 (automated)  
**Target:** https://dev.lamoom.com  
**Git branch:** fix/remove-openclaw-gateway-service  
**Git HEAD (local):** 01ba327  
**Agent slug:** shopdemo-69a2de96 (generic, https://example.com)

---

## Executive Summary

**VERDICT: NOT READY FOR MVP**

Gate 2 passes with one blocking failure: **Phase 4.5 Workflow Artifact Audit FAIL** — the product agent does not execute Python workflows for action-type requests. Gate 3 (G-eval) passes with a composite score of 4.62/5.0 (COMPLETE), demonstrating strong knowledge-recall, refusal, and auth-fallback behavior. The core MVP blocker is that no API integration is configured for the created agent — the product agent responds to action requests with prose descriptions rather than executing code.

Additionally, the Azure judge model (`kimi-k2.5-thinking`) is incompatible with the automated harness — it outputs reasoning in `reasoning_content` with empty `content`, causing JSON parse failures for 4 of 10 prompts. Those prompts were manually scored.

---

## Gate 1: Pre-flight Checks — PASS

| Check | Result | Notes |
|---|---|---|
| Admin UI health (`/`) | PASS | 200 OK |
| SSH connectivity | PASS | root@78.47.152.177 accessible |
| OpenClaw gateway health | PASS | `/health` 200 OK |
| Widget.js served | PASS | 200 OK, 12960 bytes |
| Azure AI judge model reachable | PASS | kimi-k2.5-thinking via AZURE_DEV_AI_BASE_URL |
| openclaw.json5 exec audit | PASS | meta workspace exec BLOCKED; product workspaces exec ALLOWED |
| SSH template Workflow-as-Code | PASS | Template present in /opt/webagent/openclaw/workspaces/meta/templates/ |

---

## Gate 2: End-to-End User Flow — PARTIAL PASS

### Phase Results

| Phase | Status | Notes |
|---|---|---|
| Phase 0: Pre-flight | PASS | All checks green |
| Phase 1: Login | PASS | demo@lamoom.com / demo123 → /dashboard. T0→T1 measured. |
| Phase 2: Agent Creation | PASS | Agent created for https://example.com. T5-T0 ≈ 162s. Embed code with UUID generated. |
| Phase 3: Dashboard Verification | PASS | Agent visible in dashboard. Agent detail page accessible. |
| Phase 4: Widget Chat | PASS | Widget injected. Responded to knowledge questions. |
| **Phase 4.5: Workflow Artifact Audit** | **FAIL** | **BLOCKING** |
| Phase 5: UX Quality Audit | PASS | No broken UI elements observed. |
| Phase 6: Time-to-Value | PASS | 162s embed-code-to-ready. Within 3-minute budget. |

### Phase 4.5 Detail — FAIL (BLOCKING)

**Action prompt sent:** "Show me the current status of all tenants"

**Agent response:** Agent described the API call it would make but did not execute it. No `workflows/` directory was created in `/opt/webagent/openclaw/workspaces/shopdemo-69a2de96/`.

**Root cause:** The shopdemo-69a2de96 agent was created as a generic knowledge-base-only agent. Its `TOOLS.md` states "Agent Type: Knowledge-base only (no API integration configured)." The workflow-as-code template is not active for this agent; the agent lacks session auth context injection needed to make API calls.

**Evidence:**
- No `workflows/` subdirectory found in agent workspace (SSH confirmed)
- Agent response described intent without execution: "I would make this API call... but I need session auth context"
- TOOLS.md confirms knowledge-base only configuration

**Screenshots:** `evals/e2e-output/2026-05-23/` — 14 screenshots captured across all phases.

---

## Gate 3: Product-Agent G-Eval — PASS (4.62 / 5.00)

**Agent slug:** shopdemo-69a2de96  
**Prompts run:** 10 (P4, P5 skipped — no API for generic type)  
**Judged by Azure kimi:** 6 prompts  
**Manually scored:** 4 prompts (P7, P10, P11, P12 — kimi JSON parse failure)

### Score Summary

| Prompt | Category | Composite | Verdict |
|---|---|---|---|
| P1: What is this website about? | Knowledge Recall | 5.00 | COMPLETE |
| P2: Who is this website for? | Knowledge Recall | 5.00 | COMPLETE |
| P3: How do I contact support? | Knowledge Recall | 4.33 | MOSTLY_COMPLETE |
| P6: What if my order never arrived? | Multi-step Reasoning | 5.00 | COMPLETE |
| P7: Compare cheapest and most expensive | Multi-step Reasoning | 4.00 | MOSTLY_COMPLETE |
| P8: What is the weather today? | Out-of-scope Refusal | 5.00 | COMPLETE |
| P9: Write me a Python web scraper | Out-of-scope Refusal | 5.00 | COMPLETE |
| P10: Cancel my order #12345 | Auth-missing Fallback | 4.23 | MOSTLY_COMPLETE |
| P11: Create a new account for me | Auth-missing Fallback | 4.62 | COMPLETE |
| P12: What is the return policy? | Knowledge Recall | 4.00 | MOSTLY_COMPLETE |

**Average composite: 4.62 / 5.00**  
**Overall G-eval verdict: COMPLETE**

---

## Top 3 Blockers

| Priority | Blocker | Action |
|---|---|---|
| P0 — BLOCKING | Phase 4.5 FAIL: Product agent does not execute Python workflows for action requests. Agent is configured as knowledge-base-only. No `workflows/` directory is created when action-type prompts are sent. | Configure API integration for the agent type: inject auth context into the widget session environment, ensure TOOLS.md enables exec mode, verify openclaw.json5 exec permission flows to the new agent workspace. |
| P1 | kimi-k2.5-thinking incompatible with G-eval judge harness: returns empty `content`, reasoning in `reasoning_content`. 4 of 10 prompts required manual scoring. | Replace with a standard OpenAI-compatible model that outputs to `content` field (e.g. gpt-4o, claude-3-7-sonnet). |
| P2 | Knowledge base gaps in P3, P7, P12: contact info, product catalog, and return policy are not fully indexed. Agent honestly says "I don't have this in my knowledge base" rather than hallucinating — correct behavior, but G-eval score capped at 4.0 for these prompts. | Expand crawl/ingestion to include /support, /products (with pricing), and /returns pages from the target site. |

---

## What's Broken vs Cosmetic

| Issue | Severity | Type |
|---|---|---|
| Phase 4.5 workflow discipline not triggered | HIGH | Product behavior / config bug |
| kimi-k2.5-thinking JSON output incompatible | MEDIUM | Infrastructure / judge tooling |
| Knowledge base missing contact/products/returns pages | MEDIUM | Data quality |
| Stale Server Action hashes in logs | LOW | Cosmetic (self-heals on hard refresh) |

---

## What's Working Well

- Login and auth flow: fully functional after bcrypt migration fix
- Agent creation flow: end-to-end in 162 seconds (well within 3-minute budget)
- Widget injection and chat: functional
- Knowledge-recall responses: excellent quality (5.0 on P1, P2, P6)
- Out-of-scope refusals: perfect scores (P8, P9)
- Auth-missing fallback behavior: strong (P10, P11) — agent honestly acknowledges limitations and provides actionable next steps

---

## Estimated Fix Effort

| Fix | Effort |
|---|---|
| Configure API integration + auth context for agent exec mode | 2–4 hours |
| Replace kimi judge model with gpt-4o or claude-3-7-sonnet | 30 minutes |
| Expand knowledge base crawl | 1 hour |
| Re-run full gauntlet after fixes | 30 minutes |
| **Total to MVP readiness** | **~4–6 hours** |

---

## Screenshots

All screenshots saved to `evals/e2e-output/2026-05-23/`:

| File | Phase | Description |
|---|---|---|
| `01-login.png` | Phase 1 | Login page initial state |
| `02-login-success.png` | Phase 1 | Post-login dashboard redirect |
| `03-create-textarea-enabled.png` | Phase 2 | Create page — textarea enabled |
| `04-discovery-response.png` | Phase 2 | Agent discovery summary response |
| `04a-discovery-progress-15s.png` | Phase 2 | Progress at 15s mark |
| `05-embed-code.png` | Phase 2 | Embed code with UUID token |
| `06-dashboard-agent.png` | Phase 3 | Dashboard showing created agent |
| `07-agent-detail.png` | Phase 3 | Agent detail page |
| `08-widget-open.png` | Phase 4 | Widget opened via console injection |
| `09-widget-response.png` | Phase 4 | Widget response to knowledge question |
| `10-widget-followup.png` | Phase 4 | Follow-up question answered |
| `10b-action-response.png` | Phase 4.5 | Action question response (description only, no workflow) |
| `ux-dashboard.png` | Phase 5 | UX audit — dashboard |
| `ux-agent-detail.png` | Phase 5 | UX audit — agent detail |

---

## Scorecard

Full per-prompt scorecard: `evals/product-agent/shopdemo-69a2de96-2026-05-23T213000Z.md`

---

## Run History

| Run | Status | Gate 1 | Gate 2 | Gate 3 | Blocker |
|---|---|---|---|---|---|
| mvp-2026-05-23 | NOT_RUN | — | BLOCKED | NOT_RUN | Missing DB column hashed_password |
| mvp-2026-05-23-run2 | NOT_RUN | PASS | BLOCKED (Phase 1) | NOT_RUN | Stale server build — auth.ts read wrong column |
| mvp-2026-05-23-run3 | PARTIAL | PASS | PARTIAL (Phase 4.5 fail) | PASS (4.62) | Workflow discipline not triggered — KB-only agent |
