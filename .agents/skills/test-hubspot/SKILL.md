---
name: test-hubspot
description: >
  End-to-end HubSpot integration test for the Lamoom platform.
  Triggers: "test hubspot", "hubspot demo", "hubspot e2e", "run hubspot test".
  Tests the FULL customer journey with REAL browser, REAL HubSpot, REAL widget.
  Produces an evidence GIF proving production quality.
---

# HubSpot Integration Test — Production Quality Gate

## MANDATORY RULES — READ BEFORE DOING ANYTHING

1. **You MUST execute every phase in order.** No phase may be skipped.
2. **No mocks. No fakes. No terminal-rendered screenshots.** Every screenshot must be a real browser screenshot taken with VibeBrowser CLI or Playwright MCP.
3. **Every phase requires EVIDENCE.** A screenshot file saved to disk. If you cannot produce the screenshot, the phase FAILS.
4. **Do not reuse pre-existing agents.** If a HubSpot agent already exists from a prior run, delete it first. The test proves the product creates agents — not that they were manually wired up.
5. **Do not use curl/WebSocket scripts as a substitute for browser interaction.** The test proves the UI works for a real customer clicking through a real browser.
6. **If any BLOCKING phase fails, STOP. Do not continue.** Report the failure and the evidence.
7. **The final deliverable is an animated GIF** assembled from the screenshots. Every frame must be a real browser screenshot — not ImageMagick-generated text.

## Browser Tool

All browser interactions use **VibeBrowser CLI** with remote relay:

```bash
VIBE="npx -y --package @vibebrowser/mcp@latest vibebrowser-cli --remote <RELAY_UUID>"
```

Before starting, verify connection:
```bash
$VIBE --json status
# REQUIRED: extensionConnected: true, relayConnected: true
# If false → STOP. Cannot run test without browser.
```

For Lamoom pages only (not HubSpot/Google), **Playwright MCP** may be used as fallback since those pages don't block headless browsers.

## Test Accounts

- **Google**: `dzianis.somewhere.3@gmail.com` / `56JewZNqsX&D0e`
- **Lamoom**: `demo@lamoom.com` / `demo123`
- **HubSpot**: accessed via Google OAuth (same Google account above)

## Output Directory

All screenshots go to `./e2e-demo-output/` with naming:
```
frame-01-<label>.png
frame-02-<label>.png
...
```

The GIF is assembled from these frames at the end.

---

## Phase 0: Platform Health — BLOCKING

Quick checks before touching the browser.

```bash
curl -sf https://dev.lamoom.com/health            # → {"status":"ok"}
curl -sf https://dev.lamoom.com/health/openclaw    # → {"status":"ok"}
curl -sf https://dev.lamoom.com/widget.js | head -1  # → non-empty JS
```

**EVIDENCE**: Log output of all three commands. All must return 200.
**If any fail → STOP.**

---

## Phase 1: Sign into HubSpot — BLOCKING

Goal: be logged into a real HubSpot account in the browser.

### Steps:
1. Open `https://app.hubspot.com/login` in VibeBrowser
2. Click "Sign in with Google"
3. Complete Google OAuth (email: `dzianis.somewhere.3@gmail.com`, password: `56JewZNqsX&D0e`)
4. Handle any 2FA / consent prompts in the real browser
5. Wait for HubSpot dashboard to load

### EVIDENCE:
- **`frame-01-hubspot-dashboard.png`**: Screenshot showing HubSpot dashboard loaded, account name visible, portal ID visible in URL.
- **Record the Portal ID** from the URL (e.g., `246075043`). You need it for later phases.

**If HubSpot login fails → STOP.**

---

## Phase 2: Get HubSpot API Token — BLOCKING

Goal: obtain a `pat-...` service key with CRM read/write scopes.

### Steps:
1. Navigate to Settings → Integrations → Private Apps (or Service Keys)
   - URL: `https://app.hubspot.com/private-apps/<PORTAL_ID>` or the current equivalent
2. If a "Lamoom Demo Agent" key already exists, copy it. Otherwise create one:
   - Name: `Lamoom Demo Agent`
   - Scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.deals.read`, `crm.objects.deals.write`, `crm.objects.companies.read`, `crm.objects.companies.write`
3. Copy the access token (`pat-...`)

### EVIDENCE:
- **`frame-02-hubspot-api-token.png`**: Screenshot showing the private app / service key page with the token visible (or partially visible) and scopes listed.
- **Log the token** (store as `HUBSPOT_TOKEN` for later phases).

**If token creation fails → STOP.**

---

## Phase 3: Verify HubSpot API Works — BLOCKING

Goal: prove the token works by creating a real contact via API.

### Steps:
1. Create a test contact via curl:
   ```bash
   curl -s -X POST https://api.hubapi.com/crm/v3/objects/contacts \
     -H "Authorization: Bearer $HUBSPOT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"properties":{"email":"lamoom-e2e-test-'$(date +%s)'@example.com","firstname":"E2E","lastname":"TestContact"}}'
   ```
2. Verify response contains `"id"` (numeric contact ID)
3. Open the contact in HubSpot browser: `https://app.hubspot.com/contacts/<PORTAL_ID>`
4. Search for the test contact

