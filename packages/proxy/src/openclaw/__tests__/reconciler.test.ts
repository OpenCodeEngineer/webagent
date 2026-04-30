import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSON5 from 'json5';

import { reconcileOpenClawConfig } from '../reconciler.js';

/**
 * Minimal Fastify-shaped stub. The reconciler only uses `app.log.{info,warn,error}`.
 */
function makeApp() {
  const events: { level: string; obj: unknown; msg?: string }[] = [];
  const mk = (level: string) =>
    (objOrMsg: unknown, msg?: string) => {
      events.push({ level, obj: objOrMsg, msg });
    };
  return {
    log: { info: mk('info'), warn: mk('warn'), error: mk('error') },
    events,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

interface Fixture {
  root: string;
  configPath: string;
  workspacesDir: string;
  cleanup: () => void;
}

async function setupFixture(initialConfig: unknown): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'reconciler-'));
  const configDir = join(root, 'openclaw', 'config');
  const workspacesDir = join(root, 'openclaw', 'workspaces');
  await mkdir(configDir, { recursive: true });
  await mkdir(workspacesDir, { recursive: true });
  const configPath = join(configDir, 'openclaw.json5');
  await writeFile(configPath, JSON5.stringify(initialConfig, null, 2));

  const prevConfig = process.env.OPENCLAW_CONFIG_PATH;
  const prevWorkspaces = process.env.OPENCLAW_WORKSPACES_DIR;
  const prevRemove = process.env.OPENCLAW_RECONCILE_REMOVE_ORPHANS;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENCLAW_WORKSPACES_DIR = workspacesDir;

  return {
    root,
    configPath,
    workspacesDir,
    cleanup: () => {
      if (prevConfig === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
      else process.env.OPENCLAW_CONFIG_PATH = prevConfig;
      if (prevWorkspaces === undefined) delete process.env.OPENCLAW_WORKSPACES_DIR;
      else process.env.OPENCLAW_WORKSPACES_DIR = prevWorkspaces;
      if (prevRemove === undefined) delete process.env.OPENCLAW_RECONCILE_REMOVE_ORPHANS;
      else process.env.OPENCLAW_RECONCILE_REMOVE_ORPHANS = prevRemove;
    },
  };
}

async function writeWorkspace(
  workspacesDir: string,
  slug: string,
  cfg: Record<string, unknown> | null,
): Promise<void> {
  const dir = join(workspacesDir, slug);
  await mkdir(dir, { recursive: true });
  if (cfg !== null) {
    await writeFile(join(dir, 'agent-config.json'), JSON.stringify(cfg, null, 2));
  }
}

test('adds a missing entry for an on-disk workspace', async () => {
  const fx = await setupFixture({ agents: { list: [] } });
  try {
    await writeWorkspace(fx.workspacesDir, 'acme-bot', {
      agentSlug: 'acme-bot',
      agentName: 'Acme Bot',
      skills: ['website-api', 'website-knowledge'],
    });
    const res = await reconcileOpenClawConfig(makeApp());
    assert.deepEqual(res.added, ['acme-bot']);
    assert.deepEqual(res.updated, []);
    assert.deepEqual(res.removed, []);
    assert.deepEqual(res.errors, []);

    const written = JSON5.parse(await readFile(fx.configPath, 'utf8')) as {
      agents: { list: { id: string; name: string; skills: string[]; workspace: string }[] };
    };
    assert.equal(written.agents.list.length, 1);
    assert.equal(written.agents.list[0]!.id, 'acme-bot');
    assert.equal(written.agents.list[0]!.name, 'Acme Bot');
    assert.deepEqual(written.agents.list[0]!.skills, ['website-api', 'website-knowledge']);
    assert.equal(written.agents.list[0]!.workspace, join(fx.workspacesDir, 'acme-bot'));
  } finally {
    fx.cleanup();
  }
});

