# OpenClaw Install And Service Notes

This project runs OpenClaw on a single VM. Use OpenClaw's official installer guidance as the source of truth:

- Install docs: `https://docs.openclaw.ai/install`
- Source code: `https://github.com/openclaw/openclaw`

## Official install options (from OpenClaw docs)

- Recommended script (Linux/macOS/WSL):
  - `curl -fsSL https://openclaw.ai/install.sh | bash`
- If onboarding should be skipped in automation:
  - `curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard`
- Package-manager install also supported:
  - `npm install -g openclaw@latest`
  - then `openclaw onboard --install-daemon`

## Verify install

```bash
openclaw --version
openclaw doctor
openclaw gateway status
```

## Important for this repo

- Do not assume Docker/LibreChat for MVP runtime validation.
- Current architecture is single-VM systemd services:
  - `webagent-admin` (system-level)
  - `webagent-proxy` (system-level)
  - OpenClaw gateway (user-level, managed by OpenClaw CLI)

## Gateway service ownership

The OpenClaw CLI **owns the gateway systemd unit entirely**. Do not create or patch it manually.

### How `openclaw gateway install` works

Source: `src/daemon/systemd-unit.ts` and `src/daemon/systemd.ts` in the OpenClaw repo.

1. **Writes a user-level systemd unit** to `~/.config/systemd/user/<service-name>.service`
2. **Writes an env file** to `<stateDir>/gateway.systemd.env` (mode 0600) from `~/.openclaw/.env`
3. **If the unit already exists**: backs up to `<unit>.bak`, then **overwrites** with fresh content
4. **After writing**: runs `systemctl --user daemon-reload`, `enable`, and `restart`

The generated unit uses `Type=simple`, `Restart=always`, `RestartSec=5`, `KillMode=control-group`,
`StartLimitBurst=5`, `StartLimitIntervalSec=60`. ExecStart points to the OpenClaw runtime node process.

### Do NOT use systemd drop-ins or overrides

The OpenClaw CLI regenerates the unit file on `gateway install`. Any drop-in overrides
(`openclaw-gateway.service.d/override.conf`) risk conflicting with the generated unit and
are not preserved across OpenClaw upgrades. Instead:

- **Environment variables**: Add them to `~/.openclaw/.env` — the CLI reads this and writes
  them into `gateway.systemd.env` which the unit loads via `EnvironmentFile=`.
- **Config path**: Set `OPENCLAW_CONFIG_PATH` in `~/.openclaw/.env`.
- **App env vars**: Source the app `.env` from `~/.openclaw/.env` or merge needed vars into it.

### Managing the gateway

```bash
# Install/reinstall (as openclaw user):
openclaw gateway install --port 18789

# Status:
openclaw gateway status

# Manual systemctl (when needed):
sudo -u openclaw bash -lc \
  "export XDG_RUNTIME_DIR=/run/user/\$(id -u); \
   systemctl --user {start|stop|restart|status} openclaw-gateway.service"
```

Prerequisites: `loginctl enable-linger openclaw` (persists user services across logins).

### OpenClaw config

Runtime config lives at the path set by `OPENCLAW_CONFIG_PATH`. For this project:
`/opt/webagent/openclaw/config/openclaw.json5`.

The OpenClaw state directory is `~/.openclaw/` which contains:
- `openclaw.json` — runtime state/config managed by OpenClaw
- `.env` — environment vars that get written into `gateway.systemd.env`
- `gateway.systemd.env` — generated env file loaded by the systemd unit
- `agents/` — agent data
- `workspace/` — agent workspaces
