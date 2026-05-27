# Decision Log — Task 228 (`--autopilot`)

## 2026-05-26 — D1
- question: Which issue should anchor ownership flow?
- decision: Create new issue `#228` dedicated to deploy external-check rollback behavior.
- reasoning: Existing open issues (`#214`, `#224`, `#225`) are broader or different incident scope; ownership flow needs single clear success metric and artifact lineage.
- alternatives:
  - Reuse `#214`.
  - Reuse PR-only context without issue.
- evidence:
  - `gh issue view 214` shows legacy 502 incident scope.
  - `gh issue list` had no exact issue for current rollback-gate behavior.

## 2026-05-26 — D2
- question: Should deploy fix preserve strict public outage detection while avoiding false rollback?
- decision: Split checks into rollback-eligible runtime checks and non-rollback public check.
- reasoning: Rollback should respond to artifact/runtime regressions, not DNS-path failures that do not imply bad deployed build.
- alternatives:
  - Keep current all-failure rollback.
  - Add `--resolve` fallback.
  - Remove external check.
- evidence:
  - `infra/deploy.sh` currently rolls back admin on any post-check failure.
  - Prior context and PR history indicate `--resolve` fallback can hide real public failures.

## 2026-05-27 — D3
- question: After deploy-check fix passed, why did real E2E still fail on meta-agent create/describe?
- decision: Backport missing runtime fixes from `fix/deploy-external-check` into ownership branch:
  - admin route handler + 300s timeout path,
  - nginx `/api/agents/create-via-meta` timeout route,
  - markerless workspace fallback,
  - validator/python3 alignment + test update,
  - widget selector compatibility for standalone embed test.
- reasoning: Production failures were not from deploy-check logic; they were from divergent code paths between main and previously validated branch where end-to-end flow was already fixed.
- alternatives:
  - Keep scope strictly deploy script/docs and ignore E2E failures.
  - Patch only one symptom (e.g., nginx timeout) and retry repeatedly.
- evidence:
  - E2E logs showed T5/T6 500 and later T10b selector failures.
  - `git show` comparison confirmed required files existed in `fix/deploy-external-check` but not on `origin/main`.
  - Post-backport deploy + E2E produced `14 passed, 0 failed, 1 skipped`.