test('updates skills when on-disk config differs from openclaw.json5', async () => {
  const fx = await setupFixture({
    agents: {
      list: [
        {
          id: 'acme-bot',
          name: 'Acme Bot',
          workspace: '/old/path',
          sandbox: { mode: 'off' },
          skills: ['website-api'],
          heartbeat: { every: '15m' },
          customField: 'preserve me',
        },
      ],
    },
  });
  try {
    await writeWorkspace(fx.workspacesDir, 'acme-bot', {
      agentSlug: 'acme-bot',
      agentName: 'Acme Bot',
      skills: ['website-api', 'website-knowledge'],
    });
    const res = await reconcileOpenClawConfig(makeApp());
    assert.deepEqual(res.added, []);
    assert.deepEqual(res.updated, ['acme-bot']);
    assert.deepEqual(res.errors, []);

    const written = JSON5.parse(await readFile(fx.configPath, 'utf8')) as {
      agents: { list: Record<string, unknown>[] };
    };
    const entry = written.agents.list[0]!;
    assert.deepEqual(entry.skills, ['website-api', 'website-knowledge']);
    assert.equal(entry.workspace, join(fx.workspacesDir, 'acme-bot'));
    // Custom hand-edited fields and existing heartbeat must be preserved.
    assert.equal(entry.customField, 'preserve me');
    assert.deepEqual(entry.heartbeat, { every: '15m' });
  } finally {
    fx.cleanup();
  }
});

test('skips the meta workspace', async () => {
  const fx = await setupFixture({ agents: { list: [] } });
  try {
    await writeWorkspace(fx.workspacesDir, 'meta', {
      agentSlug: 'meta',
      agentName: 'Meta',
      skills: ['create-agent'],
    });
    const res = await reconcileOpenClawConfig(makeApp());
    assert.deepEqual(res.added, []);
    assert.deepEqual(res.updated, []);
    assert.deepEqual(res.errors, []);
  } finally {
    fx.cleanup();
  }
});

test('is idempotent: a second run produces no changes', async () => {
  const fx = await setupFixture({ agents: { list: [] } });
  try {
    await writeWorkspace(fx.workspacesDir, 'acme-bot', {
      agentSlug: 'acme-bot',
      agentName: 'Acme Bot',
      skills: ['website-api'],
    });
    await reconcileOpenClawConfig(makeApp());
    const res2 = await reconcileOpenClawConfig(makeApp());
    assert.deepEqual(res2.added, []);
    assert.deepEqual(res2.updated, []);
    assert.deepEqual(res2.removed, []);
    assert.deepEqual(res2.errors, []);
  } finally {
    fx.cleanup();
  }
});

test('skips workspaces without agent-config.json', async () => {
  const fx = await setupFixture({ agents: { list: [] } });
  try {
    await writeWorkspace(fx.workspacesDir, 'scratch', null);
    const res = await reconcileOpenClawConfig(makeApp());
    assert.deepEqual(res.added, []);
    assert.deepEqual(res.errors, []);
  } finally {
    fx.cleanup();
  }
});

test('records errors for malformed agent-config.json without aborting other workspaces', async () => {
  const fx = await setupFixture({ agents: { list: [] } });
  try {
    await mkdir(join(fx.workspacesDir, 'broken'), { recursive: true });
    await writeFile(join(fx.workspacesDir, 'broken', 'agent-config.json'), '{ not json');
    await writeWorkspace(fx.workspacesDir, 'good-bot', {
      agentSlug: 'good-bot',
      agentName: 'Good',
      skills: ['website-api'],
    });
    const res = await reconcileOpenClawConfig(makeApp());
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0]!, /broken/);
    assert.deepEqual(res.added, ['good-bot']);
  } finally {
    fx.cleanup();
  }
});

test('preserves orphan entries by default; removes them when env flag is true', async () => {
  const fx = await setupFixture({
    agents: {
      list: [
        {
          id: 'orphan',
          name: 'Orphan',
          workspace: '/nowhere',
          sandbox: { mode: 'off' },
          skills: ['website-api'],
        },
      ],
    },
  });
  try {
    // No matching workspace dir for 'orphan'.
    let res = await reconcileOpenClawConfig(makeApp());
    assert.deepEqual(res.removed, []);

    process.env.OPENCLAW_RECONCILE_REMOVE_ORPHANS = 'true';
    res = await reconcileOpenClawConfig(makeApp());
    assert.deepEqual(res.removed, ['orphan']);
    const written = JSON5.parse(await readFile(fx.configPath, 'utf8')) as {
      agents: { list: { id: string }[] };
    };
    assert.deepEqual(written.agents.list, []);
  } finally {
    fx.cleanup();
  }
});
