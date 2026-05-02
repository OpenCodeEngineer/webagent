---
name: test-hubspot
description: >
  End-to-end HubSpot integration test for the Lamoom platform. Triggers on
  "test hubspot", "hubspot demo", "hubspot e2e", "run hubspot test".
  Uses vibebrowser-cli with remote relay to drive a real browser session.
  Tests the full customer journey: sign up for HubSpot, get API token,
  create a HubSpot agent on dev.lamoom.com via /create, then verify the
  widget can actually talk to HubSpot and perform real CRM operations.
---

# HubSpot Integration Test — Real E2E via VibeBrowser CLI

Prove that a Lamoom customer can create a HubSpot agent and use it to perform real CRM operations. Every step uses real accounts, real APIs, real data. No mocks.

## Browser Tool

All browser interactions use VibeBrowser CLI with the remote relay:

```bash
VIBE="npx -y --package @vibebrowser/mcp@latest vibebrowser-cli --remote f6148397-8dca-4737-902f-089f2744fc9b"
```

Before starting, verify the connection:
```bash
$VIBE --json status
# CHECK: extensionConnected: true, relayConnected: true
```

Key commands:
```bash
$VIBE open <url>              # Navigate (opens new tab)
$VIBE navigate <url>          # Navigate current tab
$VIBE snapshot                # Accessibility tree with A-refs
$VIBE screenshot              # Visual screenshot
$VIBE click <A-ref>           # Click element by ref
$VIBE type <A-ref> "text"     # Type into element
$VIBE press Enter             # Press key
$VIBE evaluate "js code"      # Run JS in page
$VIBE --page-id <id> snapshot # Target specific tab
```

## Test Account

- Google: `dzianis.somewhere.3@gmail.com` / `56JewZNqsX&D0e`
- Lamoom: `demo@lamoom.com` / `demo123`

---

## Phase 0: Platform Health — BLOCKING

Quick curl checks before touching the browser.

```bash
curl -sk https://dev.lamoom.com/health            # → 200 {"status":"ok"}
curl -sk https://dev.lamoom.com/health/openclaw    # → 200 {"status":"ok"}
curl -sk https://dev.lamoom.com/widget.js | head -1  # → non-empty JS
```

**If any fail → STOP.**

---

## Phase 1: HubSpot Account & API Token — BLOCKING

Goal: get a real HubSpot private app access token (`pat-...`).

### 1a: Sign into Google

1. `$VIBE open "https://accounts.google.com"`
2. `$VIBE snapshot` — find email input
3. Type `dzianis.somewhere.3@gmail.com`, press Enter
4. Wait for password page, type `56JewZNqsX&D0e`, press Enter
5. Handle any 2FA / "confirm it's you" prompts in the real browser
6. `$VIBE screenshot` — **CHECK**: logged into Google

### 1b: Sign into HubSpot

1. `$VIBE open "https://app.hubspot.com/login"`
2. `$VIBE snapshot` — find "Sign in with Google" button
3. Click it — Google OAuth flow should auto-complete since we're logged in
4. If no account exists yet: `$VIBE open "https://app.hubspot.com/signup-hubspot/crm"` and complete signup
5. `$VIBE screenshot` — **CHECK**: HubSpot dashboard loads

### 1c: Create Private App & Get Token

1. Navigate to Settings → Integrations → Private Apps:
   - `$VIBE open "https://app.hubspot.com/private-apps/<PORTAL_ID>"` (get portal ID from URL after login)
2. `$VIBE snapshot` — click "Create a private app"
3. Fill in:
   - Name: `Lamoom Demo Agent`
   - Description: `AI agent for CRM automation`
4. Switch to "Scopes" tab, enable these scopes:
   - `crm.objects.contacts.read`, `crm.objects.contacts.write`
   - `crm.objects.deals.read`, `crm.objects.deals.write`
   - `crm.objects.companies.read`, `crm.objects.companies.write`
5. Click "Create app" → "Continue creating"
6. **Copy the access token** (starts with `pat-`)
7. `$VIBE screenshot` — **CHECK**: token visible
8. Store token: `export HUBSPOT_TOKEN="pat-..."`

**If token creation fails → STOP. No point testing further.**

---

## Phase 2: Verify HubSpot API Works — BLOCKING

Test the 3 core CRM operations with real data.

### 2a: Create Contact (real)
```bash
RESULT=$(curl -s -X POST https://api.hubapi.com/crm/v3/objects/contacts \
  -H "Authorization: Bearer $HUBSPOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"properties":{"email":"lamoom-test-'$(date +%s)'@example.com","firstname":"Lamoom","lastname":"TestUser","phone":"+1555000'$(shuf -i 1000-9999 -n1)'"}}')
echo "$RESULT"
CONTACT_ID=$(echo "$RESULT" | jq -r '.id')
```
**CHECK**: HTTP 201, `CONTACT_ID` is numeric.

