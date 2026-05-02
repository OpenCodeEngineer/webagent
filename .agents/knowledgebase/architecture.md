# WebAgent Operations Architecture

## Scope

This document describes the runtime architecture as defined by repo docs and infra files.

## Monorepo layout

- Workspace manager: `pnpm` workspaces (`pnpm-workspace.yaml`)
- Packages:
  - `packages/admin` (`@webagent/admin`) - Next.js admin UI
  - `packages/proxy` (`@webagent/proxy`) - Fastify proxy/API
  - `packages/widget` (`@webagent/widget`) - widget bundle
  - `packages/shared` (`@webagent/shared`) - shared types/protocol

## Runtime topology (single VM)

- Admin UI listens on `127.0.0.1:3000` (`infra/systemd/webagent-admin.service`)
- Proxy listens on `127.0.0.1:3001` (`infra/systemd/webagent-proxy.service`)
- OpenClaw gateway endpoint expected at `ws://127.0.0.1:18789` (`.env.example`)
- Public entrypoint is Nginx, with:
  - `/` -> admin upstream (`127.0.0.1:3000`)
  - `/api`, `/ws`, `/widget.js`, `/sso/` -> proxy upstream (`127.0.0.1:3001`)

## Service ownership and control plane

- Repo docs state OpenClaw base unit is OpenClaw-owned (`openclaw.service`) and repo should only manage drop-ins under `openclaw.service.d/`.
- Repo-managed override source: `infra/systemd/openclaw.service.d/override.conf`
- Host override destination used by scripts: `/etc/systemd/system/openclaw.service.d/override.conf`
- Override injects:
  - `EnvironmentFile=-${APP_DIR}/.env`
  - `OPENCLAW_CONFIG_PATH=${APP_DIR}/openclaw/config/openclaw.json5`

## Noted repo-level service definitions

- `infra/systemd/openclaw-gateway.service` exists and starts `pnpm --filter @openclaw/gateway start`.
- `infra/systemd/webagent-proxy.service` includes `Requires=openclaw-gateway.service`.
- `infra/setup.sh` enables `openclaw.service`, `webagent-proxy`, and `webagent-admin` (it does not install/enable `openclaw-gateway.service`).
- `docs/openclaw.md` warns against running competing OpenClaw service ownership models simultaneously.

## Key operational paths

- App root on VM (default): `/opt/webagent`
- Project env: `/opt/webagent/.env`
- OpenClaw config: `/opt/webagent/openclaw/config/openclaw.json5`
- Nginx site template in repo: `infra/nginx/webagent.conf`
- Nginx site path targeted by deploy script: `/etc/nginx/sites-enabled/openclaw` (override via `NGINX_SITE_PATH`)

## Optional sidecar (separate flow)

- `infra/librechat/` contains Docker Compose deployment for LibreChat (`:3080`) and MongoDB.
- This is separate from the core systemd-based admin/proxy/OpenClaw runtime.
