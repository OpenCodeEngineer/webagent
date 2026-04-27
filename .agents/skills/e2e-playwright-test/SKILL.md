---
name: e2e-test
description: >
  Browser-based E2E QA for the OpenClaw platform. Triggers on "run tests",
  "run e2e", "test the system", "test end to end", "verify the flow", "smoke test",
  "does it work", "qa check", "test ui", "check the ui".
  Uses vibebrowser/playwright MCP tools to test the real product in a real browser.
  Verifies UI/UX quality, full agent creation flow, and widget chat.
---

# E2E QA Test Skill — Browser-Based

Test the Lamoom platform end-to-end using browser tools. NOT scripts — use vibebrowser or playwright MCP to interact with the real UI.

## When to Run

- After ANY deployment to the VM
- After UI/UX changes
- After changes to proxy, OpenClaw client, meta-agent config, or widget
- When asked to "test", "verify", "qa", or "check if it works"
- As a gate before marking work complete

## Test Protocol

Run these checks IN ORDER using vibebrowser tools. Take a screenshot after each phase. Report PASS/FAIL for each check.

**Protocol of record:** This QA skill is browser-tool driven. Do **not** rely on `test-e2e-full.sh` (or other shell scripts) as the primary end-to-end verdict.

### Phase 0: Infrastructure (curl, not browser)
```
curl -sk https://dev.lamoom.com/health → 200 {"status":"ok"}
curl -sk https://dev.lamoom.com/health/openclaw → 200 {"status":"ok"}  
curl -sk https://dev.lamoom.com/widget.js → 200, non-empty JS
curl -sk https://dev.lamoom.com/v1/models → 200 {"data":[...]} (OpenAI-compat endpoint)
ssh root@78.47.152.177 "docker ps --format '{{.Names}} {{.Status}}' | grep libre" → lamoom-librechat Up
```

### Phase 0b: Static Assets — BLOCKING (curl, not browser)
Next.js standalone mode does NOT auto-include `_next/static/`. If this fails, ALL pages render as unstyled black & white.

1. Fetch the login page HTML and extract CSS paths:
   ```
   CSS_PATH=$(curl -sk https://dev.lamoom.com/login | grep -oE '_next/static/css/[^"]+' | head -1)
   ```
2. **CHECK**: `CSS_PATH` is non-empty (CSS link exists in HTML)
3. Fetch the CSS file:
   ```
   curl -sk -o /dev/null -w "%{http_code} size:%{size_download}" "https://dev.lamoom.com/$CSS_PATH"
   ```
4. **CHECK**: HTTP 200 AND size > 1000 bytes (real CSS, not error page)
5. Extract and check a JS chunk too:
   ```
   JS_PATH=$(curl -sk https://dev.lamoom.com/login | grep -oE '_next/static/chunks/[^"]+' | head -1)
   curl -sk -o /dev/null -w "%{http_code}" "https://dev.lamoom.com/$JS_PATH"
   ```
6. **CHECK**: HTTP 200

**If any of these fail → STOP. Do not continue to Phase 1. Report BLOCKING failure.**
The fix is: `cp -r packages/admin/.next/static packages/admin/.next/standalone/packages/admin/.next/static` on the VM, then restart webagent-admin.

### Phase 0c: OAuth Provider Endpoint (curl, not browser)

Verify NextAuth providers are correctly configured and the DrizzleAdapter connects to the right tables.

1. Fetch the providers endpoint:
   ```
   curl -sk https://dev.lamoom.com/api/auth/providers
   ```
2. **CHECK**: Response is valid JSON (not HTML error page)
3. **CHECK**: `google` provider exists with `callbackUrl` containing `/api/auth/callback/google`
4. **CHECK**: `credentials` provider exists

**If providers endpoint returns an error or is missing `google` → STOP. Report BLOCKING failure.**
Common cause: DrizzleAdapter table name mismatch (adapter expects singular `account`/`user`, DB has plural `accounts`/`users`). Fix: pass custom table schemas to `DrizzleAdapter()` in `packages/admin/src/lib/auth.ts`.

### Phase 1: Login & Dashboard

