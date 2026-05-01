# Deployment Guide

## Hetzner VM

**Hostname/IP:** `78.47.152.177`
**SSH:** `root@78.47.152.177`

### Services
- Proxy: Port 3001
- Admin: Port 3000
- OpenClaw Gateway: Port 18789 (ws://127.0.0.1:18789)

### Config Locations
- OpenClaw config: `/opt/webagent/openclaw/config/openclaw.json5`
- Proxy service: `systemctl restart webagent-proxy`
- Gateway service: `systemctl restart openclaw.service`
- OpenClaw systemd drop-in override: `/etc/systemd/system/openclaw.service.d/override.conf`

### Azure Models
- Endpoint: `${AZURE_DEV_AI_BASE_URL}` → `https://vibe-dev-ai.cognitiveservices.azure.com/openai/v1`
- API Key: `${AZURE_DEV_AI_API_KEY}`
- Current model: `kimi-k2.5-thinking` (working)
- Also available: `kimi-k2.5-thinking` (backup)

### Default Model
Set in `agents.defaults.model` in openclaw.json5:
```json
"model": "azure-openai/kimi-k2.5-thinking"
```

### Troubleshooting
1. Check gateway: `ssh root@78.47.152.177 "journalctl -u openclaw.service --no-pager -n 50"`
2. Check proxy: `ssh root@78.47.152.177 "journalctl -u webagent-proxy --no-pager -n 50"`
3. Test model directly:
   ```bash
   curl -s -X POST "https://vibe-dev-ai.cognitiveservices.azure.com/openai/v1/chat/completions" \
     -H "Content-Type: application/json" \
     -H "api-key: ${AZURE_DEV_AI_API_KEY}" \
     -d '{"model":"kimi-k2.5-thinking","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'
   ```

## Deploy

### Quick redeploy (existing VM)

```bash
# Single canonical redeploy script (safe to rerun on every local code update)
./infra/deploy.sh

# Or target a specific host
./infra/deploy.sh 78.47.152.177
```

### First-time bootstrap on a new VM

```bash
# 1) Copy infra scripts to VM and run setup once
rsync -az ./infra/ root@<new-vm-ip>:/root/webagent-infra/
ssh root@<new-vm-ip> "DOMAIN=myapp.example.com REPO_URL=git@github.com:OpenCodeEngineer/webagent.git APP_DIR=/opt/webagent APP_USER=openclaw bash /root/webagent-infra/setup.sh"

# 2) Deploy current local repo state (repeat this whenever code changes)
./infra/deploy.sh <new-vm-ip>
```

**Env vars for targeting a different VM:**

| Variable | Default | Purpose |
|---|---|---|
| `DEPLOY_HOST` | `78.47.152.177` | VM IP or hostname |
| `DEPLOY_USER` | `root` | SSH user |
| `APP_DIR` | `/opt/webagent` | App directory on VM |
| `APP_USER` | `openclaw` | OS user that owns the app (setup only) |
| `DOMAIN` | `webagent.example.com` | Public domain (setup / TLS) |
| `REPO_URL` | GitHub HTTPS URL | Git clone URL (setup only) |

### GitHub Actions

The workflow (`.github/workflows/deploy.yml`) runs automatically on push to `main` or via manual dispatch. It calls `infra/deploy.sh` directly — no changes needed. Secrets required:

- `VM_SSH_KEY` — private SSH key for the VM
- `VM_HOST` — VM IP or hostname

To retarget the workflow to a different VM, update the `VM_HOST` secret in the repo settings.

### Scripts

```bash
# Canonical redeploy script
./infra/deploy.sh [host]

# One-time bootstrap script (run on VM as root)
DOMAIN=myapp.example.com REPO_URL=git@github.com:OpenCodeEngineer/webagent.git bash /path/to/infra/setup.sh
```

### Service ownership

- OpenClaw base unit (`openclaw.service`) is installed/owned by OpenClaw runtime tooling.
- This repo must only apply drop-in overrides under `openclaw.service.d/`.
- Do not maintain a competing gateway unit as the primary runtime owner.
