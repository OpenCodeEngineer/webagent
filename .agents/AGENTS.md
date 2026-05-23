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

## Testing — what "test" actually means

**"Test" = end-to-end browser test, not curl.** A `curl` against an endpoint proves the TCP socket and HTTP layer respond. It does NOT prove the site works. The site can return HTTP 200/307 while the app crashes mid-render, the CPU is pegged by a cryptominer, JS fails to hydrate, login is broken, or the agent flow is broken.

When asked to "test the deployment" or "verify it works", you MUST:

1. **Open a browser** (use chrome-devtools MCP tools or Playwright) and navigate to `https://dev.lamoom.com/`
2. **Log in** through the actual login flow (Google/GitHub/email — whichever is wired up)
3. **Create a new product-agent** via the meta-agent — use the `create-agent` skill (the meta-agent workspace owns this)
4. **Verify the embed code is generated** and the new agent appears in `/dashboard`
5. **Open the new agent's widget** and exchange at least one message — confirm the response renders

If any of those steps fails, the deployment is NOT working. Reporting "site is up" based on curl is wrong and has burned us before. Do not declare a deploy done until the full E2E flow above completes in a real browser.

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