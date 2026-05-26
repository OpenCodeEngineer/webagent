# Lamoom — Product Requirements Document

> Last updated: 2026-05-24

---

## 1. Problem Statement

**Who hurts:** Small and mid-sized businesses (SMBs), indie SaaS founders, and product teams that ship a website but cannot staff a 24/7 support function.

**The pain:** Their website visitors arrive with questions the docs already answer — pricing, how-to, "does it integrate with X", "where do I sign up". The visitor's options today are bad:
- Read 20 pages of docs.
- Email support and wait hours.
- Leave the site.

The business's options today are equally bad:
- Hire a support team (≥ $4k/mo per seat).
- Pay $99–$500/mo per seat for Intercom / Drift, which still need humans to answer the long tail.
- Hand-build a chatbot on top of OpenAI: write prompts, scrape the site into a vector DB, wire WebSockets, deploy a backend. Weeks of engineering for something that goes stale the first time the marketing page changes.
- Drop in a rule-based widget (Tidio / Crisp) that can't actually answer anything specific.

**Why now:** LLMs are finally good enough to answer site-specific questions from raw page content, and Hetzner-class hosting makes the per-tenant cost trivial. The missing piece is the **onboarding loop** — turning a URL into a working, embedded, site-grounded agent in minutes, without prompt engineering. That is what Lamoom builds.

**What "without us" looks like:** the business ships a contact form, eats the tickets, and accepts the conversion loss; or they spend an engineering quarter rolling their own.

---

## 2. Solution Thesis

Lamoom turns *"I have a website"* into *"my website has an AI support agent"* in under ten minutes, through a single conversation.

The owner visits `dev.lamoom.com`, tells a **meta-agent** their website URL, and the meta-agent does the work: it crawls the site, summarises what it found, asks one confirmation, then provisions a dedicated **product-agent** with site-specific knowledge and (if applicable) API skills. The owner copies one `<script>` tag, pastes it before `</body>`, and visitors get streaming, contextual chat from that moment on.

There are no prompts to write, no vectors to maintain, no servers to run, no SDKs to install. The customer-visible surface is a chat. The runtime surface is one script tag.

---

## 3. Personas

### Persona A — "The Product Owner" (primary)

- Runs a SaaS product, e-commerce store, or professional service firm (1–20 people).
- Moderately technical: can paste a `<script>` tag, will not write a WebSocket client.
- **What they care about:** answers for their visitors without hiring a support person. Time-to-value measured in coffee breaks, not sprints.
- Budget: free tier or < $50/mo. Cancels immediately if ROI isn't visible.

### Persona B — "The Developer" (secondary)

- Building B2B2C products and needs to embed agents per tenant.
- **What they care about:** programmatic agent creation, stable API contracts, predictable WebSocket protocol, ability to script the embed token rotation.
- Will pay per-agent or per-seat at mid-market rates.

### Persona C — "The Website Visitor" (the end user we're really serving)

- A potential customer on the Product Owner's site. Not a Lamoom user; doesn't know Lamoom exists.
- **What they care about:** getting their question answered in the page they're already on, in < 3 seconds, without context-switching to email or a docs site.
- Has zero patience for "I'm sorry, I'm just a bot" responses. If the first answer is useless, the chat is dead.

### Persona D — "The Enterprise Admin" (future, post-MVP)

- Large company; needs governance, cost tracking, audit logs, SSO/SAML.
- **What they care about:** can they hand this to procurement and security review without it being rejected. Will use the Paperclip integration for agent lifecycle policy.

---

## 4. End-to-End Customer Loop

This is the loop that, when complete, defines "Lamoom worked for this customer". Every PRD decision should be evaluated against whether it speeds up, derisks, or proves a step in this loop.

