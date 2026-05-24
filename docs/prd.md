# Lamoom — Product Requirements Document

> Last updated: 2026-05-23

---

## 1. Product Overview

**Lamoom** is a SaaS platform that lets business owners deploy AI chat agents on their websites through a conversational interface — no code, no prompt engineering, no ML expertise required.

A business owner visits `dev.lamoom.com`, describes their website URL to a meta-agent, confirms the agent, and receives a single `<script>` tag to paste before `</body>`. Within minutes, visitors on their site can get instant, contextual, streaming AI support.

### Core Value Proposition

| Without Lamoom | With Lamoom |
|---|---|
| Hire a support team | 24/7 AI agent for ~$0/mo operational cost |
| Spend weeks on prompts | Agent auto-discovers your site in seconds |
| Integrate OpenAI APIs yourself | One `<script>` tag, no backend required |
| Generic chatbot responses | Agent trained on your actual content and APIs |

---

## 2. Market & Customers

### Target Market

SMBs, indie developers, and technical product teams who need AI-powered chat on their sites but can't afford enterprise AI chat contracts (Intercom, Drift, Salesforce Einstein) or don't have bandwidth for custom GPT integration.

### Competitive Landscape

| Competitor | Where We Win |
|---|---|
| Intercom / Drift | 10x cheaper, AI-native from day 1, no live-agent dependency |
| Tidio / Crisp | True AI (OpenClaw-powered), not just rule-based flows |
| ChatGPT plugins | We crawl the site automatically; no manual prompt writing |
| Custom OpenAI | Zero dev time; meta-agent does discovery + provisioning |

### Primary Persona — "The Product Owner"

- Runs a SaaS product, e-commerce store, or professional service firm
- Moderately technical: can paste a `<script>` tag but won't write a WebSocket client
- Needs: live chat coverage without hiring, instant responses to common questions
- Pain point: support tickets that could be answered by reading the docs page
- Budget: free tier or < $50/mo; cancels if ROI isn't immediate

### Secondary Persona — "The Developer"

- Building B2B2C products and needs to embed AI agents per tenant
- Wants: programmatic agent creation, API keys, SLAs, reliable WebSocket protocol
- Pain point: managing model prompts per customer at scale
- Will pay per-agent or per-seat at mid-market rates

### Tertiary Persona — "The Enterprise Admin" (future)

- Large company, needs governance, cost tracking, audit logs
- Will use Paperclip integration for agent lifecycle management
- Requires SSO, SLA, dedicated support

---

## 3. User Journeys

### Journey 1 — Onboarding: Create First Agent

**Persona:** Product Owner  
**Entry:** Google search, referral link, or direct navigation  
**Goal:** Widget live on their website in < 10 minutes

```
Visit dev.lamoom.com
  │
  ▼
Sign up (Google OAuth / GitHub / email+password)
  │
  ▼
Dashboard — no agents yet, CTA to "Create Agent"
  │
  ▼
/create page — meta-agent chat opens
  │
  ▼
User types: "Create an agent for <their-website-url>"
  │
  ▼
Meta-agent crawls site → presents discovery summary
  │  "Here's what I found: your product is X, key use cases are Y..."
  │  "Should I create your agent now?"
  ▼
User confirms: "Yes, create it"
  │
  ▼
Agent provisioned (AGENTS.md, SOUL.md, skills, knowledgebase written)
  │
  ▼
Embed code shown inline: <script src="..." data-agent-token="..." async></script>
  │
  ▼
User copies code → pastes into their website → widget appears
```

**Success criteria:** Embed code in clipboard within 10 minutes of first visit.

---

### Journey 2 — Return Visit: Manage Agents

**Persona:** Product Owner  
**Entry:** Dashboard  
**Goal:** Check agent status, copy embed code, preview widget

```
Log in → Dashboard
  │
  ├─ See agent list (name, website, status: active / paused / deleted)
  ├─ Click agent → detail page
  │    ├─ Live widget preview (iframe with real widget.js)
  │    ├─ Embed code with copy button
  │    ├─ Visitor stats (message count, session count)
  │    └─ Re-open meta-agent to update agent behavior
  └─ Pause or delete an agent
```

---

### Journey 3 — Website Visitor Chat

**Persona:** End-user of the business's website (not a Lamoom customer)  
**Entry:** Widget appears in bottom-right corner of business's site  
**Goal:** Get a question answered without leaving the page

```
Visitor opens page with widget injected
  │
  ▼
Widget loads (bottom-right, minimized)
  │
  ▼
Visitor clicks → chat opens
  │
  ▼
Visitor types question
  │
  ▼
Agent responds (streaming, Markdown rendered)
  │
  ▼
Multi-turn conversation continues in context
```

**Success criteria:** First response in < 3 seconds; answer directly addresses the question.

---

### Journey 4 — HubSpot CRM Integration (Advanced)

**Persona:** Developer / Sales team  
**Goal:** Agent can look up and create CRM records through widget chat

