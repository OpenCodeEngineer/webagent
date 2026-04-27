# OpenClaw CLI — Agents

Source: https://docs.openclaw.ai/cli/agents

Use this as the local quick reference for agent lifecycle and routing bindings.

## Core commands

```bash
openclaw agents list
openclaw agents list --bindings
openclaw agents add work --workspace ~/.openclaw/workspace-work
openclaw agents bind --agent work --bind telegram:ops
openclaw agents unbind --agent work --bind telegram:ops
openclaw agents bindings
openclaw agents delete work
```

## Add agent (non-interactive)

```bash
openclaw agents add <name> --workspace <dir> --non-interactive
```

Notes:
- `main` is reserved and cannot be used as a new agent id.
- Non-interactive add requires both `name` and `--workspace`.

## Routing bindings

Use bindings to pin inbound channel traffic to a specific agent.

```bash
openclaw agents bind --agent work --bind telegram:ops --bind discord:guild-a
openclaw agents unbind --agent work --bind telegram:ops
openclaw agents unbind --agent work --all
```

Binding behavior (important):
- A binding without `accountId` targets the channel default account.
- `accountId: "*"` is a less-specific channel-wide fallback.
- If a channel-only binding exists and you bind a specific account, OpenClaw upgrades that binding in place.

## List bindings

```bash
openclaw agents bindings
openclaw agents bindings --agent work
openclaw agents bindings --json
```

## Delete agent

```bash
openclaw agents delete <id>
openclaw agents delete <id> --force
```

Notes:
- `main` cannot be deleted.
- Workspace/state/transcripts are moved to Trash (not hard-deleted).

## Identity management

```bash
openclaw agents set-identity --workspace ~/.openclaw/workspace --from-identity
openclaw agents set-identity --agent main --name "OpenClaw" --emoji "🦞" --avatar avatars/openclaw.png
```

Identity fields written to config:
- `name`
- `theme`
- `emoji`
- `avatar`

## Related
- Sessions CLI quick reference: `docs/opencalw/sessions.md`
- OpenClaw docs: https://docs.openclaw.ai/cli/agents