```
  PRODUCT OWNER (Lamoom customer)                       END VISITOR (their visitor)
  ─────────────────────────────                         ──────────────────────────

  ① Lands on dev.lamoom.com
     │
     ▼
  ② Signs up (Google / GitHub / email + invite)
     │
     ▼
  ③ Dashboard — empty state, "Create Agent" CTA
     │
     ▼
  ④ /create — types: "Create an agent for mysite.com"
     │
     ▼
  ⑤ Meta-agent crawls site, returns due-diligence
     summary, asks "create now?"
     │
     ▼
  ⑥ Owner confirms — agent provisioned (workspace
     files, skills, knowledgebase, config registered
     in gateway, embed token issued)
     │
     ▼
  ⑦ Embed <script> tag shown in chat with copy button
     │
     ▼
  ⑧ Owner pastes <script> before </body> on their site
     │                                                  ⑨ Visitor opens a page
     │                                                     on the owner's site
     │                                                     │
     │                                                     ▼
     │                                                 ⑩ Widget appears bottom-right,
     │                                                    minimized
     │                                                     │
     │                                                     ▼
     │                                                 ⑪ Visitor clicks → opens chat
     │                                                    → asks a question
     │                                                     │
     │                                                     ▼
     │                                                 ⑫ First streaming token in
     │                                                    < 3 s; full answer grounded
     │                                                    in the owner's site
     │                                                     │
     │                                                     ▼
     │                                                 ⑬ Multi-turn conversation;
     │                                                    context preserved
     ▼                                                     │
  ⑭ ROI MOMENT — owner sees real visitor                  │
     conversations resolved without their                  │
     intervention (dashboard session count > 0)  ◄─────────┘
```

**Steps ②–⑦ are the onboarding loop** (target ≤ 10 min, NFR §6).  
**Steps ⑨–⑬ are the runtime loop** (target first-token < 3 s p95, NFR §6).  
**Step ⑭ is the retention loop** — the moment the customer decides Lamoom is worth keeping.

---

## 5. Feature Scope

Phase rows link to the source-of-truth section name in `docs/tdd.md`. Section names are stable; do not rename without a corresponding PRD edit.

### Phase 0 — Shipped (in production today)

| Feature | tdd.md anchor section |
|---|---|
| Account creation (Google / GitHub / email + bcrypt) | §Production Status → Done & Working |
| Invite-gated signup | §Production Status → Done & Working |
| Meta-agent chat on `/create` (WS, streaming) | §Flow 3 — Customer creates an agent (code-level trace) |
| Website crawl + due-diligence summary | §Agent Generation Flow → Phase 1 — Discovery |
| Agent provisioning (workspace files + skills + knowledgebase + DB rows + embed token) | §Agent Generation Flow → Phases 2–3 |
| Specialized template selection by domain | §Meta-Agent Template Generation → Step 0 |
| Workflow-as-Code for product-agent actions | §Workflow-as-Code (Product-Agent Action Pattern) |
| Embed `<script>` tag generation | §Agent Generation Flow → Phase 4 — Delivery |
| Dashboard: agent list with status badges + session count | §Production Status → Done & Working |
| Agent detail page with live widget preview (real `widget.js` iframe) | §Real Widget Embed on Agent Detail Page |
| **Inline agent editing** (name, URL, description) with workspace file sync | §Phase 1 Implementation Specs → Agent Editing |
| **Pause / resume / delete agent** end-to-end + widget cache invalidation | §Phase 1 Implementation Specs → Pause / Delete Agent |
| **Paused-agent widget UX** ("This assistant is temporarily unavailable.") | §WebSocket Protocol; §Phase 1 Implementation Specs → Pause / Delete Agent |
| **Settings page** (Account, Security/password change, Embed API, Danger Zone) | §Phase 1 Implementation Specs → Settings Page |
| Widget WebSocket chat with token-by-token streaming | §Flow 2 — Website visitor chats (code-level trace) |
| Markdown rendering (widget innerHTML tokenizer + admin react-markdown) | §Markdown Rendering |
| Meta-agent conversation persistence across refresh | §Meta-Agent History Persistence |
| HMAC-signed customer API auth (`x-customer-id` + `x-customer-sig`) | §API Conventions → Customer REST API |
| Rate limiting on WS + REST, per-IP WS cap | §Production Status → Done & Working |
| CORS / origin validation in WS handshake | §Production Status → Done & Working |
| CI workflow (typecheck + test on PR) | §Phase 1 Implementation Specs → CI/CD Pipeline |
| Deploy workflow (rsync + migrate + admin-static-sync) | §Phase 1 Implementation Specs → CI/CD Pipeline |

