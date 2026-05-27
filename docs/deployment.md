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
- Gateway service: `sudo -u openclaw bash -lc "export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user restart openclaw-gateway.service"`
- OpenClaw systemd drop-in override: `~openclaw/.config/systemd/user/openclaw-gateway.service.d/override.conf`

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
1. Check gateway: `ssh root@78.47.152.177 "sudo -u openclaw bash -lc 'export XDG_RUNTIME_DIR=/run/user/$(id -u); journalctl --user -u openclaw-gateway.service --no-pager -n 50'"`
2. Check proxy: `ssh root@78.47.152.177 "journalctl -u webagent-proxy --no-pager -n 50"`
3. Test model directly:
   ```bash
   curl -s -X POST "https://vibe-dev-ai.cognitiveservices.azure.com/openai/v1/chat/completions" \
     -H "Content-Type: application/json" \
     -H "api-key: ${AZURE_DEV_AI_API_KEY}" \
     -d '{"model":"kimi-k2.5-thinking","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'
   ```

## DNS (BIND9)

DNS for `dev.lamoom.com` is self-hosted on the VM using BIND9.

### Local repo config

```
infra/bind/
├── named.conf.local       # Zone declaration + certbot TSIG key include
├── named.conf.options      # BIND options (dnssec, listen addresses)
└── zones/
    └── dev.lamoom.com.db   # Zone file (A, NS, wildcard records)
```

The deploy script (`infra/deploy.sh`) copies these files to `/etc/bind/` on the VM.

### certbot-key.conf

`named.conf.local` includes `/etc/bind/certbot-key.conf` for DNS-01 ACME challenges. This file contains a TSIG secret and is **generated on the VM** (not stored in the repo). If it is missing, BIND9 will fail to start.

Generate it manually:
```bash
ssh root@78.47.152.177 'tsig-keygen certbot-key > /etc/bind/certbot-key.conf && chmod 640 /etc/bind/certbot-key.conf && chown root:bind /etc/bind/certbot-key.conf'
```

### Route 53 NS delegation (required)

The parent domain `lamoom.com` is hosted on AWS Route 53. For the self-hosted BIND9 to work, Route 53 **must** have delegation records pointing `dev.lamoom.com` to the VM:

| Name | Type | Value |
|---|---|---|
| `dev.lamoom.com` | NS | `ns1.dev.lamoom.com.` |
| `ns1.dev.lamoom.com` | A | `78.47.152.177` |

Without these records, public DNS resolvers cannot find `dev.lamoom.com`.

### Troubleshooting DNS

```bash
# Check BIND9 status on VM
ssh root@78.47.152.177 "systemctl status named --no-pager"

# Check BIND9 logs
ssh root@78.47.152.177 "journalctl -u named --no-pager -n 30"

# Query the VM directly
dig dev.lamoom.com @78.47.152.177 A +short

# Query public DNS (should return 78.47.152.177 if delegation is correct)
dig dev.lamoom.com @8.8.8.8 A +short

# Validate zone file
named-checkzone dev.lamoom.com infra/bind/zones/dev.lamoom.com.db
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

### Deploy checks and rollback boundary

- `infra/deploy.sh` runs runtime integrity checks on the VM (local health endpoints, static asset check, OpenClaw health).
- These VM runtime checks are rollback-eligible: if they fail, admin rollback is attempted on the VM.
- Public availability is then checked from the deploy orchestrator context (`https://${DOMAIN}/`), not from inside the VM.
- If the public check fails, the deploy exits non-zero, but it does **not** trigger admin rollback.

### Service ownership

- OpenClaw gateway unit (`openclaw-gateway.service`) is installed/owned by OpenClaw runtime tooling as a user-level systemd service.
- This repo must only apply drop-in overrides under `openclaw-gateway.service.d/` in the app user's systemd directory.
- Do not maintain a competing system-level `openclaw.service` owner for the same gateway lifecycle.
