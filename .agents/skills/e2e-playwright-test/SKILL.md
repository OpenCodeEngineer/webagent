---
name: e2e-test
description: >
  Browser-based E2E QA for the Lamoom platform. Triggers on "run tests",
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

### Phase 0: Infrastructure (curl, not browser)
```
curl -sk https://dev.lamoom.com/health → 200 {"status":"ok"}
curl -sk https://dev.lamoom.com/health/openclaw → 200 {"status":"ok"}  
curl -sk https://dev.lamoom.com/widget.js → 200, non-empty JS
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

### Phase 2: Create Agent Chat — UI/UX Quality

1. **Navigate** to `https://dev.lamoom.com/create`
2. **CHECK UI — CRITICAL**: This must look like a ChatGPT-style chat interface:
   - ✅ Full-screen dark background, no white areas
   - ✅ Input bar at the bottom, centered, rounded container
   - ✅ NO heading like "Create Agent" or "Follow each stage" (the page IS the chat)
   - ✅ Empty state: centered icon/text, subtle, not a form
   - ❌ FAIL if: light background, form-like layout, headings above chat, bordered card container
3. **Wait for greeting** (up to 60s):
   - **CHECK**: Meta-agent greeting appears as a chat message
   - **CHECK**: Message is conversational AI text, not error or placeholder
   - **CHECK**: Typing indicator (dots) shows while loading
4. **SCREENSHOT**: Full page after greeting loads

### Phase 3: Agent Creation Conversation

1. **Type** a real website description in the input:
   > "I want to create an AI chat agent for vibebrowser.app — it's a browser with built-in AI capabilities."
2. **Press Enter** to send
3. **CHECK**: User message appears as a right-aligned chat bubble
4. **CHECK**: Typing indicator shows
5. **Wait** for meta-agent response (up to 180s)
6. **CHECK — CRITICAL (Website Discovery)**: The response MUST prove the meta-agent fetched vibebrowser.app:
   - Mentions specific details about the product (browser, AI, automation, etc.)
   - NOT just generic "I'll help you create an agent" without site-specific info
   - This is the core product promise — if the agent doesn't proactively discover, it FAILS
7. **SCREENSHOT**: Chat with both messages visible

8. If the meta-agent asks for confirmation, **type**: "Yes, that's correct. Please create the agent now."
9. **Press Enter**, wait up to 180s (agent creation involves file writes)
10. **CHECK**: Look for embed code card in the chat OR `[AGENT_CREATED::` marker in response
11. **SCREENSHOT**: After agent creation response

### Phase 4: Verify Created Agent

1. **Navigate** to `https://dev.lamoom.com/dashboard`
2. **CHECK**: New agent (vibebrowser or similar) appears in the agent list
3. **CHECK**: Agent shows "active" status
4. **CHECK**: "View" link works → agent detail page shows embed code

### Phase 5: Widget Preview Chat (on agent detail page)

1. From Phase 4, you should be on an agent detail page
2. **CHECK**: "Test Your Widget" section visible on the page
3. **CHECK**: Widget preview shows "Connected" status (green badge)
4. **Click** the input field in the widget preview
5. **Type**: "What products do you have?"
6. **Press Enter** to send
7. **CHECK**: User message appears in the widget preview chat
8. **CHECK**: Typing indicator (·) shows while waiting
9. **Wait** up to 120s for response
10. **CHECK**: Bot response appears, is non-empty, and mentions relevant products/services
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
   Send: {"type":"message","content":"What products do you have?"}
   Expect: {"type":"message","content":"...","done":true}
   ```
3. **CHECK**: auth_ok received (widget auth chain works)
4. **CHECK**: Message response is non-empty and contextual

### Phase 5c: Real Widget Demo (standalone page)

Test the widget as an actual customer would embed it:
1. From the agent detail page, copy the full `<script>` embed code
2. Open a new browser tab to `data:text/html,` or any blank page
3. Execute JavaScript to inject the embed script into the page
4. **CHECK**: Widget bubble appears (bottom-right floating button)
5. **Click** the widget bubble to open the chat panel
6. **CHECK**: Chat panel slides up, shows "Connected" or ready state
7. **Type** "Hello, what can you help me with?" and send
8. **Wait** up to 120s for response
9. **CHECK**: Bot responds with relevant information
10. **CHECK**: Close/reopen bubble — chat history preserved
11. **SCREENSHOT**: Widget demo working on standalone page

**Automation requirement:** `scripts/test-e2e-full.sh` must execute this as a blocking check (current test ID: `T10b`) by writing a temporary standalone HTML file with the real embed `<script>`, opening it in a browser runtime, sending a message, and failing on auth errors (e.g., `Invalid agent token`).

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
| 3 | Chat looks like ChatGPT | Full-screen chat, messages as text blocks, input at bottom |
| 4 | No "student project" feel | No default shadcn cards/borders around chat, no form-like layout |
| 5 | Responsive input | Textarea grows with content, send button aligned |
| 6 | Loading states | Typing indicator shows during API calls |
| 7 | Error handling | If API fails, error message appears in chat (not silent) |
| 8 | Professional typography | Consistent font sizes, proper spacing, readable text |

## Reporting

After running all phases, report a summary table:

```
## QA Results — [DATE]

| Phase | Status | Notes |
|-------|--------|-------|
| 0. Infrastructure | ✅/❌ | health, openclaw health, widget.js |
| 0b. Static Assets | ✅/❌ | CSS 200+size>1KB, JS chunks 200 — BLOCKING |
| 0c. OAuth Providers | ✅/❌ | /api/auth/providers returns google+credentials — BLOCKING |
| 1. Login & Dashboard | ✅/❌ | auth works, dark theme |
| 2. Chat UI Quality | ✅/❌ | ChatGPT-like, no regressions |
| 3. Agent Creation | ✅/❌ | full conversation, embed code |
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
