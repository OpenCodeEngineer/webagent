# MVP Readiness Report — Lamoom

**Run date:** 2026-05-23  
**Run ID:** mvp-2026-05-23-run2  
**Evaluator:** Claude Sonnet 4.6 (automated)  
**Target:** https://dev.lamoom.com  
**Git branch:** fix/remove-openclaw-gateway-service  
**Git HEAD (local repo):** 01ba327  
**Git HEAD (deployed server):** 9cb9f75  

---

## Executive Summary

**VERDICT: NOT READY FOR MVP**

Gate 2 (end-to-end user flow) is BLOCKED at Phase 1 (Authentication). The production server is running a stale build compiled from commit `9cb9f75` — a commit that predates the auth fix in `a24a680`. The DB migration is correctly applied (`users.hashed_password` column exists and is populated), but the deployed code reads bcrypt from `accounts.access_token` (the old column), not `users.hashed_password`. Login fails with "Invalid email or password" for all credential-auth users set up with the new schema.

---

## Gate 1: Pre-flight Checks — PASS

| Check | Result | Notes |
|---|---|---|
| Admin UI health (`/`) | PASS | 200 OK, page renders |
| SSH connectivity | PASS | root@78.47.152.177 accessible |
| OpenClaw gateway health | PASS | `/health` returns 200 OK |
| Widget.js served | PASS | 200 OK, 12960 bytes |
| Azure AI judge model reachable | PASS | `kimi-k2.5-thinking` via `AZURE_DEV_AI_BASE_URL` |
| `openclaw.json5` exec audit | PASS | meta workspace: exec BLOCKED; product workspaces: exec ALLOWED |
| SSH template `Workflow-as-Code` | PASS | `/opt/webagent/openclaw/workspaces/meta/templates/AGENTS.md` contains Workflow-as-Code section |

---

## Gate 2: End-to-End User Flow — NOT READY (BLOCKING)

### Phase 1: Authentication — BLOCKING FAILURE

**Status:** FAILED — login completely non-functional for credentials provider.

**Error observed (browser):**
```
Invalid email or password
```

**Root cause (confirmed):**

The deployed Next.js admin app was built from commit `9cb9f75` ("chore: consolidate sprint branches"), compiled 2026-05-23 ~12:38 UTC. This commit does NOT include `a24a680` ("fix: password column + settings page for MVP"), which changes auth storage from `accounts.access_token` to `users.hashed_password`.

- `git merge-base --is-ancestor a24a680 9cb9f75` → exit code 1 (NOT an ancestor — fix is missing from deployed build)
- Deployed `/opt/webagent/packages/admin/src/lib/auth.ts` (timestamp 11:02): checks `credAccount.access_token` for bcrypt
- Deployed `/opt/webagent/packages/admin/src/lib/auth-schema.ts` (timestamp 11:02): `users` table has NO `hashedPassword` field
- DB state: `users.hashed_password` column EXISTS (migration applied) and populated for `demo@lamoom.com`
- `accounts.access_token` for `demo@lamoom.com`: NOT a bcrypt hash (old flow never ran for this user)

The credentials provider finds the user, fetches `credAccount.access_token` → not a bcrypt hash → `bcrypt.compare()` returns false → "Invalid email or password".

**Action required (ops):**

```bash
# On server: rebuild and restart from latest code
cd /opt/webagent
git pull origin fix/remove-openclaw-gateway-service
cd packages/admin
npm run build
systemctl restart webagent-admin
```

This deploys commit `a24a680`+ which reads bcrypt from `users.hashed_password`.

**Evidence:**
- Screenshot: `evals/e2e-output/2026-05-23/01-login.png` — login page initial state
- Screenshot: `evals/e2e-output/2026-05-23/01b-login-filled.png` — credentials filled
- Screenshot: `evals/e2e-output/2026-05-23/02-login-failure.png` — "Invalid email or password" error visible
- Server git HEAD confirmed `9cb9f75` (pre-fix); local HEAD `01ba327` includes fix