### 2b: Create Deal (real)
```bash
RESULT=$(curl -s -X POST https://api.hubapi.com/crm/v3/objects/deals \
  -H "Authorization: Bearer $HUBSPOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"properties":{"dealname":"Lamoom Test Deal '$(date +%s)'","amount":"25000","dealstage":"appointmentscheduled","pipeline":"default"}}')
echo "$RESULT"
DEAL_ID=$(echo "$RESULT" | jq -r '.id')
```
**CHECK**: HTTP 201, `DEAL_ID` is numeric.

### 2c: Create Company (real)
```bash
RESULT=$(curl -s -X POST https://api.hubapi.com/crm/v3/objects/companies \
  -H "Authorization: Bearer $HUBSPOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"properties":{"name":"Lamoom Test Corp '$(date +%s)'","domain":"lamoom-test-'$(date +%s)'.com","industry":"TECHNOLOGY"}}')
echo "$RESULT"
COMPANY_ID=$(echo "$RESULT" | jq -r '.id')
```
**CHECK**: HTTP 201, `COMPANY_ID` is numeric.

### 2d: Verify in HubSpot UI (real browser)
1. `$VIBE open "https://app.hubspot.com/contacts/<PORTAL_ID>/objects/0-1/views/all/list"`
2. `$VIBE snapshot` — **CHECK**: "Lamoom TestUser" contact visible in list
3. `$VIBE screenshot`

### 2e: Clean up test data
```bash
curl -s -X DELETE "https://api.hubapi.com/crm/v3/objects/contacts/$CONTACT_ID" -H "Authorization: Bearer $HUBSPOT_TOKEN"
curl -s -X DELETE "https://api.hubapi.com/crm/v3/objects/deals/$DEAL_ID" -H "Authorization: Bearer $HUBSPOT_TOKEN"
curl -s -X DELETE "https://api.hubapi.com/crm/v3/objects/companies/$COMPANY_ID" -H "Authorization: Bearer $HUBSPOT_TOKEN"
```

**If any create call fails → STOP. Token or scopes broken.**

---

## Phase 3: Login to Lamoom — RELEASE-CRITICAL

1. `$VIBE open "https://dev.lamoom.com/login"`
2. `$VIBE snapshot` — find credentials form
3. Type `demo@lamoom.com` in email, `demo123` in password, submit
4. `$VIBE screenshot` — **CHECK**: redirected to `/dashboard`, dark theme, agent list visible

---

## Phase 4: Create HubSpot Agent via /create — RELEASE-CRITICAL

This is the core product test. A real user goes to /create and asks for a HubSpot agent.

1. `$VIBE open "https://dev.lamoom.com/create"`
2. `$VIBE snapshot` — **CHECK**: native chat loaded, input field visible, dark theme
3. `$VIBE screenshot`
4. Find the chat input and type:

   > I want to create an AI agent that helps users manage their HubSpot CRM. The agent should be able to: 1) Create new contacts with name, email, and phone, 2) Create new deals with name, amount, and stage, 3) Create new companies with name, domain, and industry. The HubSpot API base is https://api.hubapi.com/crm/v3/objects/ and uses Bearer token auth. Please create this agent.

5. Press Enter
6. **Wait** up to 180s for meta-agent response
7. **CHECK — CRITICAL**: Response demonstrates HubSpot understanding:
   - Mentions CRM objects (contacts, deals, companies)
   - References HubSpot API endpoints or properties
   - NOT generic "I'll help you" without HubSpot specifics
   - **FAIL rule**: If response lacks ≥2 HubSpot-specific details → Phase 4 = FAIL
8. **CHECK**: No `unknown-agent`, `agent not found`, or WebSocket errors
9. `$VIBE screenshot` — capture the conversation
10. If meta-agent asks for confirmation: type "Yes, create it now." and press Enter
11. **Wait** up to 180s for agent creation
12. **CHECK**: Response contains embed code (`<script>` tag) or confirmation of agent creation
13. `$VIBE screenshot`

---

## Phase 5: Verify Agent Exists in Dashboard

1. `$VIBE open "https://dev.lamoom.com/dashboard"`
2. `$VIBE snapshot` — **CHECK**: new HubSpot agent in list, shows "active"
3. Click "View" on the HubSpot agent
4. `$VIBE snapshot` — **CHECK**: embed code section visible with `<script>` tag
5. **Copy the embed token** from the embed code for Phase 6
6. `$VIBE screenshot`

