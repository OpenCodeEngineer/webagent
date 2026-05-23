import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSON5 from 'json5';

const repoRoot = join(process.cwd(), '..', '..');

test('OpenClaw runtime policy exposes API execution tools to product agents only', async () => {
  const config = JSON5.parse(await readFile(join(repoRoot, 'openclaw/config/openclaw.json5'), 'utf8')) as {
    tools?: { allow?: string[] };
    agents?: { list?: Array<{ id?: string; tools?: { deny?: string[] } }> };
  };

  assert.ok(config.tools?.allow?.includes('group:web'));
  assert.ok(config.tools?.allow?.includes('exec'));

  const meta = config.agents?.list?.find((agent) => agent.id === 'meta');
  assert.ok(meta?.tools?.deny?.includes('exec'));
});

test('website API templates allow low-risk direct mutations with method-capable HTTP', async () => {
  const templates = await Promise.all([
    readFile(join(repoRoot, 'openclaw/templates/skills/website-api/SKILL.md'), 'utf8'),
    readFile(join(repoRoot, 'openclaw/workspaces/meta/templates/skills/website-api/SKILL.md'), 'utf8'),
  ]);

  for (const template of templates) {
    assert.match(template, /method-capable HTTP tool/);
    assert.match(template, /POST\/PATCH\/PUT\/DELETE/);
    assert.match(template, /curl -sS -X POST/);
    assert.match(template, /low-risk, unambiguous mutations/);
    assert.doesNotMatch(template, /Use `fetch` to call/);
    assert.doesNotMatch(template, /Always confirm/);
  }
});
