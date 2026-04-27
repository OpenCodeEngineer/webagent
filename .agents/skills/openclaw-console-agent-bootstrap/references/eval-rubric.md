# Console Navigation Eval Rubric

## Prompts
1. how to use console
2. how billing works
3. how to deploy

## Deterministic scoring (1-5)
- +1 Uses concrete navigation/action verbs (open, click, go to, navigate)
- +1 Includes canonical route/link context
- +1 Concise but complete (15-180 words)
- +2 Prompt-specific coverage:
  - Console usage: dashboard/tenants/settings/agent navigation
  - Billing: billing + topup/plan/payment/invoice/crypto
  - Deploy: deploy/deployment + steps/command/environment/configure/publish

## Pass/Fail
- Default pass threshold: >= 3 per prompt
- Any prompt below threshold => overall FAIL (non-zero exit)

## Expected answer qualities
- Command-centric: clear sequence of actions
- Link-first: includes canonical route or URL
- Product-grounded: references OpenClaw Console features, not generic advice
- Safe and factual: no fabricated credentials or hidden/internal secrets
