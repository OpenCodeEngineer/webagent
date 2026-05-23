# Product-Agent Eval Scorecard

**Agent slug:** NONE (not created — Gate 2 blocked)  
**Agent type:** generic  
**Target URL:** https://example.com  
**Run ID:** mvp-2026-05-23-run2  
**Timestamp:** 2026-05-23T21:30:00Z  
**Judge model:** kimi-k2.5-thinking (Azure AI)  

---

## Status: NOT RUN

Gate 3 evaluation could not be executed because Gate 2 (Authentication / Agent Creation) was blocked by a stale server deployment.

**Blocker:** `Invalid email or password` — admin app on server built from commit `9cb9f75` (pre-fix). The auth fix in commit `a24a680` (which changes bcrypt storage from `accounts.access_token` to `users.hashed_password`) is present in the repo but NOT deployed to the server. DB migration is correctly applied (`users.hashed_password` column exists and populated), but deployed code reads from the wrong column.

No agent was created. No embed token was captured. Widget chat session could not be opened.

**Existing agent on server:** `openclaw-console-0e3d9d31` (openclaw gateway functional, workspace present). Cannot retrieve embed token without authenticated session.

---

## Prompts Queued (not executed)

| # | Category | Prompt |
|---|---|---|
| 1 | Knowledge Recall | What is this website about? |
| 2 | Knowledge Recall | Who is this website for? |
| 3 | Knowledge Recall | How do I contact support? |
| 4 | API Action | (N/A for generic type) |
| 5 | API Action | (N/A for generic type) |
| 6 | Multi-step Reasoning | (N/A for generic type) |
| 7 | Multi-step Reasoning | (N/A for generic type) |
| 8 | Out-of-scope Refusal | What is 2+2? |
| 9 | Out-of-scope Refusal | Can you book me a flight? |
| 10 | Auth-missing Fallback | (N/A for generic type) |
| 11 | Auth-missing Fallback | (N/A for generic type) |
| 12 | Knowledge Recall | What languages does this site support? |

API Action and Auth-missing Fallback prompts pre-marked N/A for generic agent type per test-battery.md.

---

## Composite Score: N/A

**Verdict: NOT_RUN**

---

## Required Action

1. Rebuild and redeploy admin app on server from current branch HEAD:
   ```bash
   cd /opt/webagent && git pull origin fix/remove-openclaw-gateway-service
   cd packages/admin && npm run build
   systemctl restart webagent-admin
   ```
2. Re-run Gate 2 E2E (Phases 1–6): login, create agent for https://example.com, capture agentSlug + embedToken
3. Re-run Gate 3 G-eval battery with captured embedToken
