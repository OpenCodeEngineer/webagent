# Agent Management Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close PRD Phase 1 MUST items #5 (inline agent editing) and #6 (pause / delete agent) so they ship as launch-blockers, without breaking the existing working surfaces.

**Architecture:** Reuse the already-wired routes (`PATCH /api/agents/:id` at `packages/proxy/src/routes/api.ts:1075`, `DELETE /api/agents/:id` at `:1176`) and admin UI components (`agent-edit-form.tsx`, `agent-cards.tsx`). Fill three concrete gaps: (a) PATCH currently updates the DB row but does NOT rewrite `<workspace>/AGENTS.md` or `<workspace>/agent-config.json` when customer-visible fields change, so the widget keeps answering with stale persona/URL; (b) the widget WS handler filters tokens by `agents.status='active'`, collapsing paused/deleted/not-found into one generic auth failure; (c) the widget bundle has no UX for the `agent_paused` state. Each gap is closed with tests-first edits in isolated files.

**Tech Stack:** Fastify + WebSocket (proxy), Drizzle ORM + Neon Postgres, Next.js 15 App Router (admin), Vite IIFE widget bundle, Node built-in test runner.

---

## File Structure

**Modify:**
- `packages/proxy/src/routes/api.ts` — extend the PATCH handler to sync workspace files when `name` / `websiteUrl` / `description` change.
- `packages/proxy/src/ws/handler.ts` — split paused-agent lookup from not-found lookup; emit `auth_error` reason `agent_paused`.
- `packages/shared/src/protocol.ts` — document the `agent_paused` reason string (already a `string`, but add a typed enum so widget + proxy share the literal).
- `packages/proxy/src/widget/widget.ts` — render the paused-agent message when the proxy returns `auth_error: agent_paused`.

**Create:**
- `packages/proxy/src/openclaw/workspace-writer.ts` — single responsibility: given a slug + `{name?, websiteUrl?, description?}`, rewrite the customer-facing fields in `<workspace>/AGENTS.md` (one named header block) and `<workspace>/agent-config.json` (JSON merge). Atomic via existing `atomicWriteFile`.
- `packages/proxy/src/openclaw/__tests__/workspace-writer.test.ts` — unit tests for header-replacement + JSON merge.
- `packages/proxy/src/routes/__tests__/patch-agent-workspace-sync.test.ts` — integration test that PATCH actually invokes the writer and survives missing workspace files.
- `packages/proxy/src/ws/__tests__/paused-agent.test.ts` — unit test that a paused agent gets `auth_error: agent_paused` and an active one passes.
- `packages/proxy/src/widget/__tests__/widget-paused-ui.test.ts` — JSDOM-style smoke that the widget renders the paused string when the relevant message arrives.

**Why the new file (`workspace-writer.ts`):** the existing `reconciler.ts` deals with the `openclaw.json5` gateway-level config, not per-agent workspace files. Putting workspace mutation in a separate, named module keeps PATCH free of fs concerns and gives Task 6 (re-crawl in meta-agent) a single seam to reuse later.

---

## Task 0: Verify current state (no code change)

This is a probe task — every assumption below was checked when the plan was written, but state may drift. Repeat the checks; if any expectation fails, stop and reconcile with the plan author.

- [ ] **Step 1: Confirm PATCH + DELETE routes still exist with the documented signatures.**

Run:
```bash
grep -n "app.patch('/api/agents/:id'\|app.delete('/api/agents/:id'" packages/proxy/src/routes/api.ts
```
Expected: two matches — PATCH near line 1075, DELETE near line 1176.

- [ ] **Step 2: Confirm UI buttons exist and call the server actions.**

Run:
```bash
grep -n "handleTogglePause\|handleDelete\|serverUpdateAgent\|serverDeleteAgent" packages/admin/src/components/agent-cards.tsx packages/admin/src/components/agent-edit-form.tsx
```
Expected: pause/delete buttons in `agent-cards.tsx`; name/websiteUrl/description fields in `agent-edit-form.tsx`; both call the `server*` helpers from `@/lib/actions`.

