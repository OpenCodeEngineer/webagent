// Test-only env stubs — must be set BEFORE importing api.ts (which transitively
// pulls in client/config that validates these at module load).
process.env.OPENCLAW_GATEWAY_TOKEN ??= 'test-token';
process.env.OPENCLAW_GATEWAY_URL ??= 'http://127.0.0.1:0';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSON5 from 'json5';

import { registerAgentInOpenClaw } from '../../routes/api.js';

interface FakeApp {
  log: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };
}

function makeApp(): FakeApp {
  return {
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

async function setup(): Promise<{ configPath: string; workspacesDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'openclaw-register-'));
  const configDir = join(root, 'config');
  const workspacesDir = join(root, 'workspaces');
  await mkdir(configDir, { recursive: true });
  await mkdir(workspacesDir, { recursive: true });
  const configPath = join(configDir, 'openclaw.json5');
  const initial = `// header comment\n${JSON5.stringify({ agents: { list: [] } }, null, 2)}\n`;
  await writeFile(configPath, initial, 'utf8');
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENCLAW_WORKSPACES_DIR = workspacesDir;
  return { configPath, workspacesDir };
}

test('registerAgentInOpenClaw: appends new entry when slug missing', async () => {
  const { configPath } = await setup();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerAgentInOpenClaw('alpha', 'Alpha Bot', makeApp() as any, ['skill-a']);
  const raw = await readFile(configPath, 'utf8');
  assert.ok(raw.startsWith('// header comment'), 'leading header preserved');
  const parsed = JSON5.parse(raw) as { agents: { list: Array<{ id: string; skills: string[] }> } };
  assert.equal(parsed.agents.list.length, 1);
  assert.equal(parsed.agents.list[0]!.id, 'alpha');
  assert.deepEqual(parsed.agents.list[0]!.skills, ['skill-a']);
});

test('registerAgentInOpenClaw: 4a — updates existing entry skills in place', async () => {
  const { configPath } = await setup();
  // Seed an existing entry with stale skills + a hand-edited extra field.
  const raw0 = await readFile(configPath, 'utf8');
  const cfg = JSON5.parse(raw0) as {
    agents: { list: Array<Record<string, unknown>> };
  };
  cfg.agents.list.push({
    id: 'beta',
    name: 'old name',
    workspace: '/wrong/path',
    sandbox: { mode: 'off' },
    skills: ['stale'],
    heartbeat: { every: '1h', target: 'custom-target' },
    customField: 'preserve-me',
  });
  await writeFile(configPath, `${JSON5.stringify(cfg, null, 2)}\n`, 'utf8');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerAgentInOpenClaw('beta', 'New Name', makeApp() as any, ['fresh-skill', 'another']);

  const after = JSON5.parse(await readFile(configPath, 'utf8')) as {
    agents: { list: Array<Record<string, unknown>> };
  };
  assert.equal(after.agents.list.length, 1, 'no duplicate appended');
  const entry = after.agents.list[0]!;
  assert.equal(entry.id, 'beta');
  assert.equal(entry.name, 'New Name');
  assert.deepEqual(entry.skills, ['fresh-skill', 'another']);
  assert.equal(entry.customField, 'preserve-me', 'extra fields preserved');
  // heartbeat override preserved (we only set heartbeat if absent).
  assert.deepEqual(entry.heartbeat, { every: '1h', target: 'custom-target' });
});

test('registerAgentInOpenClaw: 4d — output is valid JSON5 (no orphan tmp)', async () => {
  const { configPath } = await setup();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerAgentInOpenClaw('gamma', 'Gamma', makeApp() as any);
  const raw = await readFile(configPath, 'utf8');
  // Round-trips through JSON5 cleanly.
  assert.doesNotThrow(() => JSON5.parse(raw));
  assert.ok(raw.endsWith('\n'));
});
