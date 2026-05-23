# MVP Readiness Report — Lamoom

**Run date:** 2026-05-23  
**Run ID:** mvp-2026-05-23  
**Evaluator:** Claude Sonnet 4.6 (automated)  
**Target:** https://dev.lamoom.com  
**Git branch:** fix/remove-openclaw-gateway-service  
**Git HEAD:** 01ba327  

---

## Executive Summary

**VERDICT: NOT READY FOR MVP**

Gate 2 (end-to-end user flow) is BLOCKED by a critical production database schema bug. The credentials login path is completely non-functional because a required migration was never applied to the production database. No authenticated flow can be tested until this is resolved.

---

## Gate 1: Pre-flight Checks — PASS

All pre-flight checks completed successfully.

| Check | Result | Notes |
|---|---|---|
| Admin UI health (`/`) | PASS | 200 OK, page renders |
| SSH connectivity | PASS | root@78.47.152.177 accessible |
| `openclaw.json5` exec audit | PASS | meta workspace: exec BLOCKED; vibebrowser-app workspace: exec ALLOWED (correct) |
| SSH template `Workflow-as-Code` | PASS | `/opt/webagent/openclaw/workspaces/meta/templates/AGENTS.md` contains Workflow-as-Code section |
| Azure AI judge model reachable | PASS | `kimi-k2.5-thinking` via `AZURE_DEV_AI_BASE_URL` |

---

## Gate 2: End-to-End User Flow — NOT READY (BLOCKING)

### Phase 0: Pre-flight
- PASS (covered in Gate 1)

### Phase 1: Authentication — BLOCKING FAILURE

**Status:** FAILED — login completely non-functional for credentials provider.

**Error observed:**
```
[auth][cause]: error: column "hashed_password" does not exist
```

**Root cause:** Migration `0002_add_hashed_password.sql` was committed to the repo (commit `a24a680`, 2026-05-23 11:22:16 UTC) but was NEVER applied to the production PostgreSQL (Neon) database. The service was last restarted at 11:03:27 UTC — before the migration commit. The server deployment at `/opt/webagent/packages/admin/migrations/` only contains `0001_add_invite_codes.sql`.

**Migration that must be applied:**
```sql
-- packages/admin/migrations/0002_add_hashed_password.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_password TEXT;
```

**Action required (user/ops):** Run the migration against the production Neon database manually:
```bash
psql "$DATABASE_URL" -c "ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_password TEXT;"
```
Then restart `webagent-admin` service.

**Evidence:**
- Screenshot: `e2e-output/2026-05-23/02-login-success.png` — shows "Invalid email or password" error
- Service log: `journalctl -u webagent-admin` confirms `column "hashed_password" does not exist`
- Server migration dir: `/opt/webagent/packages/admin/migrations/` — only `0001_add_invite_codes.sql` present

### Phase 2: Agent Creation — NOT RUN (blocked by Phase 1)
### Phase 3: Dashboard Verification — NOT RUN
### Phase 4: Widget Chat — NOT RUN
### Phase 4.5: Workflow Artifact Audit — NOT RUN
### Phase 5: UX Quality Audit — NOT RUN
### Phase 6: Time-to-Value Measurement — NOT RUN

---

## Gate 3: Product-Agent Eval (G-Eval Battery) — NOT RUN

Blocked by Gate 2 failure. No agent was created; embed token was not captured; widget chat could not be tested.

---

## Additional Findings

### FINDING-1: Stale Server Action hashes (LOW severity)

Service logs show repeated `Failed to find Server Action "x"` errors. This occurs when the browser cache holds an older Next.js deployment's action IDs and a new build has been deployed. Not blocking, but indicates the admin service was redeployed without users clearing browser cache. Will self-resolve on hard refresh.

### FINDING-2: Chrome DevTools MCP server disconnected (INFRASTRUCTURE)

The `chrome-devtools` MCP server is not connected (`MCP server 'chrome-devtools' is not connected`). The `DevToolsActivePort` file at `/home/azureuser/.config/google-chrome/DevToolsActivePort` contains a stale WebSocket UUID from a prior Chrome session. Playwright CDP connect (`http://localhost:9222`) works as a fallback.

---

## Required Actions Before MVP

| Priority | Action | Owner |
|---|---|---|
| P0 — BLOCKING | Apply migration `0002_add_hashed_password.sql` to production Neon DB | Ops/Dev |
| P0 — BLOCKING | Create `demo@lamoom.com` user in production DB with hashed password | Ops/Dev |
| P1 | Re-run full Gate 2 + Gate 3 eval after P0 resolved | QA |
| P2 | Fix Chrome DevTools MCP server connectivity for automated eval tooling | Infra |

---

## Screenshots

| File | Description |
|---|---|
| `e2e-output/2026-05-23/01-login.png` | Login page (initial state) |
| `e2e-output/2026-05-23/01b-login-filled.png` | Login page with credentials filled |
| `e2e-output/2026-05-23/02-after-login.png` | Post-submit — redirected back to /login (auth failed) |
| `e2e-output/2026-05-23/02-login-success.png` | Second attempt — "Invalid email or password" error visible |
| `e2e-output/2026-05-23/03-create-textarea-enabled.png` | /create redirect — sent back to login (unauthenticated) |
| `e2e-output/2026-05-23/03a-create-page.png` | /create redirect — login page again |
