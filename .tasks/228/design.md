## Problem / Goal / Success Metric

### Problem
Deploy can rollback `webagent-admin` even when proxy/admin/openclaw are healthy if VM-side resolver chain cannot resolve `dev.lamoom.com` during final external check. This causes partial rollback and stale admin artifacts.

### Goal
Keep deploy gate strict for real public outages while preventing false rollback when runtime is healthy and failure is resolver-local.

### Success Metric
Merged fix is proven in production:
1. Deploy completes without rollback for healthy runtime.
2. `https://dev.lamoom.com/` and health endpoints are reachable via public path.
3. Full MVP flow works post-deploy (meta-agent create -> embed token -> widget chat response).

## Current State
- `infra/deploy.sh` couples local runtime checks and external public-url check in one function (`run_post_deploy_checks`), and any failure triggers `rollback_admin_service`.
- External check currently executes from inside remote VM deploy context over SSH, so VM-local resolver anomalies can trip deploy gate even when user path is fine.
- Rollback logic restores admin artifact/unit only, which can create mixed-version runtime when trigger cause is DNS/network and not admin bundle quality.
- CI deploy workflow (`.github/workflows/deploy.yml`) runs `bash infra/deploy.sh "$VM_HOST"`, so deploy gate behavior directly controls production rollout outcome.

## Proposed Design
1. Split post-deploy verification into two classes:
   - **Runtime integrity checks (remote, rollback-eligible):** local health endpoints, static asset check, OpenClaw health from VM.
   - **Public availability check (orchestrator-side, non-rollback):** curl `https://${DOMAIN}/` from machine executing `infra/deploy.sh` after remote deploy succeeds.
2. Keep rollback only for runtime integrity failures (signals likely caused by newly deployed admin/proxy bits).
3. If public availability check fails, return non-zero to fail deploy, but do not rollback admin artifacts.
4. Improve operator diagnostics on public check failure so DNS/firewall/TLS issues are actionable.

This preserves hard fail for real outages while removing false rollback path caused by VM-only resolver behavior.

## Alternatives Considered
1. Keep remote-only check and add `--resolve` fallback.
   - Rejected: prior outage showed fallback can mask real public DNS breakage and produce false green.
2. Disable external check entirely.
   - Rejected: would remove critical signal for real public outages.
3. Keep rollback on all failures but add DNS heuristics.
   - Rejected: still couples unrelated failure domain (public DNS) to admin artifact rollback and risks stale bundle restore.

## Risks & Open Questions
- Risk: deploy can now fail after remote success due orchestrator network path issues.
  - Mitigation: explicit diagnostic output; rerunnable deploy; no destructive rollback side effect.
- Risk: operators may expect rollback on every failure.
  - Mitigation: log clearly that public-check failures are non-rollback by design.
- Open question: should we add optional second public vantage probe (for local manual deploys)?
  - Decision: defer; current change addresses known VM-resolver failure mode with minimal blast radius.

## Touched Surface
- `infra/deploy.sh`
- `.tasks/228/*` artifacts (design/plan/review/test/verify/state/worklog/decisions)

## Out of Scope
- Broad DNS infrastructure redesign.
- Non-deploy admin/proxy feature changes.
