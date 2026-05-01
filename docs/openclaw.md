# OpenClaw Install And Service Notes

This project runs OpenClaw on a single VM. Use OpenClaw's official installer guidance as the source of truth:

- Install docs: `https://docs.openclaw.ai/install`

## Official install options (from OpenClaw docs)

- Recommended script (Linux/macOS/WSL):
  - `curl -fsSL https://openclaw.ai/install.sh | bash`
- If onboarding should be skipped in automation:
  - `curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard`
- Package-manager install also supported:
  - `npm install -g openclaw@latest`
  - then `openclaw onboard --install-daemon`

## Verify install

Run:

```bash
openclaw --version
openclaw doctor
openclaw gateway status
```

## Important for this repo

- Do not assume Docker/LibreChat for MVP runtime validation.
- Current architecture is single-VM systemd services:
  - `webagent-admin`
  - `webagent-proxy`
  - OpenClaw gateway service
- Runtime OpenClaw config path remains:
  - `/opt/webagent/openclaw/config/openclaw.json5`

## Service ownership caveat

On this VM, there are currently two service definitions related to OpenClaw:

- `openclaw.service` (OpenClaw-managed service under `/etc/systemd/system/openclaw.service`)
- `openclaw-gateway.service` (repo/infra-managed service)

Do not run both as competing sources of truth. Pick one owner for gateway lifecycle. Recommended: prefer OpenClaw's installed service model and keep project docs/scripts aligned to that choice.

## Ops guideline

- If using OpenClaw-managed daemon: operate via OpenClaw install/onboard flow and `openclaw.service`.
- If using repo-managed gateway unit: ensure deployment/setup scripts, health gates, and docs all target only that unit.
- Avoid mixed control planes because they can leave a healthy gateway process while one of the units reports inactive/failed.