---

## Phase 6: Widget Chat — Real HubSpot Conversation — RELEASE-CRITICAL

### 6a: Widget Preview on Agent Detail Page

1. On the agent detail page, find the widget preview / test chat
2. `$VIBE snapshot` — **CHECK**: chat widget visible, connected
3. Type: **"What can you help me with?"**
4. Wait up to 120s
5. **CHECK**: Response mentions HubSpot, contacts, deals, or companies
6. **CHECK**: No error messages
7. `$VIBE screenshot`

### 6b: Ask to Create a Real Contact

1. Type: **"Create a new contact: first name Sarah, last name Connor, email sarah@skynet.com, phone +1-555-0199"**
2. Wait up to 120s
3. **CHECK**: Response acknowledges HubSpot contact creation with the specific details
4. `$VIBE screenshot`

### 6c: Widget on External Page (inject embed)

1. `$VIBE open "https://example.com"`
2. Inject the widget embed script:
   ```bash
   $VIBE evaluate "const s=document.createElement('script');s.src='https://dev.lamoom.com/widget.js';s.setAttribute('data-agent-token','<TOKEN>');s.setAttribute('data-user-id','hubspot-test-user');document.body.appendChild(s);"
   ```
3. Wait 5s, `$VIBE snapshot` — **CHECK**: widget bubble appears
4. Click the widget bubble
5. `$VIBE snapshot` — **CHECK**: chat panel opens
6. Type: **"Create a deal called Enterprise Pilot worth $50,000"**
7. Wait up to 120s
8. **CHECK**: Response references HubSpot deal creation with specifics
9. Score responses (G-Eval 1-5):
   - **Score ≥ 3 required** for each. Score < 3 if generic, no HubSpot mention, or hallucinated.
10. `$VIBE screenshot`

---

## Phase 7: Verify in HubSpot UI — THE PROOF

If the agent claims it created real HubSpot objects, verify them:

1. `$VIBE open "https://app.hubspot.com/contacts/<PORTAL_ID>"` (use the same tab or new one)
2. `$VIBE snapshot` — search for contacts/deals created by the agent
3. **CHECK**: If agent said it created "Sarah Connor" contact → it should exist in HubSpot
4. **CHECK**: If agent said it created "Enterprise Pilot" deal → it should exist in HubSpot
5. `$VIBE screenshot` — **THIS IS THE MONEY SHOT**: real data in real HubSpot created by Lamoom agent

**Note**: If the agent cannot actually call HubSpot API (no token configured in agent workspace), it may only describe how to do it. That's still valuable for the demo but note whether it performed the action or described it.

---

## Phase 8: Clean Up

1. Delete test contacts/deals/companies created during testing (via HubSpot UI or API)
2. Optionally delete the test agent from Lamoom dashboard
3. `$VIBE screenshot` — clean state

---

## Reporting

```
## HubSpot Integration Test Results — [DATE]

| Phase | Status | Notes |
|-------|--------|-------|
| 0. Platform Health | ✅/❌ | health, openclaw, widget.js — **BLOCKING** |
| 1. HubSpot Account & Token | ✅/❌ | Google login, HubSpot OAuth, private app — **BLOCKING** |
| 2. HubSpot API Verification | ✅/❌ | create contact/deal/company via curl — **BLOCKING** |
| 3. Lamoom Login | ✅/❌ | dashboard loads, dark theme — **RELEASE-CRITICAL** |
| 4. Agent Creation via /create | ✅/❌ | meta-agent creates HubSpot agent — **RELEASE-CRITICAL** |
| 5. Agent in Dashboard | ✅/❌ | agent listed, active, embed code |
| 6. Widget Chat | ✅/❌ | HubSpot-aware responses, G-Eval ≥ 3 — **RELEASE-CRITICAL** |
| 7. HubSpot UI Verification | ✅/❌ | real CRM data created by agent visible in HubSpot |
| 8. Clean Up | ✅/❌ | test data removed |

Blockers:
- [list any blocking issues]

**VERDICT: READY** / **VERDICT: NOT READY** — [reasons]
```

## Verdict Rules

| Condition | Verdict |
|-----------|---------|
| All phases PASS | **READY** |
| Any BLOCKING fail (0, 1, 2) | **NOT READY** |
| Any RELEASE-CRITICAL fail (3, 4, 6) | **NOT READY** |
| Only Phase 5/7/8 fail | **READY WITH CAVEATS** |
| G-Eval < 3 on widget responses | **NOT READY** |
| Agent can't demonstrate HubSpot knowledge | **NOT READY** |
