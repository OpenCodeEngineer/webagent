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

### Deploy
**IMPORTANT:** Commit local changes first, otherwise they will be lost!
```bash
git add . && git commit -m "nginx: allow localhost for gateway web fetch"
./infra/deploy.sh
```

## Azure Models
- Endpoint: `https://vibe-dev-ai.cognitiveservices.azure.com/openai/v1`
- Current: `gpt-5.1`
- Backup: `kimi-k2.5-thinking`

## Common Issues

### OpenClaw gateway can't fetch dev.lamoom.com
- **Symptom:** Meta-agent responds but says "can't fetch dev.lamoom.com"
- **Cause:** Nginx blocks localhost requests (gateway uses public URL)
- **Fix:** Add localhost allow rule in `infra/nginx/webagent.conf`:
  ```
  location / {
      allow 127.0.0.1;
      allow ::1;
      deny all;
      proxy_pass http://admin_upstream;
  }
  ```

### Azure 500 errors
- Try different model (kimi-k2.5-thinking)
- Check Azure status