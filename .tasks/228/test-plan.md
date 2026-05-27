## Modality
Infra integration test with real deployment + real protocol E2E script.

## Setup
1. Ensure branch contains `infra/deploy.sh` + docs update.
2. Run deployment to target VM: `bash infra/deploy.sh 78.47.152.177`.
3. Load auth secret from VM `.env` for E2E protocol run.

## Steps
1. Execute deploy script from local checkout.
   - expected: deploy completes without triggering rollback block.
2. Verify public and local health checks.
   - expected: `https://dev.lamoom.com/` returns non-5xx, `/health` endpoints pass.
3. Run full E2E protocol test:
   - `bash .agents/skills/test-lamoom/scripts/test-e2e-full.sh https://dev.lamoom.com <AUTH_SECRET>`
   - expected: end-to-end flow passes (meta-agent create, embed token, widget chat).

## Pass criterion
Success metric in `design.md` is met with runtime evidence and `RESULT: pass` in test report.
