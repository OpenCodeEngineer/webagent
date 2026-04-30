---
name: openclaw-console-agent-bootstrap
description: Bootstrap an OpenClaw Console navigation/help agent by extracting /api/v1 surface from bundles, generating a customer agent profile, and running deterministic navigation evals.
user-invocable: true
---

# openclaw-console-agent-bootstrap

Use this skill when asked to bootstrap, validate, or refresh an OpenClaw Console navigation/help agent.

## Triggers
- "bootstrap console agent"
- "extract console api"
- "generate console customer profile"
- "eval console navigation"

## Workflow
1. Parse deployed console bundles for API surface:
   - `scripts/extract-console-api.sh`
2. Generate customer-facing navigation/help persona using reusable templates in:
   - `openclaw/workspaces/meta/templates/AGENTS-openclaw-console-navigation.md`
   - `openclaw/workspaces/meta/templates/knowledgebase/openclaw-console-navigation.md`
   - `openclaw/workspaces/meta/templates/skills/openclaw-console-navigation/SKILL.md`
3. Run deterministic eval with pass/fail gate:
   - `scripts/eval-console-navigation.sh`

## Acceptance
- API endpoints extracted and deduplicated.
- Customer profile includes canonical console links + command-centric guidance.
- Eval prompts pass rubric thresholds, or script exits non-zero.

## Create-Agent Prompt

When creating a new agent for openclaw.vibebrowser.app/console via the Lamoom create page,
use this prompt (do NOT use the generic short description — the meta-agent needs full API context
to produce an API-capable agent instead of a knowledge-base-only one):

---

I want to create an AI chat agent for openclaw.vibebrowser.app/console — the OpenClaw Console
for managing AI assistant instances (tenants) with authentication, tenant management, billing,
and specialist packs.

**API is available. Here are the full details:**

Base URLs (try in order):
1. https://admin.openclaw.vibebrowser.app
2. https://console.openclaw.vibebrowser.app

Auth: Bearer JWT. Login via POST /api/v1/auth/login with one of:
- Telegram: {provider: "telegram", telegram: {<telegram widget data>}}
- Google: {provider: "google", idToken: "..."}
- Email/password: {provider: "email_password", email, password}

Refresh token: POST /api/v1/auth/refresh {refreshToken}
Current user: GET /api/v1/auth/me → {user: {id, username, displayName, email}, subscription: {planId, planTitle, expiresAt}}

Plans: GET /api/v1/plans → [{id, title, description, usdPrice, stars, hostedModels}]

Tenants (instances):
- List: GET /api/v1/tenants → [{id, subdomain, status, tenantType, planTitle, createdAt, url}]
- Get: GET /api/v1/tenants/:id
- Create: POST /api/v1/tenants {planId, tenantType: "personal"|"team", hostType: "container"|"vps", promoCode?, specialistPresets?}
  Returns {action: "created"} or {action: "payment_required", checkout: {telegramBotUrl?, stripeHint?, cryptoHint?}}
- Delete: DELETE /api/v1/tenants/:id
- Restart: POST /api/v1/tenants/:id/restart
- Logs: GET /api/v1/tenants/:id/logs?tail=100

Specialists:
- List available: GET /api/v1/tenants/specialists → {specialists: [{id, label, description}]}
- Install: POST /api/v1/tenants/:id/specialists/install {specialistPresets: ["id1", "id2"]}

Billing:
- Overview: GET /api/v1/billing → {subscription, budget: {total, spent, remaining}, creditPacks, payments}
- Top up (Stripe): POST /api/v1/billing/topup {packId} → {checkoutUrl}
- Top up (crypto): POST /api/v1/billing/topup/crypto {packId} → {checkoutUrl}

Tenant statuses: provisioning, running, suspended, deleting, deleted

Key user flows:
1. Sign in → GET /api/v1/auth/me to load dashboard
2. Create instance → GET /api/v1/plans → POST /api/v1/tenants
3. Manage → list tenants → restart or delete
4. Add specialists → GET specialists → POST install
5. Top up credits → GET billing → POST topup

Canonical links:
- Console: https://openclaw.vibebrowser.app/console/
- Billing: https://openclaw.vibebrowser.app/console/billing
- Pricing: https://openclaw.vibebrowser.app/pricing
- Docs: https://openclaw.vibebrowser.app/docs
- Telegram bot: https://t.me/OpenClawBoxBot

---

## Eval Scripts

- **`scripts/eval-console-navigation.sh`** — Tests navigation/help quality: sends general console questions and scores responses against a rubric (navigation verbs, links, coverage).
- **`scripts/eval-api-actions.sh`** — Tests API spec injection: sends API-specific questions (e.g., "How do I list tenants?") and asserts responses contain the correct HTTP methods and endpoint paths. Run with `--dry-run` for offline validation or set `AUTH` for live testing. Expects 8/8 pass for a correctly bootstrapped agent.
