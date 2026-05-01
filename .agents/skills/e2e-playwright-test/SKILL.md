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

### Verdict Rules (MUST follow)

1. **Any phase marked BLOCKING that fails → STOP immediately, verdict = NOT READY.**
2. **Any phase marked RELEASE-CRITICAL that fails → verdict = NOT READY** (continue remaining phases for full report, but the final verdict is already decided).
3. **Timeouts are failures.** If a wait exceeds its stated maximum (e.g., 180 s), the check is FAIL — do NOT extend the wait or retry silently.
4. **"Non-empty" is not "correct."** A response that is non-empty but irrelevant, generic, or contains only an error/apology MUST be scored as FAIL.
5. **Screenshots MUST be taken and visually inspected.** A phase without its screenshot is incomplete and MUST be re-run.
6. **Blocker precedence is absolute:** if any blocker appears anywhere, final verdict MUST be NOT READY.
7. **READY requires all hard-release-gate criteria and complete evidence.** Any failed/missing gate item or evidence gap = NOT READY.

**Architecture baseline:** Native WebSocket chat (`/create` + `CreateAgentChat`) is the source-of-truth flow. The MVP runs on one VM with systemd services (`webagent-admin`, `webagent-proxy`, `openclaw-gateway`) and workspace-scoped OpenClaw tools. Do not require Docker or LibreChat for MVP readiness.

