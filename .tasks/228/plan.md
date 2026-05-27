## Approach Summary
Decouple deploy verification domains. Keep remote runtime checks as rollback gate, then run public URL verification from deploy orchestrator context as non-rollback gate. This preserves strict outage detection without restoring stale admin artifacts for resolver-local failures.

## Tradeoff: Speed vs Quality
- chosen: balanced
- rationale: change is infra-critical and small; need high confidence with real deploy/e2e verification, but no broad refactor.

## Tasks
| # | Title | Files | Depends on | Parallel group | Suggested model |
|---|-------|-------|------------|----------------|-----------------|
| 1 | Split deploy checks and rollback gate | `infra/deploy.sh` | - | A | gpt-5.1-codex |
| 2 | Update deploy docs for new check semantics | `docs/deployment.md` | - | A | haiku |
| 3 | Run runtime verification (deploy + E2E) and capture artifacts | `.tasks/228/test-report.md`, `.tasks/228/verify.md` | 1,2 | B | sonnet |

## Parallel Groups
- **A** (independent): 1, 2
- **B**: 3 after A

## Done Criteria
- Task 1: `infra/deploy.sh` runs remote rollback only on runtime-integrity failures; public URL check runs outside remote rollback path; script passes `bash -n infra/deploy.sh`.
- Task 2: `docs/deployment.md` explicitly documents rollback boundary and public-check location.
- Task 3: Real deploy run + full E2E test evidence captured with explicit pass/fail and final prod verdict.

## Rollback Plan
1. Revert `infra/deploy.sh` + docs commit.
2. Redeploy from known-good commit using `bash infra/deploy.sh`.
3. Confirm `webagent-admin`, `webagent-proxy`, and `openclaw` health endpoints return expected status.
