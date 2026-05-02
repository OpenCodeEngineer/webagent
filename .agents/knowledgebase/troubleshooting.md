# Troubleshooting Reference

## Fast health verification

Run on VM:

```bash
curl -sf http://127.0.0.1:3001/health
curl -sf http://127.0.0.1:3001/health/openclaw
curl -sf http://127.0.0.1:3000/
```

Expected from deploy script gates:

- proxy `/health` returns success
- admin root returns success
- `/health/openclaw` includes `"ok"`

## Service status and logs

```bash
systemctl status openclaw.service webagent-proxy webagent-admin --no-pager
journalctl -u openclaw.service -n 100 --no-pager
journalctl -u webagent-proxy -n 100 --no-pager
journalctl -u webagent-admin -n 100 --no-pager
```

Repo docs also reference remote checks:

```bash
ssh root@78.47.152.177 "journalctl -u openclaw.service --no-pager -n 50"
ssh root@78.47.152.177 "journalctl -u webagent-proxy --no-pager -n 50"
```

## Config and env paths to verify

- App env file: `/opt/webagent/.env`
- OpenClaw config: `/opt/webagent/openclaw/config/openclaw.json5`
- OpenClaw drop-in override: `/etc/systemd/system/openclaw.service.d/override.conf`
- Nginx site (deploy default target): `/etc/nginx/sites-enabled/openclaw`

## Common failure modes and checks

### 1) OpenClaw health fails

Symptoms:

- `http://127.0.0.1:3001/health/openclaw` does not contain `"ok"`

Checks:

```bash
systemctl status openclaw.service --no-pager
journalctl -u openclaw.service -n 100 --no-pager
grep -E 'OPENCLAW_GATEWAY_URL|OPENCLAW_GATEWAY_TOKEN' /opt/webagent/.env
```

Notes from repo docs:

- Avoid mixed service ownership (`openclaw.service` vs repo `openclaw-gateway.service`) as a control-plane conflict.

### 2) Admin login page loads without CSS/JS or returns 404 static assets

Checks/fix:

```bash
bash /opt/webagent/infra/admin-static-sync.sh sync /opt/webagent
systemctl restart webagent-admin
bash /opt/webagent/infra/admin-static-sync.sh check http://127.0.0.1:3000
```

### 3) DB migrations skipped or failed during deploy

Symptoms from deploy output:

- `.env` missing => migrations skipped
- migration command exits non-zero

Checks/fix:

```bash
test -f /opt/webagent/.env && echo "env present"
sudo -u openclaw bash -lc "cd /opt/webagent && set -a && source .env && set +a && pnpm --filter @webagent/proxy db:migrate"
```

### 4) Nginx routing or syntax issues

Checks:

```bash
nginx -t
systemctl reload nginx
```

Confirm routes expected in `infra/nginx/webagent.conf`:

- `/ws`, `/api`, `/widget.js`, `/sso/` -> proxy (`127.0.0.1:3001`)
- `/` -> admin (`127.0.0.1:3000`)

### 5) Full redeploy recovery

From a known-good local checkout:

```bash
bash infra/deploy.sh <host>
```

This is the repo-defined path to re-sync code/config and re-run build/migrations/restarts/health checks.

## Optional model endpoint validation (from docs)

```bash
curl -s -X POST "https://vibe-dev-ai.cognitiveservices.azure.com/openai/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "api-key: ${AZURE_DEV_AI_API_KEY}" \
  -d '{"model":"kimi-k2.5-thinking","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'
```