- [ ] **Step 3: Confirm widget WS token lookup still filters by `status='active'`.**

Run:
```bash
grep -n "eq(agents.status, 'active')" packages/proxy/src/ws/handler.ts
```
Expected: at least one match around line 458 inside `lookupEmbedToken`.

- [ ] **Step 4: Confirm test runner works.**

Run:
```bash
pnpm --filter @webagent/proxy test
```
Expected: existing suite passes (no new failures introduced before this plan).

- [ ] **Step 5: No commit — this task is read-only.**

---

## Task 1: workspace-writer module — header-replacement test

**Files:**
- Create: `packages/proxy/src/openclaw/workspace-writer.ts`
- Create: `packages/proxy/src/openclaw/__tests__/workspace-writer.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
// packages/proxy/src/openclaw/__tests__/workspace-writer.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncAgentWorkspaceFields } from '../workspace-writer.js';

async function makeWorkspace(slug: string) {
  const root = await mkdtemp(join(tmpdir(), 'ws-writer-'));
  const workspace = join(root, slug);
  await mkdir(workspace, { recursive: true });
  return { root, workspace };
}

test('syncAgentWorkspaceFields rewrites the customer-visible header block in AGENTS.md', async () => {
  const { workspace } = await makeWorkspace('demo');
  const original = [
    '# Demo Agent',
    '',
    '<!-- LAMOOM:HEADER -->',
    'Name: Old Name',
    'Website: https://old.example.com',
    'Description: old description',
    '<!-- /LAMOOM:HEADER -->',
    '',
    '## Behaviour rules',
    'Hand-written content below MUST be preserved verbatim.',
    '',
  ].join('\n');
  await writeFile(join(workspace, 'AGENTS.md'), original, 'utf8');
  await writeFile(
    join(workspace, 'agent-config.json'),
    JSON.stringify({ agentSlug: 'demo', agentName: 'Old Name', websiteUrl: 'https://old.example.com', skills: ['website-api'] }, null, 2),
    'utf8',
  );

  await syncAgentWorkspaceFields({
    workspacesDir: join(workspace, '..'),
    slug: 'demo',
    fields: { name: 'New Name', websiteUrl: 'https://new.example.com', description: 'new description' },
  });

  const updatedMd = await readFile(join(workspace, 'AGENTS.md'), 'utf8');
  assert.match(updatedMd, /Name: New Name/);
  assert.match(updatedMd, /Website: https:\/\/new\.example\.com/);
  assert.match(updatedMd, /Description: new description/);
  assert.match(updatedMd, /Hand-written content below MUST be preserved verbatim\./);
  assert.doesNotMatch(updatedMd, /Old Name/);
});
```

- [ ] **Step 2: Run the test, watch it fail.**

Run: `pnpm --filter @webagent/proxy test -- --test-name-pattern="rewrites the customer-visible header"`
Expected: FAIL — `Cannot find module '../workspace-writer.js'`.

- [ ] **Step 3: Implement the minimal module.**

