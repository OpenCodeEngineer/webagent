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

## Service ownership

OpenClaw gateway runs as a **user-level systemd service** owned by the official OpenClaw installer:

- Install: `openclaw gateway install --port 18789 --force` (as `openclaw` user)
- Service: `openclaw-gateway.service` (user-level, at `~/.config/systemd/user/`)
- Manage: `sudo -u openclaw bash -lc "export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user {start|stop|restart|status} openclaw-gateway.service"`
- Prerequisites: `loginctl enable-linger openclaw` (persists user services across logins)

Do **not** create a system-level `openclaw.service` — the official installer owns the gateway lifecycle.

## Patch model (systemd drop-ins)

Use systemd drop-ins for repo-controlled customizations (config path, env file):

- Repo source: `infra/systemd/openclaw.service.d/override.conf`
- Host path: `~openclaw/.config/systemd/user/openclaw-gateway.service.d/override.conf`
- Deploy script applies this automatically.

This keeps OpenClaw's base unit replaceable by OpenClaw updates while preserving our environment wiring.