> **Reality vs older PRD note:** the items in **bold** above were listed as `Phase 1 — Launch-Critical (BLOCKING)` in the previous PRD revision. They are now shipped end-to-end (see `docs/superpowers/plans/2026-05-24-agent-management-phase1.md`). The TDD `§Known Debt` table and `§Production Status → BLOCKING` list have not been updated to reflect this and **should be reconciled in the next TDD pass**.

### Phase 1 — Launch-Critical (still blocking public launch)

| Feature | tdd.md anchor section | Why blocking |
|---|---|---|
| Sentry / error tracking (proxy + admin) | §Phase 1 Implementation Specs → Error Tracking | No production visibility today |
| External uptime monitoring | §Phase 1 Implementation Specs → Uptime Monitoring | No alert if the site goes down |
| Widget bundle size check in CI | §Phase 1 Implementation Specs → CI/CD Pipeline | NFR §6 enforcement; currently only manual `wc -c` |
| Password column reconciliation across `customers.passwordHash` and `users.hashedPassword` | §Known Debt #1; §Database Schema | Two columns hold credentials; one source of truth needed before scale |

### Phase 2 — Post-Launch (high-priority follow-ups)

| Feature | tdd.md anchor section |
|---|---|
| Forgot password / reset flow | §Known Debt #22 |
| Visitor analytics — message counts per agent, top questions | §Known Debt #13 |
| Admin auth tables shipped as a checked-in Drizzle migration | §Known Debt #8 |
| `NEXT_PUBLIC_PROXY_URL` configurable (kill hardcoded `localhost:3001`) | §Known Debt #9 |
| Agent registration TOCTOU race fix (file locking) | §Known Debt #11 |
| `detectAgentCreation` DB insert race (`onConflictDoNothing`) | §Known Debt #12 |
| Widget preview auto-reconnect on disconnect | §Known Debt #20 |
| Server-side signed visitor tokens (close session hijack vector) | §Known Debt #15 |
| Move hardcoded secrets out of `openclaw.json5` into env | §Known Debt #10 |

### Phase 3 — Later

| Feature | tdd.md anchor section |
|---|---|
| Pricing tiers + metered billing (Stripe) | — |
| Multiple agents per account with quota enforcement | — |
| HubSpot / CRM integrations promoted to GA | §Flow 4 (E2E covered, not GA) |
| Voice I/O (STT/TTS) via LibreChat path | — |
| Analytics dashboard (heatmaps, top questions, drop-off) | — |
| Light/dark theme toggle | §Known Debt #25 |
| SSO / SAML | — |
| Paperclip governance integration — registration, policy, lifecycle | §Production Status; see `docs/design.paperclip.md` |
| Custom domains for widget (serve `widget.js` from customer CDN) | — |

---

## 6. Non-Functional Requirements

Measurement strategy + ownership for every NFR is captured in `docs/tdd.md` §NFR Measurement Strategy.

| Requirement | Target |
|---|---|
| Time-to-first-agent | < 10 minutes from signup |
| Widget first response time | < 3 seconds (p95) |
| Agent creation success rate | ≥ 95% |
| Visitor satisfaction (G-Eval composite) | ≥ 3.5 / 5 |
| Uptime | ≥ 99.5% monthly |
| Widget load size | < 50 KiB / 51200 bytes |
| WS auth latency | < 500 ms (ws-ticket round trip) |

---

## 7. Out of Scope (v1)

Each item is explicitly out for v1; we list **why** so future contributors can decide whether a new request belongs in scope.

