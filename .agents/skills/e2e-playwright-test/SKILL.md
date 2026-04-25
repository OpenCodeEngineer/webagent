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

1. **Type** a test website description in the input:
   > "It's called PetPal, a pet supplies store at https://petpal.example.com. We have a REST API at https://api.petpal.example.com for products, orders, and customer accounts. Tone should be friendly and helpful."
2. **Press Enter** to send
3. **CHECK**: User message appears as a right-aligned chat bubble
4. **CHECK**: Typing indicator shows
5. **Wait** for meta-agent response (up to 120s)
6. **CHECK**: Bot response appears, mentions PetPal or pets
7. **SCREENSHOT**: Chat with both messages visible

8. If the meta-agent asks for confirmation, **type**: "Yes, that's correct. Please create the agent now."
9. **Press Enter**, wait up to 180s (agent creation involves file writes)
10. **CHECK**: Look for embed code card in the chat OR `[AGENT_CREATED::` marker in response
11. **SCREENSHOT**: After agent creation response

### Phase 4: Verify Created Agent

1. **Navigate** to `https://dev.lamoom.com/dashboard`
2. **CHECK**: New agent (PetPal or similar) appears in the agent list
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
| 1. Login & Dashboard | ✅/❌ | auth works, dark theme |
| 2. Chat UI Quality | ✅/❌ | ChatGPT-like, no regressions |
| 3. Agent Creation | ✅/❌ | full conversation, embed code |
| 4. Agent Verification | ✅/❌ | appears in dashboard |
| 5. Widget Preview | ✅/❌ | live chat on dashboard works |

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
