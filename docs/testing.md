# HubSpot Testing Protocol

This is the canonical test flow for HubSpot validation in this repo.

## Scope

Validate the real customer journey end-to-end:

1. Create a HubSpot-capable product-agent via the meta-agent on `dev.lamoom.com`.
2. Inject and run the widget inside HubSpot browser context.
3. Execute 3 CRM scenarios through widget chat only.
4. Score outputs with evaluator sessions.

This protocol is black-box for CRM actions. Scenario actions must happen through widget chat responses, not direct HubSpot API calls.

## Terminology

- **Meta-agent**: the agent behind `https://dev.lamoom.com/create` that discovers requirements and creates new agents.
- **Product-agent**: the generated runtime agent (for this flow: HubSpot product-agent) that powers widget chat and CRM actions.

## Required Session Model

- Tests must run under the current OpenCode session.
- Parent session can be passed with `--parent-session <id>` or `OPENCODE_PARENT_SESSION`.
- All child sessions (executor/evaluator) must be created with `parentID = <current session id>`.

## Required Flow

### 1) Create Product-Agent via Meta-Agent (dev.lamoom.com)

- Use the create flow on `https://dev.lamoom.com/create`.
- Ask meta-agent to create a HubSpot CRM product-agent.
- In the creation prompt, provide concrete HubSpot API instructions (base URL, Bearer auth, required objects/actions).
- Verify the product-agent appears in dashboard and is active.
- Capture the generated widget embed token.

### 2) Inject Widget in HubSpot Context

- Open HubSpot in browser context.
- Inject widget with the created embed token.
- Use a fresh random UUID for each scenario:

```javascript
localStorage.removeItem('lamoom_uid');
const s = document.createElement('script');
s.src = 'https://dev.lamoom.com/widget.js?cb=' + Date.now();
s.setAttribute('data-agent-token', '<EMBED_TOKEN>');
s.setAttribute('data-user-id', crypto.randomUUID());
document.body.appendChild(s);
```

Notes:
- `data-user-id` must be randomized per scenario to isolate conversation state.
- `?cb=<timestamp>` avoids stale widget bundle caching during repeated runs.

### 3) Run Exactly 3 Scenarios

1. Create a contact
2. Search/list contacts
3. Handle ambiguity for deal-stage update

Each scenario must run with a new `data-user-id`.

### 4) Evaluate Each Scenario

Use evaluator child sessions to score:

- correct action
- ambiguity handling
- error handling
- response quality
- data accuracy

Pass threshold: `>= 5/6` per scenario.

<<<<<<< HEAD
## Evidence Requirements (Release Gate)

- Capture **viewport screenshots** (`fullPage: false`) for the full pipeline; do not use long-page screenshots as primary proof.
- Use a fixed viewport (recommended: `1366x768`) and keep it constant across the run.
- Capture frames continuously (recommended: ~1 frame/second during wait periods) so response timing is visible.
- Required pipeline coverage in evidence:
  1. `dev.lamoom.com/login` (credentials entered and sign-in submitted)
  2. `/create` meta-agent prompt sent
  3. Meta-agent creation response / marker
  4. Dashboard agent listing and agent details (embed token visible)
  5. Test chat on details page
  6. HubSpot context page with widget injected, message sent, response shown
- Assemble a GIF from captured frames and store under `e2e-demo-output/<run-id>/`.
- A harness PASS without screenshot/GIF artifacts is **not** a release-ready proof.

=======
>>>>>>> chore/test-hubspot-skill-rewrite
## Prohibited Shortcuts

- Do not use direct HubSpot API calls (`curl`, SDK, raw fetch) to execute scenario actions.
- Do not substitute scenario execution with mocked/seeded API writes.
- Do not run acceptance scenarios only on `example.com` when protocol requires HubSpot context.

## Harness Entry Point

Use `tests/hubspot-e2e.ts` for this protocol.

Required args:

- `--parent-session <id>` (or `OPENCODE_PARENT_SESSION`)
- `--hubspot-token <pat-...>` (or `HUBSPOT_TOKEN`)
- `--hubspot-portal-id <portal-id>` (or `HUBSPOT_PORTAL_ID`)

Credential defaults from env / `.env`:

- `LAMOOM_EMAIL` (fallback default: `demo@lamoom.com`)
- `LAMOOM_PASSWORD` (fallback default: `demo123`)

Optional:

- `--lamoom-invite-code <code>` (used when test account must be auto-created on first login)
- `--browser-tool playwright|vibebrowser` (default: `playwright`)
- `--hubspot-context-url <url>` (defaults to `https://www.hubspot.com/?portalId=<id>`)
- `--scenario create|search|deal|all` (default: `all`, run a single scenario for debug)

Evaluator model overrides:

- `OPENCODE_EVAL_PROVIDER` (defaults to `OPENCODE_PROVIDER`)
<<<<<<< HEAD
- `OPENCODE_EVAL_MODEL` (defaults to `OPENCODE_MODEL`; harness retries with main model fallback on evaluator parse failures)
=======
- `OPENCODE_EVAL_MODEL` (defaults to `claude-sonnet-4.5`)
>>>>>>> chore/test-hubspot-skill-rewrite

Examples:

```bash
.env
OPENCODE_PARENT_SESSION=ses_xxx
HUBSPOT_TOKEN=pat_xxx
HUBSPOT_PORTAL_ID=123456789
LAMOOM_EMAIL=hubspot.e2e.bot@lamoom.local
LAMOOM_PASSWORD='LamoomE2E!2026'
LAMOOM_INVITE_CODE=DEMO2026
OPENCODE_EVAL_MODEL=claude-sonnet-4.5
```

```bash
pnpm test:hubspot:min

# targeted debug runs
pnpm test:hubspot:create
pnpm test:hubspot:search
pnpm test:hubspot:deal

# equivalent one-off CLI form
npx tsx tests/hubspot-e2e.ts --scenario create --browser-tool playwright
```

Notes:

- Harness injects `data-user-token` into widget so the product-agent receives HubSpot auth context without direct API shortcuts.
- If HubSpot app login is blocked in headless browsers, use a HubSpot-domain context page that can load the widget (`--hubspot-context-url`) and run scenarios through widget chat only.
