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
- Current model: `gpt-5.1` (working)
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
```bash
./infra/deploy.sh
```