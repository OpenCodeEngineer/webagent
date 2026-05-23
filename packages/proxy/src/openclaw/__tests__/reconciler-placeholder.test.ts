/**
 * Safety regression: the reconciler must preserve `${...}` env-var placeholder
 * strings verbatim when it reads and rewrites openclaw.json5.
 *
 * If the reconciler ever expanded or stripped these placeholders, secrets such
 * as OPENCLAW_GATEWAY_TOKEN, OPENCLAW_HOOKS_TOKEN, and AZURE_DEV_AI_API_KEY
 * could be baked into the committed config file — a real secret-leak risk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reconcileOpenClawConfig } from '../reconciler.js';

// ---------------------------------------------------------------------------
// Helpers (mirrors reconciler.test.ts conventions)
// ---------------------------------------------------------------------------

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

/**
 * Write the config as a raw string so we never lose the `${...}` markers
 * through a JSON5.stringify round-trip during fixture setup itself.
 */
async function setupFixtureWithRawConfig(rawConfig: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'reconciler-placeholder-'));
  const configDir = join(root, 'openclaw', 'config');
  const workspacesDir = join(root, 'openclaw', 'workspaces');
  await mkdir(configDir, { recursive: true });
  await mkdir(workspacesDir, { recursive: true });
  const configPath = join(configDir, 'openclaw.json5');
  await writeFile(configPath, rawConfig);

  const prevConfig = process.env.OPENCLAW_CONFIG_PATH;
  const prevWorkspaces = process.env.OPENCLAW_WORKSPACES_DIR;
  const prevRemove = process.env.OPENCLAW_RECONCILE_REMOVE_ORPHANS;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENCLAW_WORKSPACES_DIR = workspacesDir;
  delete process.env.OPENCLAW_RECONCILE_REMOVE_ORPHANS;

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
  cfg: Record<string, unknown>,
): Promise<void> {
  const dir = join(workspacesDir, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'agent-config.json'), JSON.stringify(cfg, null, 2));
}

// ---------------------------------------------------------------------------
// The raw JSON5 fixture — contains all three placeholder patterns from the
// real openclaw/config/openclaw.json5.
// ---------------------------------------------------------------------------