```typescript
// packages/proxy/src/openclaw/workspace-writer.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteFile } from './atomic-write.js';

export interface SyncFields {
  name?: string;
  websiteUrl?: string | null;
  description?: string | null;
}

export interface SyncArgs {
  workspacesDir: string;
  slug: string;
  fields: SyncFields;
}

const HEADER_START = '<!-- LAMOOM:HEADER -->';
const HEADER_END = '<!-- /LAMOOM:HEADER -->';

function renderHeader(fields: Required<SyncFields>): string {
  return [
    HEADER_START,
    `Name: ${fields.name ?? ''}`,
    `Website: ${fields.websiteUrl ?? ''}`,
    `Description: ${fields.description ?? ''}`,
    HEADER_END,
  ].join('\n');
}

function replaceHeader(original: string, rendered: string): string {
  const startIdx = original.indexOf(HEADER_START);
  if (startIdx === -1) {
    // No header present — prepend it after any existing top-level title line.
    const firstNl = original.indexOf('\n');
    if (firstNl === -1) return `${original}\n\n${rendered}\n`;
    return `${original.slice(0, firstNl + 1)}\n${rendered}\n${original.slice(firstNl + 1)}`;
  }
  const endIdx = original.indexOf(HEADER_END, startIdx);
  if (endIdx === -1) {
    // Malformed — refuse to mangle the file silently.
    throw new Error(`AGENTS.md has ${HEADER_START} but no ${HEADER_END}`);
  }
  return original.slice(0, startIdx) + rendered + original.slice(endIdx + HEADER_END.length);
}

export async function syncAgentWorkspaceFields(args: SyncArgs): Promise<void> {
  const workspace = join(args.workspacesDir, args.slug);
  const agentsMdPath = join(workspace, 'AGENTS.md');
  const configPath = join(workspace, 'agent-config.json');

  let mergedFields: Required<SyncFields> = { name: '', websiteUrl: '', description: '' };
  try {
    const rawConfig = await readFile(configPath, 'utf8');
    const cfg = JSON.parse(rawConfig) as Record<string, unknown>;
    mergedFields = {
      name: typeof cfg.agentName === 'string' ? cfg.agentName : '',
      websiteUrl: typeof cfg.websiteUrl === 'string' ? cfg.websiteUrl : '',
      description: typeof cfg.description === 'string' ? cfg.description : '',
    };
    if (args.fields.name !== undefined) mergedFields.name = args.fields.name;
    if (args.fields.websiteUrl !== undefined) mergedFields.websiteUrl = args.fields.websiteUrl ?? '';
    if (args.fields.description !== undefined) mergedFields.description = args.fields.description ?? '';
    const nextCfg = { ...cfg, agentName: mergedFields.name, websiteUrl: mergedFields.websiteUrl, description: mergedFields.description };
    await atomicWriteFile(configPath, JSON.stringify(nextCfg, null, 2) + '\n');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // No agent-config.json — fall back to caller-supplied fields only.
    mergedFields = {
      name: args.fields.name ?? '',
      websiteUrl: args.fields.websiteUrl ?? '',
      description: args.fields.description ?? '',
    };
  }

  try {
    const rawMd = await readFile(agentsMdPath, 'utf8');
    const next = replaceHeader(rawMd, renderHeader(mergedFields));
    if (next !== rawMd) await atomicWriteFile(agentsMdPath, next);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // Missing AGENTS.md is non-fatal: the meta-agent will recreate it on next run.
  }
}
```

- [ ] **Step 4: Run the test, watch it pass.**

Run: `pnpm --filter @webagent/proxy test -- --test-name-pattern="rewrites the customer-visible header"`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/proxy/src/openclaw/workspace-writer.ts \
        packages/proxy/src/openclaw/__tests__/workspace-writer.test.ts
git commit -m "feat(proxy): add workspace-writer for agent field sync"
```

---

## Task 2: workspace-writer — JSON-only and missing-file edge cases

**Files:**
- Modify: `packages/proxy/src/openclaw/__tests__/workspace-writer.test.ts`

- [ ] **Step 1: Add failing tests.**

Append to the existing test file:
```typescript
import { access } from 'node:fs/promises';

test('syncAgentWorkspaceFields tolerates missing AGENTS.md (config-only update)', async () => {
  const { workspace } = await makeWorkspace('cfg-only');
  await writeFile(
    join(workspace, 'agent-config.json'),
    JSON.stringify({ agentSlug: 'cfg-only', agentName: 'A', websiteUrl: 'https://a.test' }, null, 2),
    'utf8',
  );

  await syncAgentWorkspaceFields({
    workspacesDir: join(workspace, '..'),
    slug: 'cfg-only',
    fields: { name: 'B' },
  });

  const cfg = JSON.parse(await readFile(join(workspace, 'agent-config.json'), 'utf8'));
  assert.equal(cfg.agentName, 'B');
  await assert.rejects(access(join(workspace, 'AGENTS.md')));
});