- **Mobile SDK (iOS / Android native widget).** The web `<script>` widget already reaches mobile browsers. A native SDK adds a per-platform release pipeline we cannot staff at MVP.
- **White-label / reseller program.** Pricing and contract surface area we have not validated; would foreclose pricing experiments in Phase 3.
- **On-premise deployment.** Single-VM Hetzner deploy is the entire ops story; on-prem would multiply support cost and is a "call us" request, not a self-serve one.
- **Multi-language admin UI.** English only. Internationalising the dashboard before product-market fit is premature; the customer-facing widget already speaks any language the underlying LLM does.
- **Compliance certifications (SOC2, HIPAA, ISO 27001).** Each is a multi-quarter program. We will pursue them when an enterprise deal requires it, not speculatively.
- **Synchronous human handoff / live agent inbox.** The thesis is "AI answers first". Handoff is an Intercom-shaped product; if we add it, it should be a v2 integration (Slack/email), not a built-in inbox.
- **Vector DB / RAG over user-uploaded documents.** The Phase 0 product crawls the customer's public site; uploading PDFs and private corpora is a different ingestion pipeline that we will scope only after live-site agents reach the NFR targets.

---

## 8. Open Questions

| # | Question | Owner | Decision by |
|---|---|---|---|
| 1 | Pricing model — per-agent flat / per-message metered / freemium with cap | Product <!-- TODO: confirm owner --> | Pre-launch |
| 2 | Invite gate — when do we open public signup? | Product <!-- TODO: confirm owner --> | Launch + 30 days of data |
| 3 | Multi-tenancy — workspace-per-customer vs packed gateway | Eng <!-- TODO: confirm owner --> | Before 100-agent scale |
| 4 | Custom domains for widget — serve `widget.js` from customer CDN? | Eng <!-- TODO: confirm owner --> | Phase 3 |
| 5 | Paperclip integration — when does Phase 2 (registration) ship? | Eng <!-- TODO: confirm owner --> | After Phase 1 launch |
| 6 | Password column unification — drop `customers.passwordHash`, drop `users.hashedPassword`, or merge identities? | Eng <!-- TODO: confirm owner --> | Before Phase 1 launch |
| 7 | Forgot-password channel — email-only, or also support recovery codes? | Product <!-- TODO: confirm owner --> | Phase 2 kickoff |

---

## 9. Success Metrics

How we will know v1 worked. All numbers are read from the sources defined in `docs/tdd.md` §NFR Measurement Strategy unless noted.

**30 days after public launch:**

| Metric | Target | Source |
|---|---|---|
| New customers who reach the embed step | ≥ 70% of signups | Funnel: signups → agents created |
| Time-to-first-agent (median) | ≤ 10 minutes | `test-e2e` Phase 6 timings + manual on every release |
| Customers with at least one live widget impression (step ⑩ of §4) | ≥ 50% of agents created | Widget `WS auth_ok` count grouped by `embedToken` |
| Customers with at least one resolved visitor session (step ⑭) | ≥ 30% of agents with impressions | `widget_sessions` rows with ≥ 2 message exchanges |
| Agent creation success rate | ≥ 95% | Proxy counter logged to Sentry |
| Widget first-response p95 | ≤ 3 s | Proxy log derived |
| Uptime | ≥ 99.5% | External uptime monitor monthly report |
| Unhandled production errors per 1k requests | ≤ 1 | Sentry |
| Visitor G-Eval composite | ≥ 3.5 / 5 | `test-lamoom` G-Eval scoring |

**90 days after public launch:**

| Metric | Target |
|---|---|
| Paid conversion rate from free → any paid tier | ≥ 5% <!-- TODO: confirm with owner --> |
| Net agents retained (created − deleted) month-over-month | Positive |
| Median session count per active agent per week | ≥ 5 |

Failure to hit the 30-day targets is a v1 retro trigger, not a launch reversal. Failure to hit the 90-day targets is a thesis check on §1 (problem statement) and §2 (solution thesis).
