# OpenClaw CLI — Sessions

Source: https://docs.openclaw.ai/cli/sessions

Use this as the local quick reference for session listing and maintenance.

## List sessions

```bash
openclaw sessions
openclaw sessions --agent work
openclaw sessions --all-agents
openclaw sessions --active 120
openclaw sessions --verbose
openclaw sessions --json
```

Scope options:
- default: configured default agent store
- `--agent <id>`: one configured agent store
- `--all-agents`: aggregate all configured agent stores
- `--store <path>`: explicit store path (cannot be combined with `--agent` or `--all-agents`)

## Cleanup / maintenance

```bash
openclaw sessions cleanup --dry-run
openclaw sessions cleanup --agent work --dry-run
openclaw sessions cleanup --all-agents --dry-run
openclaw sessions cleanup --enforce
openclaw sessions cleanup --enforce --active-key "agent:main:telegram:direct:123"
openclaw sessions cleanup --json
```

Useful flags:
- `--dry-run`: preview prunes/caps without writing
- `--enforce`: apply cleanup even when maintenance mode is `warn`
- `--fix-missing`: drop entries whose transcript files are missing
- `--active-key <key>`: protect one active key from disk-budget eviction
- `--json`: structured summary (per-store summaries when using `--all-agents`)

## Important note

`openclaw sessions cleanup` maintains session stores/transcripts only.
It does **not** prune cron run logs.

## Related
- Agent CLI quick reference: `docs/openclaw/agetns.md`
- OpenClaw docs: https://docs.openclaw.ai/cli/sessions