test('syncAgentWorkspaceFields tolerates missing agent-config.json (md-only update)', async () => {
  const { workspace } = await makeWorkspace('md-only');
  await writeFile(
    join(workspace, 'AGENTS.md'),
    '# title\n<!-- LAMOOM:HEADER -->\nName: old\n<!-- /LAMOOM:HEADER -->\n',
    'utf8',
  );

  await syncAgentWorkspaceFields({
    workspacesDir: join(workspace, '..'),
    slug: 'md-only',
    fields: { name: 'new' },
  });

  const md = await readFile(join(workspace, 'AGENTS.md'), 'utf8');
  assert.match(md, /Name: new/);
});

test('syncAgentWorkspaceFields throws on malformed header (open tag without close)', async () => {
  const { workspace } = await makeWorkspace('broken');
  await writeFile(join(workspace, 'AGENTS.md'), '# title\n<!-- LAMOOM:HEADER -->\nName: x\n', 'utf8');
  await assert.rejects(
    syncAgentWorkspaceFields({
      workspacesDir: join(workspace, '..'),
      slug: 'broken',
      fields: { name: 'y' },
    }),
    /no <!-- \/LAMOOM:HEADER -->/,
  );
});
```

- [ ] **Step 2: Run, expect PASS on first two, FAIL on the malformed test only if implementation is wrong.**

Run: `pnpm --filter @webagent/proxy test -- --test-name-pattern="syncAgentWorkspaceFields"`
Expected: all three new tests PASS (implementation from Task 1 already covers them — confirms no regression).

- [ ] **Step 3: If anything fails, fix `workspace-writer.ts` minimally, do not refactor.**

- [ ] **Step 4: Commit only if changes were needed.**

```bash
git add packages/proxy/src/openclaw/__tests__/workspace-writer.test.ts \
        packages/proxy/src/openclaw/workspace-writer.ts
git commit -m "test(proxy): cover workspace-writer edge cases"
```

---

## Task 3: PATCH route — sync workspace after DB update (test first)

**Files:**
- Create: `packages/proxy/src/routes/__tests__/patch-agent-workspace-sync.test.ts`
- Modify: `packages/proxy/src/routes/api.ts:1075-1174` (PATCH handler)

- [ ] **Step 1: Write the failing test.**

```typescript
// packages/proxy/src/routes/__tests__/patch-agent-workspace-sync.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Spy on the workspace-writer module: PATCH must call it with the
// changed fields. We import the real module and replace its export
// using a mutable wrapper so the test does not require a DI framework.
import * as writerModule from '../../openclaw/workspace-writer.js';

