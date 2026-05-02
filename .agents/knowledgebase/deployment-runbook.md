# Deployment Runbook

## Canonical deploy path

- Primary script: `infra/deploy.sh`
- Purpose: sync local repo state to VM with `rsync`, rebuild, run migrations, apply OpenClaw drop-in override, restart services, and run health checks.
- Default target host in script: `78.47.152.177`

## Preconditions

- Local machine has `ssh` and `rsync` (checked by script).
- Remote app directory exists or can be created (default `/opt/webagent`).
- Remote has a valid `/opt/webagent/.env` when DB migrations are required.

## Standard deployment commands

```bash
# Deploy to default host (from script defaults)
bash infra/deploy.sh

# Deploy to a specific host
bash infra/deploy.sh <host>

# Deploy with explicit env overrides
DEPLOY_USER=root APP_DIR=/opt/webagent bash infra/deploy.sh <host>
```

## What deploy.sh does (ordered)

1. Preserves runtime OpenClaw config backup from `/opt/webagent/openclaw/config/openclaw.json5`.
2. `rsync`s repo content to `/opt/webagent` (excludes `.env`, `node_modules`, build caches, and `openclaw/workspaces/`).
3. Separately syncs `openclaw/workspaces/meta/`.
4. Merges runtime-registered OpenClaw agents from backup config into synced config.
5. Runs `pnpm install` and `pnpm build` as user `openclaw`.
6. Applies systemd drop-in from `infra/systemd/openclaw.service.d/override.conf` to `/etc/systemd/system/openclaw.service.d/override.conf`.
7. Syncs admin static assets with `infra/admin-static-sync.sh sync`.
8. Runs DB migration (`pnpm --filter @webagent/proxy db:migrate`) if `.env` exists.
9. Patches Nginx site (if present) for `/api/auth/`, `/sso/`, and API timeouts; then reloads Nginx.
10. Restarts `openclaw.service`, `webagent-proxy`, `webagent-admin`.
11. Runs health checks:
   - `http://127.0.0.1:3001/health`
   - `http://127.0.0.1:3000/`
   - `http://127.0.0.1:3001/health/openclaw` contains `"ok"`
   - `infra/admin-static-sync.sh check http://127.0.0.1:3000`

## First-time VM bootstrap

- One-time setup script: `infra/setup.sh` (run on VM as root).
- It installs system deps, Node 24, pnpm, clones repo, creates `.env` from `.env.example` if missing, builds, migrates DB, installs Nginx config, requests certbot cert, installs `webagent-admin`/`webagent-proxy` units, installs OpenClaw drop-in override, enables services, and configures firewall.

Example from repo docs:

```bash
rsync -az ./infra/ root@<new-vm-ip>:/root/webagent-infra/
ssh root@<new-vm-ip> "DOMAIN=myapp.example.com REPO_URL=git@github.com:OpenCodeEngineer/webagent.git APP_DIR=/opt/webagent APP_USER=openclaw bash /root/webagent-infra/setup.sh"
```

## GitHub Actions deployment

- Workflow: `.github/workflows/deploy.yml`
- Trigger: push to `main` or manual dispatch.
- Behavior: runs `bash infra/deploy.sh "${VM_HOST}"`.
- Required secrets:
  - `VM_SSH_KEY`
  - `VM_HOST`

## Recovery / rollback options from current scripts

- Re-run `infra/deploy.sh` from a known-good local checkout to restore full app state.
- If only admin static assets are broken, run:

```bash
bash infra/admin-static-sync.sh sync /opt/webagent
systemctl restart webagent-admin
bash infra/admin-static-sync.sh check http://127.0.0.1:3000
```

- If Nginx config edits fail during deploy, validate and reload manually:

```bash
nginx -t
systemctl reload nginx
```