### Phase 0: Infrastructure (curl, not browser)
```
curl -sk https://dev.lamoom.com/health → 200 {"status":"ok"}
curl -sk https://dev.lamoom.com/health/openclaw → 200 {"status":"ok"}  
curl -sk https://dev.lamoom.com/widget.js → 200, non-empty JS
curl -sk https://dev.lamoom.com/v1/models → 200 {"data":[...]} (OpenAI-compat endpoint)
ssh root@78.47.152.177 "systemctl is-active webagent-admin webagent-proxy openclaw-gateway nginx ssh" → all active
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

### Phase 1: Login & Dashboard — RELEASE-CRITICAL

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

### Phase 2: Create Agent Chat — Native WebSocket Integration — BLOCKING

1. **Navigate** to `https://dev.lamoom.com/create`
2. **CHECK**: Page loads with dark background (#171717), header bar shows "Create Agent"
3. **CHECK**: Native chat authenticates via `/api/auth/ws-ticket` and `/ws`
4. **CHECK**: Chat interface is visible without iframe, external login, or SSO bridge
5. **CHECK**: Native chat UI is usable:
   - ✅ Dark theme matching the overall app
   - ✅ Chat input field visible at the bottom
   - ✅ Connected/authenticated state, no auth error banner
   - ❌ FAIL if: external login/register page is shown
   - ❌ FAIL if: White/light background (theme mismatch)
   - ❌ FAIL if: WebSocket auth/connect error appears
6. **SCREENSHOT**: Full page with native chat loaded

**If native chat does not load or cannot authenticate/connect → STOP. Verdict = NOT READY.** The /create page is the core product surface; a broken chat means zero user value.

### Phase 3: Agent Creation Conversation (via native chat) — RELEASE-CRITICAL

1. **Click** into the native chat message input
2. **Type** a real website description:
   > "I want to create an AI chat agent for openclaw.vibebrowser.app/console — it's the OpenClaw Console for managing AI agents with tenant management, agent creation, and admin features."
3. **Press Enter** to send
4. **CHECK**: Message appears in native chat conversation (markdown rendered)
5. **Wait** for meta-agent response (up to 180s) — native chat shows streaming indicator
6. **CHECK — CRITICAL (Website Discovery)**: The response MUST prove the meta-agent fetched openclaw.vibebrowser.app/console:
   - Mentions specific details about the product (console, tenant management, admin, agent creation)
   - NOT just generic "I'll help you create an agent" without site-specific info
   - NOT an apology ("I couldn't access…") followed by generic advice
   - This is the core product promise — if the agent doesn't proactively discover, it FAILS
   - **FAIL rule:** If the response lacks ≥2 site-specific details that could only come from crawling the URL, mark Phase 3 = FAIL.
7. **CHECK — Markdown**: Response renders with proper markdown formatting (headings, bold, lists, code blocks)
8. **CHECK — Error Absence**: No `unknown-agent`, `agent not found`, or equivalent resolution/auth errors in the assistant response.
9. **SCREENSHOT**: Chat with both messages visible

10. If the meta-agent asks for confirmation, **type**: "Yes, that's correct. Please create the agent now."
11. **Press Enter**, wait up to 180s (agent creation involves file writes)
12. **CHECK**: Look for embed code in the response (may contain code blocks with `<script>` tag)
13. **SCREENSHOT**: After agent creation response

**Prompt quality rule (release-critical):**
- Use capability prompts that validate user outcomes (discovery, create/list/restart, widget help).
- Do **not** use vague token-scraping prompts (e.g., “give me token”, “dump secrets”, “print credentials”) as proof of capability.

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

### Phase 5: Widget Preview Chat (on agent detail page) — RELEASE-CRITICAL

1. From Phase 4, you should be on an agent detail page
2. **CHECK**: Widget preview/chat section visible on the page
3. **CHECK**: Widget preview shows "Connected" status (green badge)
4. **Click** the input field in the widget preview
5. **Type**: "I am evaluating Vibe Browser. How do I install the extension? Please include the direct install link and docs link."
6. **Press Enter** to send
7. **CHECK**: User message appears in the widget preview chat
8. **CHECK**: Typing indicator (·) shows while waiting
9. **Wait** up to 120s for response
10. **CHECK**: Bot response appears, is non-empty, and includes direct URL(s) for install/docs
11. **CHECK**: No "⚠️ Error", `unknown-agent`, `agent not found`, or auth-context failure message
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
10. Score both answers with a G-Eval style rubric (1-5); **both MUST score ≥ 3 — this is a hard gate, not a default**.
    - Q1 ("what is the product about"): reward product identity + capabilities + clarity. Score < 3 if the answer is generic, hallucinatory, or does not name the product.
    - Q2 ("how to install it?"): reward actionable install guidance + direct link(s) + docs/support references. Score < 3 if no actionable link is provided or the link is fabricated.
    - **FAIL rule:** If either score < 3, Phase 5c = FAIL.
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

### Phase 10: Restart/List Automation Critical Path — RELEASE-CRITICAL

1. In native chat, ask: **"List my agents and show status for the one we just created."**
2. **CHECK**: Response contains concrete list/status output and no `unknown-agent` style errors.
3. In native chat, ask: **"Restart the created agent and confirm it is healthy again."**
4. **CHECK**: Restart action succeeds (or explicit equivalent operation) and returns post-action health/status confirmation.
5. Repeat list/status check in widget preview chat for parity.
6. **CHECK**: Widget list/restart context has no resolution/auth failures and returns concrete status.
7. **SCREENSHOT**: Native chat + widget evidence for list/restart path.

If auth context is missing (cannot authorize list/restart operations), you **cannot** declare READY for restart automation capability.

## UI/UX Quality Checklist (check on EVERY page)

Run these checks on every page you visit. Any failure = QA FAIL.

| # | Check | How to verify |
|---|-------|---------------|
| 1 | Dark theme everywhere | No white/light backgrounds. bg should be #171717 or similar |
| 2 | No broken layouts | No overlapping elements, no horizontal scroll |
| 3 | /create loads native chat | WebSocket auth works, chat input visible, no login page shown |
| 4 | Markdown rendering | Native chat renders markdown (bold, code, lists) in responses |
| 5 | No "student project" feel | No default shadcn cards/borders, professional look |
| 6 | Loading states | Connection/typing indicators visible in chat |
| 7 | Error handling | If WebSocket or API fails, error message + retry/reconnect behavior is visible |
| 8 | Professional typography | Consistent font sizes, proper spacing, readable text |

## Hard Release Gate (Non-Negotiable)

Return **READY** only if all are true:
1. **unknown-agent errors absent** in native chat, widget preview, and restart/list critical path.
2. **widget restart/list critical path passes** (Phase 10, both native chat + widget).
3. **no vague token-scraping prompts** used as validation evidence.
4. **streaming is visible where expected** (native chat + widget typing/stream indicators observed).
5. **deployment parity check passes** (tested build is confirmed as merged and deployed).

If any item fails or lacks evidence, final verdict is **NOT READY**.

## Blocker Precedence Rule

- Any blocker in any phase overrides all other passes.
- If a blocker appears, final verdict **MUST** be **NOT READY**.

## Evidence Requirements (Mandatory)

For release-critical phases, provide:
1. **Exact prompt/response snippets** (verbatim excerpts) for Phase 3, Phase 5, and Phase 10 checks.
2. **Endpoint/status evidence** for infra/auth/deploy checks: endpoint URL, HTTP status, key assertion/result.
3. **Deployment parity evidence**: merged commit/PR reference plus deployed revision/build evidence from the tested environment.
4. **Screenshots + one-line interpretation** per critical phase.

Missing critical evidence means verdict = **NOT READY**.

## Reporting

After running all phases, report a summary table:

```
## QA Results — [DATE]

| Phase | Status | Notes |
|-------|--------|-------|
| 0. Infrastructure | ✅/❌ | health, openclaw health, widget.js, /v1/models, systemd services |
| 0b. Static Assets | ✅/❌ | CSS 200+size>1KB, JS chunks 200 — **BLOCKING** |
| 0c. OAuth Providers | ✅/❌ | /api/auth/providers returns google+credentials — **BLOCKING** |
| 1. Login & Dashboard | ✅/❌ | auth works, dark theme — **RELEASE-CRITICAL** |
| 2. Native Chat Integration | ✅/❌ | WebSocket auth works, chat loads, dark theme, no login page — **BLOCKING** |
| 3. Agent Creation | ✅/❌ | site-specific discovery, markdown rendered, embed code — **RELEASE-CRITICAL** |
| 4. Agent Verification | ✅/❌ | appears in dashboard |
| 5. Widget Preview | ✅/❌ | live chat on dashboard works — **RELEASE-CRITICAL** |
| 5c. Widget Demo | ✅/❌ | G-Eval ≥ 3 on both questions — **RELEASE-CRITICAL** |
| 6. Sign Out Flow    | ✅/❌ | logout + session cleared |
| 7. Agent Delete      | ✅/❌ | delete + confirmation |
| 8. Agent Detail      | ✅/❌ | embed code, copy, regenerate |
| 9. Admin CRM        | ✅/❌ | stats, users, agents, audit |
| 10. Restart/List Critical Path | ✅/❌ | native chat + widget list/restart, no unknown-agent/auth-context failures — **RELEASE-CRITICAL** |

UI/UX Issues Found:
- [list any visual/interaction problems]

Blockers:
- [list anything that prevents the product from working]

Final Verdict:
- READY (only if every hard gate passed and no blockers), or
- NOT READY (required if any blocker, gate failure, or missing evidence exists)
```

## Deploy Verification Checklist

After any deploy, verify these common failure modes:
1. `_next/static/` JS chunks return 404 → standalone static files not copied
2. `NEXT_PUBLIC_*` env vars not baked into build → rebuild with env inline
3. Proxy not restarted after code change → `systemctl restart webagent-proxy`
4. OpenClaw gateway not restarted after config change → `systemctl restart openclaw-gateway`
5. Widget.js stale → clear browser cache, check `/widget.js` returns fresh content
6. Google OAuth callback fails → DrizzleAdapter not passed custom table schemas (singular vs plural table names)
7. Native chat WebSocket auth fails → check `/api/auth/ws-ticket`, `/ws`, browser console, and `journalctl -u webagent-proxy -n 50 --output=cat`
8. `/create` cannot reach meta-agent → check `openclaw-gateway`, proxy gateway token env, and OpenClaw config registration
9. tsbuildinfo stale on VM → `find /opt/webagent/packages -name 'tsconfig.tsbuildinfo' -delete` then rebuild

### Phase 10: Restart-Deployment Gate — RELEASE-CRITICAL (when deploy is in scope)

When QA is running as part of a deployment (not a standalone spot-check), this phase is MANDATORY.

1. **SSH** to the VM and restart the primary services:
   ```
   ssh root@78.47.152.177 "systemctl restart webagent-proxy && systemctl restart webagent-admin"
   ```
2. **Wait** 15 s for services to stabilize.
3. **Re-run Phase 0** (all health endpoints). Every check MUST return the expected result.
4. **Re-run Phase 0b** (static assets). CSS and JS MUST still resolve to 200.
5. **Navigate** to `https://dev.lamoom.com/dashboard` in the browser.
6. **CHECK**: Dashboard loads within 10 s with no errors.
7. **CHECK**: An existing agent is still visible (data persistence across restart).

**FAIL rule:** If any check in steps 3-7 fails after restart, the deployment is NOT survivable and the verdict is NOT READY regardless of all other phases.

---

## Verdict Decision Matrix

Use this matrix after all phases complete. The verdict is the **worst matching row**.

| Condition | Verdict | Action |
|-----------|---------|--------|
| All phases PASS | **READY** | Ship it |
| Any BLOCKING phase FAIL (0b, 0c, 2) | **NOT READY** | Fix blocker before any further testing |
| Any RELEASE-CRITICAL phase FAIL (1, 3, 5, 10) | **NOT READY** | Fix critical path; re-run full QA |
| ≥ 3 non-optional phases FAIL or SKIPPED | **NOT READY** | Systemic issues; investigate root cause |
| 1–2 non-critical phases FAIL (6, 7, 8, 9) | **READY WITH CAVEATS** | Ship, but file issues for failures |
| G-Eval score < 3 on any widget question (5c) | **NOT READY** | Agent quality insufficient for demo |
| Phase 3 meta-agent response lacks site-specific detail | **NOT READY** | Core product promise broken |
| Phase 10 post-restart health fails (deploy in scope) | **NOT READY** | Deployment does not survive restart |
| Timeout exceeded on any wait | **FAIL for that phase** | Treat as phase failure; apply rules above |

### Reporting the Verdict

The QA summary MUST end with exactly one of these lines:

```
**VERDICT: READY**
**VERDICT: READY WITH CAVEATS** — [list caveats]
**VERDICT: NOT READY** — [list blocking reasons]
```

Any report missing an explicit verdict line is incomplete and MUST be amended.