1. **Navigate** to `https://dev.lamoom.com`
2. **CHECK**: Redirects to `/login` or `/dashboard` (if already logged in)
3. If on `/login`:
   - **CHECK UI**: Dark theme, centered card, Google OAuth button visible
   - Click Google sign-in or use test credentials
   - **CHECK**: Redirects to `/dashboard` after login
4. On `/dashboard`:
   - **CHECK UI**: Dark background, no white/light areas
   - **CHECK**: "Create New Agent" button visible
   - **CHECK**: Agent list visible (may be empty or have existing agents)
   - **SCREENSHOT**: Take screenshot, verify professional dark theme

### Phase 2: Create Agent Chat — Native Chat Integration

1. **Navigate** to `https://dev.lamoom.com/create`
2. **CHECK**: Page loads with dark background (#171717), header bar shows "Create Agent"
3. **CHECK**: SSO loading indicator appears briefly ("·" bouncing dots)
4. **CHECK**: LibreChat iframe loads successfully (no "Unable to open AI Chat" error)
5. **CHECK**: LibreChat interface visible inside iframe:
   - ✅ Dark theme matching the overall app
   - ✅ Chat input field visible at the bottom
   - ✅ Agent builder header or endpoint label visible
   - ❌ FAIL if: legacy external login/register page is shown (SSO/session bridge failed)
   - ❌ FAIL if: White/light background (theme mismatch)
   - ❌ FAIL if: "Unable to open AI Chat" error (SSO endpoint failed)
6. **SCREENSHOT**: Full page with LibreChat loaded in iframe
7. **Bonus**: Toggle "Legacy chat" button visible — clicking it switches to the old custom chat UI

### Phase 3: Agent Creation Conversation (via native chat)

1. **Click** into the LibreChat message input inside the iframe
2. **Type** a real website description:
   > "I want to create an AI chat agent for openclaw.vibebrowser.app/console — it's the OpenClaw Console for managing AI agents with tenant management, agent creation, and admin features."
3. **Press Enter** to send
4. **CHECK**: Message appears in LibreChat conversation (markdown rendered)
5. **Wait** for meta-agent response (up to 180s) — native chat shows streaming indicator
6. **CHECK — CRITICAL (Website Discovery)**: The response MUST prove the meta-agent fetched openclaw.vibebrowser.app/console:
   - Mentions specific details about the product (console, tenant management, admin, agent creation)
   - NOT just generic "I'll help you create an agent" without site-specific info
   - This is the core product promise — if the agent doesn't proactively discover, it FAILS
7. **CHECK — Markdown**: Response renders with proper markdown formatting (headings, bold, lists, code blocks)
8. **SCREENSHOT**: Chat with both messages visible

9. If the meta-agent asks for confirmation, **type**: "Yes, that's correct. Please create the agent now."
10. **Press Enter**, wait up to 180s (agent creation involves file writes)
11. **CHECK**: Look for embed code in the response (may contain code blocks with `<script>` tag)
12. **SCREENSHOT**: After agent creation response

### Phase 3b: Test Internal API (Create/Delete Tenant)

The meta-agent should be able to call OpenClaw Console internal APIs. Verify:

1. **Check** the agent's response for API calls or mentions of:
   - Tenant creation (POST /api/tenants)
   - Tenant deletion (DELETE /api/tenants/:id)
2. **If** the agent mentions it created a tenant via API:
   - Navigate to `https://openclaw.vibebrowser.app/console/admin/tenants`
   - **CHECK**: New tenant appears in the list
3. **If** the agent mentions it deleted a tenant:
   - **CHECK**: Tenant no longer appears in list
4. **SCREENSHOT**: Admin panel showing tenant state after agent operations

### Phase 4: Verify Created Agent

1. **Navigate** to `https://dev.lamoom.com/dashboard`
2. **CHECK**: New agent (openclaw or similar) appears in the agent list
3. **CHECK**: Agent shows "active" status
4. **CHECK**: "View" link works → agent detail page shows embed code

### Phase 5: Widget Preview Chat (on agent detail page)

1. From Phase 4, you should be on an agent detail page
2. **CHECK**: "Test Your Widget" section visible on the page
3. **CHECK**: Widget preview shows "Connected" status (green badge)
4. **Click** the input field in the widget preview
5. **Type**: "I am evaluating Vibe Browser. How do I install the extension? Please include the direct install link and docs link."
6. **Press Enter** to send
7. **CHECK**: User message appears in the widget preview chat
8. **CHECK**: Typing indicator (·) shows while waiting
9. **Wait** up to 120s for response
10. **CHECK**: Bot response appears, is non-empty, and includes direct URL(s) for install/docs
11. **CHECK**: No "⚠️ Error" message (this means OpenClaw agent isn't registered)
12. **SCREENSHOT**: Widget preview with message exchange visible

### Phase 5b: Widget WS Protocol (optional, if Phase 5 fails)

If the widget preview shows an error, debug via WebSocket directly:
1. From the agent detail page, copy the embed token from the embed code
2. Use `curl` or Node.js to test WebSocket:
   ```
   Connect to wss://dev.lamoom.com/ws
   Send: {"type":"auth","agentToken":"<TOKEN>","userId":"e2e-test"}
   Expect: {"type":"auth_ok",...}
   Send: {"type":"message","content":"I am evaluating Vibe Browser. How do I install the extension? Please include the direct install link and docs link."}
   Expect: {"type":"message","content":"...","done":true}
   ```
3. **CHECK**: auth_ok received (widget auth chain works)
4. **CHECK**: Message response is non-empty, contextual, and includes direct URL(s)

### Phase 5c: Real Widget Demo (standalone page)

Required validation sequence for this phase:
1. Create a `vibebrowser.app` agent via meta-agent flow.
2. Confirm meta-agent did exploration and generated **knowledgebase + skills** artifacts.
3. Inject widget on `https://vibebrowser.app` using eval-style browser execution (`evaluate_script` / `page.evaluate`).
4. Chat with widget using the two eval questions and score both answers with G-Eval rubric.

Test the widget as an actual customer would embed it:
1. From the agent detail page, copy the full `<script>` embed code
2. Open `https://vibebrowser.app`
3. Inject the embed script using eval-style browser execution (equivalent to `evaluate_script` / `page.evaluate`)
4. **CHECK**: Widget bubble appears (bottom-right floating button)
5. **Click** the widget bubble to open the chat panel
6. **CHECK**: Chat panel slides up, shows "Connected" or ready state
7. Ask question #1: **"what is the product about"**
8. Ask question #2: **"how to install it?"**
9. **CHECK**: Bot responds to both prompts with relevant content (install answer should include direct link(s))
10. Score both answers with a G-Eval style rubric (1-5); require both to meet the configured threshold (default: ≥3)
    - Q1 ("what is the product about"): reward product identity + capabilities + clarity.
    - Q2 ("how to install it?"): reward actionable install guidance + direct link(s) + docs/support references.
11. **CHECK**: Close/reopen bubble — chat history preserved
12. **SCREENSHOT**: Widget demo working on standalone page

**Execution rule:** run this phase directly in the browser session (vibebrowser/playwright tools), not via shell-script shortcuts.

### Phase 6: Sign Out Flow

1. On the dashboard page, find the sign-out button (top-right, user menu or direct button)
2. **Click** sign out
3. **CHECK**: Redirected to `/login`
4. **CHECK**: Visiting `/dashboard` redirects back to `/login` (session cleared)
5. Log back in for remaining tests

### Phase 7: Agent Management — Delete

1. **Navigate** to `https://dev.lamoom.com/dashboard`
2. Find an agent with a "Delete" button (pick one that's not important, or the test agent from Phase 3)
3. Note the agent name
4. **Click** Delete
5. **CHECK**: Confirmation dialog appears (window.confirm or modal)
6. **Accept** the confirmation
7. **CHECK**: Agent disappears from the list (or page reloads without it)
8. **CHECK**: No error messages visible
9. **SCREENSHOT**: Dashboard after deletion

### Phase 8: Agent Detail — Actions

1. **Navigate** to `https://dev.lamoom.com/dashboard`
2. **Click** "View" on any active agent
3. On the agent detail page:
   - **CHECK**: Embed code section visible with `<script>` tag
   - **CHECK**: "Copy Embed Code" button exists and is clickable
   - **CHECK**: "Regenerate Token" button exists
4. **Click** "Regenerate Token"
5. **CHECK**: Confirmation dialog appears
6. **Accept** — **CHECK**: Success message or token changes
7. **SCREENSHOT**: Agent detail page with all actions visible

### Phase 9: Admin CRM (requires ADMIN_EMAILS match)

1. **Navigate** to `https://dev.lamoom.com/admin`
2. **CHECK**: Page loads (not 403/redirect — if it does, note and skip)
3. **CHECK**: Stats cards visible: Total Users, Total Agents, Active Agents, Total Sessions
4. **CHECK**: Users table visible with at least 1 row
5. **CHECK**: Agents table visible
6. **CHECK**: Audit Log table visible with recent entries
7. **SCREENSHOT**: Admin dashboard

## UI/UX Quality Checklist (check on EVERY page)

Run these checks on every page you visit. Any failure = QA FAIL.

| # | Check | How to verify |
|---|-------|---------------|
| 1 | Dark theme everywhere | No white/light backgrounds. bg should be #171717 or similar |
| 2 | No broken layouts | No overlapping elements, no horizontal scroll |
| 3 | /create loads LibreChat | Iframe loads, SSO works, no login page shown |
| 4 | Markdown rendering | LibreChat renders markdown (bold, code, lists) in responses |
| 5 | No "student project" feel | No default shadcn cards/borders, professional look |
| 6 | Loading states | SSO loading dots on /create, typing indicator in chat |
| 7 | Error handling | If SSO or API fails, error message + retry button shown |
| 8 | Professional typography | Consistent font sizes, proper spacing, readable text |

## Reporting

After running all phases, report a summary table:

```
## QA Results — [DATE]

| Phase | Status | Notes |
|-------|--------|-------|
| 0. Infrastructure | ✅/❌ | health, openclaw health, widget.js, /v1/models, LibreChat docker |
| 0b. Static Assets | ✅/❌ | CSS 200+size>1KB, JS chunks 200 — BLOCKING |
| 0c. OAuth Providers | ✅/❌ | /api/auth/providers returns google+credentials — BLOCKING |
| 1. Login & Dashboard | ✅/❌ | auth works, dark theme |
| 2. LibreChat Integration | ✅/❌ | SSO works, iframe loads, dark theme, no login page |
| 3. Agent Creation | ✅/❌ | full conversation via LibreChat, markdown rendered, embed code |
| 4. Agent Verification | ✅/❌ | appears in dashboard |
| 5. Widget Preview | ✅/❌ | live chat on dashboard works |
| 6. Sign Out Flow    | ✅/❌ | logout + session cleared |
| 7. Agent Delete      | ✅/❌ | delete + confirmation |
| 8. Agent Detail      | ✅/❌ | embed code, copy, regenerate |
| 9. Admin CRM        | ✅/❌ | stats, users, agents, audit |

UI/UX Issues Found:
- [list any visual/interaction problems]

Blockers:
- [list anything that prevents the product from working]
```

## Deploy Verification Checklist

After any deploy, verify these common failure modes:
1. `_next/static/` JS chunks return 404 → standalone static files not copied
2. `NEXT_PUBLIC_*` env vars not baked into build → rebuild with env inline
3. Proxy not restarted after code change → `systemctl restart webagent-proxy`
4. OpenClaw gateway not restarted after config change → `systemctl restart openclaw-gateway`
5. Widget.js stale → clear browser cache, check `/widget.js` returns fresh content
6. Google OAuth callback fails → DrizzleAdapter not passed custom table schemas (singular vs plural table names)
7. LibreChat not running → `cd /opt/librechat && docker compose up -d`
8. SSO bridge returns 429 → LibreChat rate limited registration, restart: `docker compose restart api`
9. SSO bridge "no token" → user not created in LibreChat (email verification issue), check `ALLOW_UNVERIFIED_EMAIL_LOGIN=true` in `/opt/librechat/.env`
10. LibreChat iframe shows login page → SSO flow failed, check proxy logs: `journalctl -u webagent-proxy -n 20 --output=cat | grep sso`
11. tsbuildinfo stale on VM → `find /opt/webagent/packages -name 'tsconfig.tsbuildinfo' -delete` then rebuild
