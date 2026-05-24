// packages/proxy/src/openclaw/__tests__/workspace-writer.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
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

test('syncAgentWorkspaceFields preserves unrelated keys (skills, agentSlug, createdAt) in agent-config.json', async () => {
  const { workspace } = await makeWorkspace('preserve');
  const originalCfg = {
    agentSlug: 'preserve',
    agentName: 'Old',
    websiteUrl: 'https://old.test',
    skills: ['website-api', 'custom-skill'],
    createdAt: '2026-05-23T10:00:00Z',
    apiBaseUrl: 'https://api.old.test',
  };
  await writeFile(join(workspace, 'agent-config.json'), JSON.stringify(originalCfg, null, 2), 'utf8');
  await writeFile(
    join(workspace, 'AGENTS.md'),
    '# T\n<!-- LAMOOM:HEADER -->\nName: Old\n<!-- /LAMOOM:HEADER -->\n',
    'utf8',
  );

  await syncAgentWorkspaceFields({
    workspacesDir: join(workspace, '..'),
    slug: 'preserve',
    fields: { name: 'New', description: 'desc' },
  });

  const cfg = JSON.parse(await readFile(join(workspace, 'agent-config.json'), 'utf8'));
  assert.equal(cfg.agentName, 'New');
  assert.equal(cfg.description, 'desc');
  assert.equal(cfg.agentSlug, 'preserve');
  assert.deepEqual(cfg.skills, ['website-api', 'custom-skill']);
  assert.equal(cfg.createdAt, '2026-05-23T10:00:00Z');
  assert.equal(cfg.apiBaseUrl, 'https://api.old.test');
});
