# Agent Knowledge Base

## Deployment

### Hetzner VM
- **IP:** 78.47.152.177
- **SSH:** `root@78.47.152.177`
- **Config:** `/opt/webagent/openclaw/config/openclaw.json5`

### Services
- Proxy: Port 3001
- Admin: Port 3000  
- OpenClaw Gateway: Port 18789

### Deploy Workflow (IMPORTANT)
**NEVER hot-patch the VM directly!** Always modify local files first, commit, then deploy.

1. **Modify local files** in this repo:
   - Config: `openclaw/config/openclaw.json5` (model settings)
   - Nginx: `infra/nginx/webagent.conf` (proxy settings)

2. **Commit changes:**
   ```bash
   git add . && git commit -m "description of changes"
   ```

3. **Deploy to VM:**
   ```bash
   ./infra/deploy.sh
   ```

4. **Verify** the changes were applied on VM

## Azure Models
- Endpoint: `https://vibe-dev-ai.cognitiveservices.azure.com/openai/v1`
- Current: `kimi-k2.5-thinking` (better agentic reasoning, cheaper)
- Backup: `gpt-5.1`

## Common Issues

### OpenClaw gateway can't fetch dev.lamoom.com
- **Symptom:** Meta-agent responds but says "can't fetch dev.lamoom.com"
- **Cause:** Nginx blocks requests when using "deny all" directive
- **Fix:** Add localhost allow WITHOUT deny all in `infra/nginx/webagent.conf`:
  ```nginx
  location / {
      allow 127.0.0.1;
      proxy_pass http://admin_upstream;
  }
  ```
  Note: Do NOT add "deny all" - it will block all users!

### Azure 500 errors
- Try different model (kimi-k2.5-thinking)
- Check Azure status