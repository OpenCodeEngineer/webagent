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