function makePlaceholderConfig(workspacesDir: string): string {
  return `{
  gateway: {
    mode: "local",
    auth: {
      mode: "token",
      token: "\${OPENCLAW_GATEWAY_TOKEN}",
    },
    remote: {
      token: "\${OPENCLAW_GATEWAY_TOKEN}",
    },
  },
  agents: {
    list: [
      {
        id: "existing-bot",
        name: "Existing Bot",
        workspace: "${workspacesDir}/existing-bot",
        sandbox: { mode: "off" },
        skills: ["website-api"],
        heartbeat: { every: "30m" },
      },
    ],
  },
  hooks: {
    enabled: true,
    token: "\${OPENCLAW_HOOKS_TOKEN}",
    path: "/hooks",
  },
  models: {
    mode: "merge",
    providers: {
      "azure-openai": {
        baseUrl: "\${AZURE_DEV_AI_BASE_URL}",
        apiKey: "\${AZURE_DEV_AI_API_KEY}",
      },
    },
  },
}
`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('reconciler preserves ${...} placeholders when a new agent is added (changed=true path)', async () => {
  const fx = await setupFixtureWithRawConfig(
    makePlaceholderConfig('/tmp/placeholder-unused'),
  );
  try {
    // Override the workspace path in the config to point at our temp dir.
    await writeFile(
      fx.configPath,
      makePlaceholderConfig(fx.workspacesDir),
    );

    // Add a new workspace so the reconciler has a real change to write.
    await writeWorkspace(fx.workspacesDir, 'new-bot', {
      agentSlug: 'new-bot',
      agentName: 'New Bot',
      skills: ['website-api'],
    });
    // Also provide a workspace for the existing entry so it stays.
    await writeWorkspace(fx.workspacesDir, 'existing-bot', {
      agentSlug: 'existing-bot',
      agentName: 'Existing Bot',
      skills: ['website-api'],
    });

    const res = await reconcileOpenClawConfig(makeApp());
    assert.deepEqual(res.errors, [], 'reconciler must not report errors');
    assert.deepEqual(res.added, ['new-bot'], 'new-bot should be added');

    const written = await readFile(fx.configPath, 'utf8');

    // Core assertion: every placeholder must survive verbatim.
    assert.ok(
      written.includes('${OPENCLAW_GATEWAY_TOKEN}'),
      `rewritten config must contain literal \${OPENCLAW_GATEWAY_TOKEN}; got:\n${written}`,
    );
    assert.ok(
      written.includes('${OPENCLAW_HOOKS_TOKEN}'),
      `rewritten config must contain literal \${OPENCLAW_HOOKS_TOKEN}; got:\n${written}`,
    );
    assert.ok(
      written.includes('${AZURE_DEV_AI_API_KEY}'),
      `rewritten config must contain literal \${AZURE_DEV_AI_API_KEY}; got:\n${written}`,
    );
    assert.ok(
      written.includes('${AZURE_DEV_AI_BASE_URL}'),
      `rewritten config must contain literal \${AZURE_DEV_AI_BASE_URL}; got:\n${written}`,
    );

    // Sanity: the new agent entry is actually there.
    assert.ok(written.includes('"new-bot"') || written.includes("'new-bot'") || written.includes('new-bot'),
      'new-bot should appear in rewritten config');
  } finally {
    fx.cleanup();
  }
});

test('reconciler preserves ${...} placeholders when nothing changes (no-op path, no write)', async () => {
  // When no change is detected the reconciler returns early without writing.
  // This test confirms the original file is untouched.
  const fx = await setupFixtureWithRawConfig(
    makePlaceholderConfig('/tmp/placeholder-unused'),
  );
  try {
    await writeFile(fx.configPath, makePlaceholderConfig(fx.workspacesDir));

    // Provide a workspace for the existing entry — same state as the config.
    await writeWorkspace(fx.workspacesDir, 'existing-bot', {
      agentSlug: 'existing-bot',
      agentName: 'Existing Bot',
      skills: ['website-api'],
    });

    // First run writes; second run should be a no-op.
    await reconcileOpenClawConfig(makeApp());
    const res2 = await reconcileOpenClawConfig(makeApp());
    assert.deepEqual(res2.added, []);
    assert.deepEqual(res2.updated, []);
    assert.deepEqual(res2.removed, []);
    assert.deepEqual(res2.errors, []);

    const written = await readFile(fx.configPath, 'utf8');
    assert.ok(
      written.includes('${OPENCLAW_GATEWAY_TOKEN}'),
      `config must still contain \${OPENCLAW_GATEWAY_TOKEN} after no-op run`,
    );
    assert.ok(
      written.includes('${OPENCLAW_HOOKS_TOKEN}'),
      `config must still contain \${OPENCLAW_HOOKS_TOKEN} after no-op run`,
    );
    assert.ok(
      written.includes('${AZURE_DEV_AI_API_KEY}'),
      `config must still contain \${AZURE_DEV_AI_API_KEY} after no-op run`,
    );
  } finally {
    fx.cleanup();
  }
});

test('reconciler preserves ${...} placeholders when an entry is updated (changed=true, existing entry)', async () => {
  // Give existing-bot stale skills so the reconciler produces an update.
  const fx = await setupFixtureWithRawConfig('{}'); // placeholder, replaced below
  try {
    const rawConfig = `{
  gateway: {
    auth: { mode: "token", token: "\${OPENCLAW_GATEWAY_TOKEN}" },
  },
  agents: {
    list: [
      {
        id: "my-agent",
        name: "My Agent",
        workspace: "${fx.workspacesDir}/my-agent",
        sandbox: { mode: "off" },
        skills: ["website-api"],
      },
    ],
  },
  hooks: { token: "\${OPENCLAW_HOOKS_TOKEN}" },
  models: {
    providers: {
      "azure-openai": { apiKey: "\${AZURE_DEV_AI_API_KEY}" },
    },
  },
}
`;
    await writeFile(fx.configPath, rawConfig);

    await writeWorkspace(fx.workspacesDir, 'my-agent', {
      agentSlug: 'my-agent',
      agentName: 'My Agent Updated',  // name change → triggers updated[]
      skills: ['website-api', 'website-knowledge'],
    });

    const res = await reconcileOpenClawConfig(makeApp());
    assert.deepEqual(res.errors, [], 'no errors expected');
    assert.deepEqual(res.updated, ['my-agent'], 'my-agent should be updated');

    const written = await readFile(fx.configPath, 'utf8');
    assert.ok(
      written.includes('${OPENCLAW_GATEWAY_TOKEN}'),
      `\${OPENCLAW_GATEWAY_TOKEN} must survive an update write`,
    );
    assert.ok(
      written.includes('${OPENCLAW_HOOKS_TOKEN}'),
      `\${OPENCLAW_HOOKS_TOKEN} must survive an update write`,
    );
    assert.ok(
      written.includes('${AZURE_DEV_AI_API_KEY}'),
      `\${AZURE_DEV_AI_API_KEY} must survive an update write`,
    );
  } finally {
    fx.cleanup();
  }
});
