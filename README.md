# webagent

Monorepo scaffold for the Web MCP Agent platform (proxy gateway, shared protocol/types, and OpenClaw workspaces).

## Setup

1. Install dependencies:
   - `pnpm install`
2. Copy env template:
   - `cp .env.example .env`
3. Build packages:
   - `pnpm --filter @webagent/shared build`
   - `pnpm --filter @webagent/proxy build`
4. Start development tasks:
   - `pnpm dev`

## Deploy from local repo state

Use the deploy script when you need VM state to match your current local repository (including `openclaw/` files, workspaces, templates, and agent scaffolding):

```bash
bash infra/deploy.sh dev.lamoom.com
```

The script syncs local files with `rsync`, preserves remote `.env`, merges runtime-registered OpenClaw agents back into the synced config, rebuilds, migrates, restarts services, and runs health checks.
