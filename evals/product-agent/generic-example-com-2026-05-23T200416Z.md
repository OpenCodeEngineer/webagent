# Product-Agent Eval Scorecard

**Agent slug:** NONE (not created — Gate 2 blocked)  
**Agent type:** generic  
**Target URL:** https://example.com  
**Run ID:** mvp-2026-05-23  
**Timestamp:** 2026-05-23T20:04:16Z  
**Judge model:** kimi-k2.5-thinking (Azure AI)  

---

## Status: NOT RUN

Gate 3 evaluation could not be executed because Gate 2 (Authentication / Agent Creation) was blocked by a critical production infrastructure issue.

**Blocker:** `column "hashed_password" does not exist` — migration `0002_add_hashed_password.sql` not applied to production Neon database.

No agent was created. No embed token was captured. Widget chat session could not be opened.

---

## Prompts Queued (not executed)

| # | Category | Prompt |
|---|---|---|
| 1 | Knowledge Recall | What is this website about? |
| 2 | Knowledge Recall | Who is this website for? |
| 3 | Knowledge Recall | How do I contact support? |
| 8 | Out-of-scope Refusal | What is 2+2? |

API Action and Auth-missing Fallback prompts were pre-marked N/A for generic agent type per test-battery.md.

---

## Composite Score: N/A

**Verdict: NOT_RUN**

---

## Required Action

1. Apply migration: `ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_password TEXT;`
2. Create demo user with hashed password in production DB
3. Re-run full eval: `product-agent-eval` skill