### Phase 2: Agent Creation — NOT RUN (blocked by Phase 1)
### Phase 3: Dashboard Verification — NOT RUN
### Phase 4: Widget Chat — NOT RUN
### Phase 4.5: Workflow Artifact Audit — NOT RUN
### Phase 5: UX Quality Audit — NOT RUN
### Phase 6: Time-to-Value Measurement — NOT RUN

---

## Gate 3: Product-Agent Eval (G-Eval Battery) — NOT RUN

Blocked by Gate 2 failure. No agent created; embed token not available; widget chat cannot be tested.

Note: Existing agent `openclaw-console-0e3d9d31` is present on the server and the openclaw gateway is functional. Once login works, Gate 3 can proceed.

---

## Additional Findings

### FINDING-1: Server deployed build is stale (HIGH severity — BLOCKING)

Server running code built from `9cb9f75`. Local repo HEAD is `01ba327`. Gap includes at minimum:
- `a24a680` — auth fix (users.hashed_password, auth-schema.ts rewrite)
- `54a28bb` — fix duplicate paperclipAgentId column in schema
- `01ba327` — merge PR #221

Server must be updated and rebuilt.

### FINDING-2: Chrome DevTools MCP server disconnected (INFRASTRUCTURE)

`DevToolsActivePort` file stale — WS UUID from prior Chrome session. CDP at `localhost:9222` responds but MCP server fails to connect. Playwright CDP (`http://localhost:9222`) works as fallback. Not blocking product eval; blocking automated tooling.

### FINDING-3: Stale Server Action hashes (LOW severity)

Service logs show `Failed to find Server Action "x"` — browser cache holds old build's action IDs. Self-resolves on hard refresh. Not blocking.

---

## Top 3 Blockers

| Priority | Blocker | Action |
|---|---|---|
| P0 — BLOCKING | Server admin app built from stale commit `9cb9f75` (missing auth fix `a24a680`). Deployed `auth.ts` reads bcrypt from `accounts.access_token`; new setup stores it in `users.hashed_password`. Login non-functional. | Rebuild + redeploy admin app from current branch HEAD on server. |
| P0 — BLOCKING | Once login works: verify `demo@lamoom.com` can create agent and widget embed token is generated. Confirm DB schema on server matches repo schema (all migrations applied). | After redeploy, re-run Gate 2 Phases 1–6 + Gate 3 G-eval. |
| P1 | Chrome DevTools MCP server not connected — stale WebSocket UUID in DevToolsActivePort. Blocks automated browser eval tooling. | Kill old Chrome, restart with `--remote-debugging-port=9222`, update DevToolsActivePort. |

---

## What's Broken vs Cosmetic

| Issue | Severity | Type |
|---|---|---|
| Admin app stale build (auth broken) | CRITICAL | Blocking bug |
| accounts.access_token vs users.hashed_password mismatch | CRITICAL | Deploy/config bug |
| Chrome DevTools MCP disconnected | MEDIUM | Infrastructure |
| Stale Server Action hashes in logs | LOW | Cosmetic (self-heals) |

---

## Estimated Fix Effort

- **P0 deploy fix**: 15 minutes — `git pull && npm run build && systemctl restart webagent-admin` on server
- **Gate 2 re-run**: 20 minutes after fix
- **Gate 3 G-eval**: 30 minutes after Gate 2 passes
- **Total to MVP verdict**: ~65 minutes of unblocked work

---

## Required Actions Before MVP

| Priority | Action | Owner |
|---|---|---|
| P0 — BLOCKING | Rebuild + redeploy admin app from current branch HEAD on server (`git pull` + `npm run build` + service restart) | Ops/Dev |
| P0 — BLOCKING | Re-run Gate 2 E2E (Phases 1–6) after redeploy | QA |
| P0 — BLOCKING | Re-run Gate 3 G-eval battery (12 prompts) after Gate 2 passes | QA |
| P1 | Fix Chrome DevTools MCP server (restart Chrome with remote debugging) | Infra |

---

## Screenshots

| File | Description |
|---|---|
| `evals/e2e-output/2026-05-23/01-login.png` | Login page (initial state) |
| `evals/e2e-output/2026-05-23/01b-login-filled.png` | Login page with credentials filled |
| `evals/e2e-output/2026-05-23/02-login-failure.png` | Post-submit — "Invalid email or password" (auth failed, stale build) |