```
Customer creates HubSpot agent (providing API token in meta-agent chat)
  │
  ▼
Widget injected in HubSpot context page
  │
  ▼
Visitor: "Find the contact John Smith"
  │
  ▼
Agent calls HubSpot API → returns results conversationally
```

---

## 4. Feature Requirements

### Phase 0 — MVP (✅ Done)

| Feature | Status |
|---|---|
| Account creation (Google / GitHub / email+password) | ✅ Done |
| Meta-agent chat on `/create` | ✅ Done |
| AI agent creation from website URL | ✅ Done |
| Website crawl + due-diligence summary | ✅ Done |
| Embed `<script>` tag generation | ✅ Done |
| Dashboard: agent list + detail | ✅ Done |
| Live widget preview on detail page (real `widget.js` in iframe) | ✅ Done |
| Widget WebSocket chat with streaming | ✅ Done |
| Markdown rendering (widget + admin chat) | ✅ Done |
| Meta-agent conversation persistence across page refresh | ✅ Done |
| Invite-gated signup | ✅ Done |
| HMAC-signed customer API auth | ✅ Done |
| Rate limiting on WS + REST | ✅ Done |

### Phase 1 — Launch-Critical (🔴 Blocking)

| Feature | Priority | Notes |
|---|---|---|
| Agent editing (name, URL, instructions) without full recreation | MUST | Currently requires re-creating from scratch |
| Pause / delete agent | MUST | Dashboard delete/pause should be wired end-to-end |
| Error tracking (Sentry or similar) | MUST | No visibility into production errors |
| CI/CD pipeline | MUST | Deploy is fully manual today |
| Uptime monitoring | MUST | No alerting if site goes down |
| Settings page (`/dashboard/settings`) | MUST | Currently a "coming soon" stub. Acceptance: Account (email/name), Security (change password), Embed API (token mask/copy/rotate), Danger Zone (delete account). Detail in tdd.md §Phase 1 Specs → Settings Page |
| Migrate password from `access_token` to `password_hash` column | MUST | Bcrypt hash currently in OAuth `access_token` slot; ship via Settings page password-change flow (tdd.md §Phase 1 Specs → Settings Page) |

### Phase 2 — Post-Launch (🟠 High)

| Feature | Notes |
|---|---|
| Agent registration race condition fix | Concurrent creates for same slug can conflict |
| Admin auth tables Drizzle migration | Currently rely on adapter auto-creation |
| Forgot password / reset flow | Currently no recovery path |
| Visitor analytics (message count, session count) | Dashboard shows no usage data |
| Configurable `localhost:3001` in admin config | Hardcoded for dev, must use env var in prod |
| Widget auto-reconnect on disconnect | Preview has no reconnect logic |

### Phase 3 — Future (🟢 Nice to Have)

| Feature | Notes |
|---|---|
| Pricing tiers and metered billing | Stripe integration needed |
| Multiple agents per account | Current quota not enforced |
| HubSpot / CRM integrations (GA) | Working in E2E tests; not yet GA |
| Voice I/O (STT/TTS) | LibreChat integration path documented |
| Analytics dashboard | Visitor heatmaps, top questions, drop-off |
| Light/dark theme toggle | Dark hardcoded |
| SSO / SAML | Enterprise requirement |
| Paperclip governance integration | Multi-phase plan in docs/design.paperclip.md (agent registration → governance → policy enforcement). First slice (Phase 2: agent registration via Paperclip) is the entry point — see PRD §7 Open Questions #5 for ship-date decision |

---

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Time-to-first-agent | < 10 minutes from signup |
| Widget first response time | < 3 seconds (p95) |
| Agent creation success rate | ≥ 95% |
| Visitor satisfaction (G-Eval) | ≥ 3.5/5 average |
| Uptime | ≥ 99.5% monthly |
| Widget load size | < 50 KiB / 51200 bytes (current IIFE bundle) |
| WS auth latency | < 500 ms (ws-ticket round trip) |

Measurement strategy + ownership for each NFR is captured in tdd.md §NFR Measurement Strategy.

---

## 6. Out of Scope (v1)

- Mobile SDK (iOS / Android native widget)
- White-label / reseller program
- On-premise deployment
- Multi-language UI (admin is English only)
- Compliance certifications (SOC2, HIPAA)

---

## 7. Open Questions

| # | Question | Owner | Decision needed by |
|---|---|---|---|
| 1 | Pricing model — per-agent flat / per-message metered / freemium with cap | Product | Pre-launch |
| 2 | Invite gate — when do we open public signup? | Product | Post-launch + 30d data |
| 3 | Multi-tenancy — workspace-per-customer vs packed gateway | Eng | Before 100-agent scale |
| 4 | Custom domains for widget — serve `widget.js` from customer CDN? | Eng | Phase 3 |
| 5 | Paperclip integration — when does Phase 2 (registration) ship? | Eng | After Phase 1 launch |
