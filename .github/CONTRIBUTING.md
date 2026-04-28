# Contributing

## Branch policy

**All changes to `main` must go through a pull request.** Direct pushes to `main` are blocked by branch protection.

- Create a feature or fix branch from `main`
- Open a PR; no approving review is required for solo work, but the PR record is mandatory
- Merge via squash to keep history linear

## Commit messages

Follow the conventional commit format:

```
<type>: <short description>

Types: feat | fix | chore | docs | refactor | test
```

## Deployment

After merging to `main`:

1. SSH to `root@78.47.152.177`
2. `cd /opt/webagent && git pull origin main`
3. Rebuild the affected package: `cd packages/proxy && pnpm build`
4. Restart the service: `systemctl restart webagent-proxy`

Services: `openclaw-gateway`, `webagent-proxy`, `webagent-admin` — all managed by systemd.

## History note

Commit `9fe4f6d` ("fix: correct markdown rendering in widget chat") was pushed directly to `main` on 2026-04-27 before branch protection was in place. A clean `git revert` is not possible because PR #152 modified the same lines. Branch protection has been enabled since 2026-04-28 to prevent recurrence.