test('PATCH /api/agents/:id calls syncAgentWorkspaceFields with the diff', async () => {
  const calls: Array<Parameters<typeof writerModule.syncAgentWorkspaceFields>[0]> = [];
  const originalSync = writerModule.syncAgentWorkspaceFields;
  (writerModule as { syncAgentWorkspaceFields: typeof originalSync }).syncAgentWorkspaceFields = async (args) => {
    calls.push(args);
  };

  try {
    // The actual handler test uses the existing API test harness in
    // packages/proxy/src/routes/api.test.ts as a template. Reuse its
    // helpers if present; otherwise stand up a minimal Fastify instance.
    const { buildTestApp, seedAgent } = await import('../api.test.helpers.js');
    const app = await buildTestApp();
    const { agentId, customerId, hmacHeaders } = await seedAgent(app, {
      slug: 'patch-sync',
      name: 'Before',
      websiteUrl: 'https://before.test',
      description: 'before',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${agentId}`,
      headers: hmacHeaders,
      payload: { name: 'After', description: 'after' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.slug, 'patch-sync');
    assert.deepEqual(calls[0]!.fields, { name: 'After', description: 'after' });
  } finally {
    (writerModule as { syncAgentWorkspaceFields: typeof originalSync }).syncAgentWorkspaceFields = originalSync;
  }
});
```

- [ ] **Step 2: If `api.test.helpers.ts` does not yet exist, extract minimal helpers from `packages/proxy/src/routes/api.test.ts` into a new file `packages/proxy/src/routes/api.test.helpers.ts` exporting `buildTestApp()` and `seedAgent()`. Otherwise reuse.**

(Implementation note: the existing `api.test.ts` already builds a test app — promote its setup to a named export rather than duplicating. Do this as the smallest extraction that satisfies the new test; do not rewrite `api.test.ts`.)

- [ ] **Step 3: Run the test, watch it fail.**

Run: `pnpm --filter @webagent/proxy test -- --test-name-pattern="PATCH /api/agents/:id calls syncAgentWorkspaceFields"`
Expected: FAIL — `calls.length` is 0 because PATCH does not invoke the writer yet.

- [ ] **Step 4: Wire PATCH to the writer.**

Edit `packages/proxy/src/routes/api.ts`. At the top, add the import:
```typescript
import { syncAgentWorkspaceFields } from '../openclaw/workspace-writer.js';
```

Inside the existing PATCH handler, **after** the `await app.db.update(agents)...returning()` block and **before** the audit-log call (around line 1120 in the current file), insert:
```typescript
const syncableChanged
  = body.name !== undefined
  || body.websiteUrl !== undefined
  || body.description !== undefined;

if (syncableChanged) {
  try {
    await syncAgentWorkspaceFields({
      workspacesDir: resolveOpenClawWorkspacesDir(),
      slug: updated.openclawAgentId,
      fields: {
        name: body.name,
        websiteUrl: body.websiteUrl,
        description: body.description,
      },
    });
  } catch (err) {
    request.log.warn(
      { err, agentId: params.id, slug: updated.openclawAgentId },
      'workspace file sync failed after PATCH; DB row updated regardless',
    );
  }
}
```

Rationale: failure to rewrite the workspace files must NOT roll back the DB update — the customer's edit is still valid and the meta-agent can rewrite on next interaction. Log loudly so the gap is visible.

- [ ] **Step 5: Run the test, watch it pass.**

Run: `pnpm --filter @webagent/proxy test -- --test-name-pattern="PATCH /api/agents/:id calls syncAgentWorkspaceFields"`
Expected: PASS.

- [ ] **Step 6: Run the full proxy suite to make sure nothing regressed.**

Run: `pnpm --filter @webagent/proxy test`
Expected: all tests PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/proxy/src/routes/api.ts \
        packages/proxy/src/routes/api.test.helpers.ts \
        packages/proxy/src/routes/__tests__/patch-agent-workspace-sync.test.ts
git commit -m "feat(proxy): sync workspace files on agent PATCH

Updates AGENTS.md header + agent-config.json when name, websiteUrl,
or description change. Failure to write workspace files does not
roll back the DB update; it is logged and recoverable via the
meta-agent re-crawl flow."
```

---

## Task 4: WS handler — distinguish paused agent (test first)

**Files:**
- Create: `packages/proxy/src/ws/__tests__/paused-agent.test.ts`
- Modify: `packages/proxy/src/ws/handler.ts:440-475` (the `lookupEmbedToken` function + its caller in the auth handler).
- Modify: `packages/shared/src/protocol.ts` (add `AGENT_PAUSED` reason literal).

- [ ] **Step 1: Add the shared literal first (single-line change).**

In `packages/shared/src/protocol.ts`, find the `auth_error` `ServerMessage` variant and add an exported const next to it:
```typescript
export const AUTH_ERROR_AGENT_PAUSED = 'agent_paused' as const;
```

Do **not** convert `reason` to a string union — keep it `string` to avoid forcing every existing call site to migrate in this plan.

- [ ] **Step 2: Write the failing test.**

```typescript
// packages/proxy/src/ws/__tests__/paused-agent.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveAgentForToken, type TokenResolution } from '../handler.js';
// resolveAgentForToken is added in Step 4 — see implementation.

import { buildTestApp, seedAgent } from '../../routes/api.test.helpers.js';

test('resolveAgentForToken returns agent_paused when the agent is paused', async () => {
  const app = await buildTestApp();
  const { embedToken } = await seedAgent(app, { slug: 'paused-1', name: 'P', status: 'paused' });
  const result: TokenResolution = await resolveAgentForToken(app.db, embedToken);
  assert.equal(result.kind, 'paused');
});

test('resolveAgentForToken returns active for an active agent', async () => {
  const app = await buildTestApp();
  const { embedToken } = await seedAgent(app, { slug: 'active-1', name: 'A', status: 'active' });
  const result: TokenResolution = await resolveAgentForToken(app.db, embedToken);
  assert.equal(result.kind, 'active');
  if (result.kind === 'active') assert.equal(typeof result.agentId, 'string');
});

test('resolveAgentForToken returns not_found for an unknown token', async () => {
  const app = await buildTestApp();
  const result: TokenResolution = await resolveAgentForToken(app.db, 'unknown-token');
  assert.equal(result.kind, 'not_found');
});

test('resolveAgentForToken returns not_found for a deleted agent', async () => {
  const app = await buildTestApp();
  const { embedToken } = await seedAgent(app, { slug: 'deleted-1', name: 'D', status: 'deleted' });
  const result: TokenResolution = await resolveAgentForToken(app.db, embedToken);
  assert.equal(result.kind, 'not_found');
});
```

- [ ] **Step 3: Run the test, watch it fail.**

Run: `pnpm --filter @webagent/proxy test -- --test-name-pattern="resolveAgentForToken"`
Expected: FAIL — `resolveAgentForToken` is not exported.

- [ ] **Step 4: Refactor `lookupEmbedToken` into a status-aware resolver. Keep the cache.**

Replace the existing `lookupEmbedToken` body in `packages/proxy/src/ws/handler.ts` with:
```typescript
export type TokenResolution =
  | { kind: 'active'; agentId: string; openclawAgentId: string; allowedOrigins: string[] | null; widgetConfig: Record<string, unknown> | null }
  | { kind: 'paused' }
  | { kind: 'not_found' };

export async function resolveAgentForToken(db: Database, embedToken: string): Promise<TokenResolution> {
  const cached = getCachedTokenLookup(embedToken);
  if (cached) {
    return { kind: 'active', ...cached };
  }

  const rows = await db
    .select({
      agentId: agents.id,
      openclawAgentId: agents.openclawAgentId,
      status: agents.status,
      allowedOrigins: widgetEmbeds.allowedOrigins,
      widgetConfig: agents.widgetConfig,
    })
    .from(widgetEmbeds)
    .innerJoin(agents, eq(widgetEmbeds.agentId, agents.id))
    .where(eq(widgetEmbeds.embedToken, embedToken))
    .limit(1);

  const row = rows[0];
  if (!row || row.status === 'deleted') return { kind: 'not_found' };
  if (row.status === 'paused') return { kind: 'paused' };

  const value = {
    agentId: row.agentId,
    openclawAgentId: row.openclawAgentId,
    allowedOrigins: row.allowedOrigins,
    widgetConfig: row.widgetConfig as Record<string, unknown> | null,
  };
  setCachedTokenLookup(embedToken, value);
  return { kind: 'active', ...value };
}
```

Then update the auth handler in the same file (currently around line 510 — search for `lookupEmbedToken(`) to switch on the resolution:
```typescript
const resolution = await resolveAgentForToken(ctx.db, agentToken);
if (resolution.kind === 'paused') {
  ws.send(JSON.stringify({ type: 'auth_error', reason: AUTH_ERROR_AGENT_PAUSED } satisfies ServerMessage));
  ws.close(1008, 'agent_paused');
  return;
}
if (resolution.kind === 'not_found') {
  ws.send(JSON.stringify({ type: 'auth_error', reason: 'invalid_token' } satisfies ServerMessage));
  ws.close(1008, 'invalid_token');
  return;
}
// existing flow continues with `resolution.agentId`, `resolution.openclawAgentId`, etc.
```

Delete the old `lookupEmbedToken` function. Update the import at the top of the file to include `AUTH_ERROR_AGENT_PAUSED` from `@webagent/shared/protocol`.

- [ ] **Step 5: Run the test, watch it pass.**

Run: `pnpm --filter @webagent/proxy test -- --test-name-pattern="resolveAgentForToken"`
Expected: PASS — all four cases (paused/active/not_found-token/deleted).

- [ ] **Step 6: Run full proxy suite.**

Run: `pnpm --filter @webagent/proxy test`
Expected: all PASS. If a pre-existing test asserts the old `invalid_token` reason for a paused agent, update that assertion to match `agent_paused` and note it in the commit message.

- [ ] **Step 7: Commit.**

```bash
git add packages/proxy/src/ws/handler.ts \
        packages/proxy/src/ws/__tests__/paused-agent.test.ts \
        packages/shared/src/protocol.ts
git commit -m "feat(proxy): emit auth_error agent_paused for paused agents

Splits embed-token lookup into a status-aware resolver. Widget can now
distinguish a paused agent from an invalid token. Deleted agents
continue to fall through as not_found."
```

---

## Task 5: Widget — render paused-agent UX (test first)

**Files:**
- Create: `packages/proxy/src/widget/__tests__/widget-paused-ui.test.ts`
- Modify: `packages/proxy/src/widget/widget.ts` (auth_error handler)

- [ ] **Step 1: Identify where the widget handles `auth_error`.**

Run:
```bash
grep -n "auth_error\|auth_ok" packages/proxy/src/widget/widget.ts
```
Expected: a small handler block. Read enough surrounding code to find the function name and the DOM node it writes status into. Make a note for the next step.

- [ ] **Step 2: Write the failing test.**

The widget is plain TypeScript that touches `document`. Use a JSDOM-style test via `node:test` + `linkedom` if already a dev dep; otherwise add a tiny `globalThis.document` stub.

```typescript
// packages/proxy/src/widget/__tests__/widget-paused-ui.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

// The widget exposes a render helper for tests. If it does not, add one in Step 3.
import { renderStatusMessage } from '../widget.js';

test('renderStatusMessage prints the paused copy when reason is agent_paused', () => {
  const container = { textContent: '' } as { textContent: string };
  renderStatusMessage(container as unknown as HTMLElement, { type: 'auth_error', reason: 'agent_paused' });
  assert.match(container.textContent, /temporarily unavailable/i);
});

test('renderStatusMessage prints a generic message for other auth errors', () => {
  const container = { textContent: '' } as { textContent: string };
  renderStatusMessage(container as unknown as HTMLElement, { type: 'auth_error', reason: 'invalid_token' });
  assert.doesNotMatch(container.textContent, /temporarily unavailable/i);
  assert.match(container.textContent, /unavailable|cannot connect|error/i);
});
```

- [ ] **Step 3: Run the test, watch it fail.**

Run: `pnpm --filter @webagent/proxy test -- --test-name-pattern="renderStatusMessage"`
Expected: FAIL — `renderStatusMessage` is not exported (or does not exist).

- [ ] **Step 4: Extract and implement.**

In `packages/proxy/src/widget/widget.ts`, locate the auth-error path discovered in Step 1. Replace its inline copy-write with:
```typescript
import { AUTH_ERROR_AGENT_PAUSED } from '@webagent/shared/protocol';

export function renderStatusMessage(
  el: HTMLElement,
  message: { type: string; reason?: string },
): void {
  if (message.type === 'auth_error' && message.reason === AUTH_ERROR_AGENT_PAUSED) {
    el.textContent = 'This assistant is temporarily unavailable.';
    return;
  }
  if (message.type === 'auth_error') {
    el.textContent = 'Chat is currently unavailable. Please try again later.';
    return;
  }
}
```

Replace the existing call site to invoke `renderStatusMessage(<the existing status node>, parsed)` instead of writing to `.textContent` directly. Keep the surrounding behaviour (e.g. disabling the input, closing the socket) unchanged.

- [ ] **Step 5: Run the test, watch it pass.**

Run: `pnpm --filter @webagent/proxy test -- --test-name-pattern="renderStatusMessage"`
Expected: PASS.

- [ ] **Step 6: Rebuild the widget bundle and confirm size budget.**

Run:
```bash
pnpm --filter @webagent/proxy build
wc -c packages/proxy/public/widget.js
```
Expected: byte count printed; MUST be ≤ 51200 (PRD §5 NFR). If the new import pushes the bundle over, inline the literal string `'agent_paused'` in the widget and skip the import.

- [ ] **Step 7: Commit.**

```bash
git add packages/proxy/src/widget/widget.ts \
        packages/proxy/src/widget/__tests__/widget-paused-ui.test.ts
git commit -m "feat(widget): render paused-agent message on auth_error

Widget now shows 'temporarily unavailable' when the proxy reports
the agent is paused, instead of the generic auth-error copy."
```

---

## Task 6: End-to-end smoke (manual, no code)

This task verifies the change works in the real app, per global CLAUDE.md "Definition of Done" — CI green is not enough.

- [ ] **Step 1: Start the local stack.**

Run: `pnpm dev`
Expected: admin at `http://localhost:3000`, proxy at `http://localhost:3001`.

- [ ] **Step 2: Log in as the test customer.**

Use `demo@lamoom.com / demo123` (test creds, tdd.md §Test Credentials).

- [ ] **Step 3: Pick an existing agent on the dashboard and click "Pause".**

Expected: badge flips to `paused`; the button label flips to `Resume`.

- [ ] **Step 4: Open the agent detail page → "Test chat" tab and try to chat.**

Expected: widget shows "This assistant is temporarily unavailable." (not the generic "cannot connect" copy).

- [ ] **Step 5: Click "Resume" on the dashboard, return to the test chat.**

Expected: chat works again.

- [ ] **Step 6: Open the agent detail "Edit" panel, change the description, save.**

Expected: HTTP 200. Then verify on disk:
```bash
cat openclaw/workspaces/<slug>/agent-config.json | jq .description
grep -A2 'LAMOOM:HEADER' openclaw/workspaces/<slug>/AGENTS.md
```
Expected: the new description appears in both files.

- [ ] **Step 7: Capture a one-line note for the PR description with the verified slug and timestamps. No commit.**

---

## Self-Review Checklist

**Spec coverage (PRD Phase 1 #5 inline editing + #6 pause/delete):**
- ✅ Inline editing — name/websiteUrl/description survive a PATCH AND propagate to the workspace (Tasks 1-3).
- ✅ Pause — paused agents reject widget connections with a distinct, user-visible reason (Tasks 4-5).
- ✅ Delete — already wired end-to-end (Task 0 verifies); no new work required. If Task 0 step 2 fails to find pause/delete buttons, raise a blocker before continuing.

**Placeholder scan:** No "TBD" / "implement later". The one judgement call ("if size budget exceeded, inline the literal") is spelled out in Task 5 step 6.

**Type consistency:** `TokenResolution` defined in Task 4 step 4 is the same shape consumed by the auth handler edit in the same step; `SyncFields` defined in Task 1 step 3 matches the call site in Task 3 step 4.

**Out of scope (deliberately not in this plan, ship as siblings):**
- Phase 1 #1 password migration + #7 settings page → Account-management plan.
- Phase 1 #2 CI/CD + #3 Sentry + #4 uptime → Observability plan.
- The TOCTOU race (Known Debt #11) and DB insert race (#12) → HIGH, not BLOCKING; separate cleanup.