### EVIDENCE:
- **`frame-03-hubspot-contact-verified.png`**: Screenshot of HubSpot contacts list showing the test contact exists.
- **Log the Contact ID** from the API response.

5. Clean up — delete the test contact:
   ```bash
   curl -s -X DELETE "https://api.hubapi.com/crm/v3/objects/contacts/$CONTACT_ID" \
     -H "Authorization: Bearer $HUBSPOT_TOKEN"
   ```

**If API call fails → STOP. Token or scopes are broken.**

---

## Phase 4: Login to Lamoom — BLOCKING

Goal: prove the Lamoom platform is accessible and the customer can sign in.

### Steps:
1. Open `https://dev.lamoom.com/login` in the browser
2. Enter `demo@lamoom.com` / `demo123`, click Sign in
3. Wait for redirect to `/dashboard`

### EVIDENCE:
- **`frame-04-lamoom-dashboard.png`**: Screenshot showing the Lamoom dashboard loaded with the agent list visible.

**If login fails → STOP.**

---

## Phase 5: Clean Slate Check

Goal: ensure no HubSpot agent exists from a prior run.

### Steps:
1. On the Lamoom dashboard, check if a HubSpot agent already exists
2. If it does: **delete it** (click Delete button, confirm)
3. Verify the dashboard shows no HubSpot agent

This ensures Phase 6 tests the real agent creation flow.

### EVIDENCE:
- **`frame-05-clean-dashboard.png`**: Screenshot showing dashboard with no HubSpot agent (or after deletion).

---

## Phase 6: Create HubSpot Agent via /create — RELEASE-CRITICAL

Goal: prove a customer can ask the meta-agent to create a HubSpot integration agent.

### Steps:
1. Navigate to `https://dev.lamoom.com/create`
2. Wait for the chat interface to load
3. Type the following message:

   > I want to create an AI agent that manages my HubSpot CRM. It should create contacts, deals, and companies. My HubSpot API base URL is https://api.hubapi.com/crm/v3/objects/ and it uses Bearer token authentication. My token is: <HUBSPOT_TOKEN>. Please create this agent.

4. Press Enter / Send
5. **Wait up to 180 seconds** for the meta-agent response
6. CHECK the response for HubSpot-specific understanding:
   - Mentions CRM objects (contacts, deals, companies)
   - References HubSpot API endpoints or properties
   - NOT a generic "I'll help you" without HubSpot specifics
   - **FAIL if** response lacks 2+ HubSpot-specific details
7. If meta-agent asks for confirmation: type "Yes, create it now." and send
8. Wait for agent creation confirmation (embed code / `[AGENT_CREATED::]` marker)

### EVIDENCE:
- **`frame-06-create-chat.png`**: Screenshot showing the /create page with the user's HubSpot request typed.
- **`frame-07-meta-agent-response.png`**: Screenshot showing the meta-agent's response with HubSpot-specific details.
- **`frame-08-agent-created.png`**: Screenshot showing agent creation confirmation / embed code.

**If meta-agent fails or gives generic response → FAIL.**

---

## Phase 7: Verify Agent in Dashboard

Goal: confirm the newly created agent appears and is active.

### Steps:
1. Navigate to `https://dev.lamoom.com/dashboard`
2. Find the new HubSpot agent in the list
3. Verify it shows "active" status
4. Click "View" to see agent details
5. Verify embed code is present with a `data-agent-token`
6. **Copy the embed token** for Phase 8

### EVIDENCE:
- **`frame-09-agent-in-dashboard.png`**: Screenshot showing the new HubSpot agent listed as active.
- **`frame-10-agent-details.png`**: Screenshot showing agent detail page with embed code visible.

---

## Phase 8: Widget Chat — Real HubSpot Operation — RELEASE-CRITICAL

Goal: prove the widget can execute real HubSpot CRM operations.

### 8a: Test Chat on Agent Detail Page

1. On the agent detail page, click the "Test chat" tab
2. Type: **"Create a new contact: first name Sarah, last name Connor, email sarah.connor@skynet.com"**
3. Send the message
4. **Wait up to 180 seconds** for the agent response
5. CHECK: Response confirms HubSpot contact creation with specific details (contact ID, name, email)

