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
