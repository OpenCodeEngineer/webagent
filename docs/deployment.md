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
- Gateway service: `systemctl restart openclaw-gateway`

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
1. Check gateway: `ssh root@78.47.152.177 "journalctl -u openclaw-gateway --no-pager -n 50"`
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
# Uses defaults: host=78.47.152.177, user=root, app_dir=/opt/webagent
./infra/vm-deploy.sh deploy

# Or target a specific host
./infra/vm-deploy.sh deploy 78.47.152.177
```

### First-time bootstrap on a new VM

```bash
# Installs packages, clones repo, nginx, TLS cert, systemd services, then deploys
DOMAIN=myapp.example.com \
REPO_URL=git@github.com:OpenCodeEngineer/webagent.git \
  ./infra/vm-deploy.sh bootstrap-deploy <new-vm-ip>

# Bootstrap only (no code sync yet)
DOMAIN=myapp.example.com ./infra/vm-deploy.sh bootstrap <new-vm-ip>
```

**Env vars for targeting a different VM:**

| Variable | Default | Purpose |
|---|---|---|
| `DEPLOY_HOST` | `78.47.152.177` | VM IP or hostname |
| `DEPLOY_USER` | `root` | SSH user |
| `APP_DIR` | `/opt/webagent` | App directory on VM |
| `APP_USER` | `openclaw` | OS user that owns the app |
| `DOMAIN` | `webagent.example.com` | Public domain (bootstrap / TLS) |
| `REPO_URL` | GitHub HTTPS URL | Git clone URL (bootstrap only) |

### GitHub Actions

The workflow (`.github/workflows/deploy.yml`) runs automatically on push to `main` or via manual dispatch. It calls `infra/deploy.sh` directly — no changes needed. Secrets required:

- `VM_SSH_KEY` — private SSH key for the VM
- `VM_HOST` — VM IP or hostname

To retarget the workflow to a different VM, update the `VM_HOST` secret in the repo settings.

### Low-level scripts (still work unchanged)

```bash
# Direct deploy (original entrypoint, still supported)
./infra/deploy.sh [host]

# Manual bootstrap (run directly on the VM as root)
DOMAIN=myapp.example.com bash /path/to/infra/setup.sh
```