### EVIDENCE:
- **`frame-11-widget-chat-request.png`**: Screenshot showing the chat with the user's request.
- **`frame-12-widget-chat-response.png`**: Screenshot showing the agent's response confirming contact creation.

**If agent gives generic response without HubSpot action → FAIL.**

### 8b: Widget Injected into External Page

1. Open `https://example.com` in the browser
2. Inject the Lamoom widget:
   ```javascript
   const s = document.createElement('script');
   s.src = 'https://dev.lamoom.com/widget.js';
   s.setAttribute('data-agent-token', '<EMBED_TOKEN>');
   document.body.appendChild(s);
   ```
3. Wait for widget bubble to appear
4. Click the widget bubble to open chat
5. Type: **"List all contacts in HubSpot"**
6. Wait for response
7. CHECK: Response lists real contacts from HubSpot (including Sarah Connor from 8a)

### EVIDENCE:
- **`frame-13-widget-on-external-site.png`**: Screenshot showing example.com with the Lamoom widget bubble visible.
- **`frame-14-widget-chat-open.png`**: Screenshot showing the widget chat panel open on example.com.
- **`frame-15-widget-hubspot-response.png`**: Screenshot showing the widget returning real HubSpot data.

---

## Phase 9: Verify in HubSpot UI — THE PROOF

Goal: open HubSpot in the browser and visually confirm the contact created by the widget actually exists.

### Steps:
1. Open `https://app.hubspot.com/contacts/<PORTAL_ID>` in the browser
2. Search for "Sarah Connor" (the contact created in Phase 8a)
3. Click on the contact to see details

### EVIDENCE:
- **`frame-16-hubspot-contact-list.png`**: Screenshot showing HubSpot contacts list with "Sarah Connor" visible.
- **`frame-17-hubspot-contact-detail.png`**: Screenshot showing the contact detail page with email `sarah.connor@skynet.com`.

**This is the money shot.** Real data in real HubSpot, created by a Lamoom widget agent, visible in the HubSpot UI.

---

## Phase 10: Clean Up

1. Delete test contacts created during the test (via HubSpot API or UI)
2. Optionally delete the test agent from Lamoom dashboard

### EVIDENCE:
- **`frame-18-cleanup-done.png`**: Screenshot showing clean state.

---

## Phase 11: Assemble Evidence GIF

Goal: create an animated GIF from all frame screenshots.

### Steps:
1. Verify all `frame-*.png` files exist in `./e2e-demo-output/`
2. Assemble using ImageMagick:
   ```bash
   convert -delay 300 -loop 0 \
     ./e2e-demo-output/frame-*.png \
     -resize 960x \
     ./e2e-demo-output/hubspot-e2e-demo.gif
   ```
   (300 = 3 seconds per frame)
3. Verify the GIF file size is reasonable (should be 1-5MB with 15+ real browser frames)

### EVIDENCE:
- **`hubspot-e2e-demo.gif`**: The final animated GIF.
- **List all frames** included in the GIF with their labels.

---

## Reporting

After all phases, produce this report:

```
## HubSpot E2E Test Results — [DATE]

| Phase | Status | Evidence |
|-------|--------|----------|
| 0. Platform Health | PASS/FAIL | curl output |
| 1. HubSpot Login | PASS/FAIL | frame-01 |
| 2. API Token | PASS/FAIL | frame-02 |
| 3. API Verification | PASS/FAIL | frame-03 |
| 4. Lamoom Login | PASS/FAIL | frame-04 |
| 5. Clean Slate | PASS/FAIL | frame-05 |
| 6. Agent Creation via /create | PASS/FAIL | frame-06,07,08 |
| 7. Agent in Dashboard | PASS/FAIL | frame-09,10 |
| 8. Widget Chat + External Embed | PASS/FAIL | frame-11,12,13,14,15 |
| 9. HubSpot UI Verification | PASS/FAIL | frame-16,17 |
| 10. Clean Up | PASS/FAIL | frame-18 |
| 11. GIF Assembled | PASS/FAIL | hubspot-e2e-demo.gif |

GIF: ./e2e-demo-output/hubspot-e2e-demo.gif
Frames: [count] real browser screenshots

VERDICT: READY / NOT READY
```

## Verdict Rules

| Condition | Verdict |
|-----------|---------|
| All phases PASS | **READY** |
| Any BLOCKING fail (0-4) | **NOT READY** — infrastructure/auth broken |
| Any RELEASE-CRITICAL fail (6, 8) | **NOT READY** — product doesn't work |
| Phase 9 fail (HubSpot UI) | **NOT READY** — no proof agent works |
| Only Phase 5/10 fail | **READY WITH CAVEATS** |
| GIF has < 10 real browser frames | **NOT READY** — insufficient evidence |
| Any frame is not a real browser screenshot | **NOT READY** — evidence is faked |
