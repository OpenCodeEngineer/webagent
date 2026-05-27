import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateGeneratedWorkspace } from './workspace-validator.js';

describe('validateGeneratedWorkspace', () => {
  let baseDir: string;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'workspace-lint-'));
  });

  after(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('returns valid for a clean workspace', async () => {
    const ws = join(baseDir, 'clean');
    await mkdir(ws, { recursive: true });
    await writeFile(join(ws, 'AGENTS.md'), '# Agent\nYou are a helpful assistant.\n## Workflow-as-Code\nWrite actions to workflows/<verb>-<noun>.py and exec.');
    await writeFile(join(ws, 'IDENTITY.md'), '# Identity\nName: TestBot');
    await writeFile(join(ws, 'SOUL.md'), '# Soul\nFriendly and professional.');

    const result = await validateGeneratedWorkspace(ws);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('detects {{PLACEHOLDER}} in AGENTS.md', async () => {
    const ws = join(baseDir, 'with-placeholder');
    await mkdir(ws, { recursive: true });
    await writeFile(
      join(ws, 'AGENTS.md'),
      '# Agent\nWelcome to {{WEBSITE_NAME}}.\nAPI at {{API_BASE_URL}}.\n## Workflow-as-Code\nactions go to workflows/',
    );
    await writeFile(join(ws, 'IDENTITY.md'), '# Identity\nName: TestBot');
    await writeFile(join(ws, 'SOUL.md'), '# Soul\nFriendly.');

    const result = await validateGeneratedWorkspace(ws);
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0]!, /AGENTS\.md:2.*\{\{WEBSITE_NAME\}\}/);
    assert.match(result.errors[1]!, /AGENTS\.md:3.*\{\{API_BASE_URL\}\}/);
  });

  it('reports missing required files', async () => {
    const ws = join(baseDir, 'missing-files');
    await mkdir(ws, { recursive: true });
    await writeFile(join(ws, 'SOUL.md'), '# Soul\nFriendly.');
    // AGENTS.md and IDENTITY.md missing

    const result = await validateGeneratedWorkspace(ws);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('AGENTS.md: required file is missing')));
    assert.ok(result.errors.some((e) => e.includes('IDENTITY.md: required file is missing')));
  });

  it('reports empty required files', async () => {
    const ws = join(baseDir, 'empty-files');
    await mkdir(ws, { recursive: true });
    await writeFile(join(ws, 'AGENTS.md'), '');
    await writeFile(join(ws, 'IDENTITY.md'), '# Identity\nName: Bot');
    await writeFile(join(ws, 'SOUL.md'), '   \n  ');

    const result = await validateGeneratedWorkspace(ws);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('AGENTS.md: required file is empty')));
    assert.ok(result.errors.some((e) => e.includes('SOUL.md: required file is empty')));
  });

  it('ignores placeholders inside fenced code blocks', async () => {
    const ws = join(baseDir, 'code-block');
    await mkdir(ws, { recursive: true });
    await writeFile(
      join(ws, 'AGENTS.md'),
      '# Agent\nReal content.\n## Workflow-as-Code\nactions go to workflows/\n```\n{{EXAMPLE_PLACEHOLDER}}\n```\n',
    );
    await writeFile(join(ws, 'IDENTITY.md'), '# Identity\nName: Bot');
    await writeFile(join(ws, 'SOUL.md'), '# Soul\nKind.');

    const result = await validateGeneratedWorkspace(ws);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('ignores files in templates/ subdirectory', async () => {
    const ws = join(baseDir, 'with-templates');
    await mkdir(join(ws, 'templates'), { recursive: true });
    await writeFile(join(ws, 'AGENTS.md'), '# Agent\nReal content.\n## Workflow-as-Code\nactions go to workflows/');
    await writeFile(join(ws, 'IDENTITY.md'), '# Identity\nName: Bot');
    await writeFile(join(ws, 'SOUL.md'), '# Soul\nKind.');
    await writeFile(join(ws, 'templates', 'AGENTS.md'), '# {{WEBSITE_NAME}}');

    const result = await validateGeneratedWorkspace(ws);
    assert.equal(result.valid, true);
  });

  it('ignores files in knowledgebase/ subdirectory', async () => {
    const ws = join(baseDir, 'with-knowledgebase');
    await mkdir(join(ws, 'knowledgebase'), { recursive: true });
    await writeFile(join(ws, 'AGENTS.md'), '# Agent\nReal content.\n## Workflow-as-Code\nactions go to workflows/');
    await writeFile(join(ws, 'IDENTITY.md'), '# Identity\nName: Bot');
    await writeFile(join(ws, 'SOUL.md'), '# Soul\nKind.');
    await writeFile(join(ws, 'knowledgebase', 'api-reference.md'), '# Template syntax: {{API_BASE_URL}}');

    const result = await validateGeneratedWorkspace(ws);
    assert.equal(result.valid, true);
  });

  it('rejects AGENTS.md missing Workflow-as-Code marker', async () => {
    const ws = join(baseDir, 'missing-workflow-marker');
    await mkdir(ws, { recursive: true });
    await writeFile(
      join(ws, 'AGENTS.md'),
      '# Agent\nGeneric assistant. No workflow rule mentioned.',
    );
    await writeFile(join(ws, 'IDENTITY.md'), '# Identity\nName: Bot');
    await writeFile(join(ws, 'SOUL.md'), '# Soul\nKind.');

    const result = await validateGeneratedWorkspace(ws);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes('Workflow-as-Code')),
      `expected Workflow-as-Code marker error, got: ${result.errors.join('; ')}`,
    );
    assert.ok(
      result.errors.some((e) => e.includes('workflows/')),
      `expected workflows/ marker error, got: ${result.errors.join('; ')}`,
    );
  });

  it('rejects website-api SKILL.md missing workflow-first markers', async () => {
    const ws = join(baseDir, 'missing-api-skill-marker');
    await mkdir(join(ws, 'skills', 'website-api'), { recursive: true });
    await writeFile(
      join(ws, 'AGENTS.md'),
      '# Agent\nReal content.\n## Workflow-as-Code\nactions go to workflows/',
    );
    await writeFile(join(ws, 'IDENTITY.md'), '# Identity\nName: Bot');
    await writeFile(join(ws, 'SOUL.md'), '# Soul\nKind.');
    await writeFile(
      join(ws, 'skills', 'website-api', 'SKILL.md'),
      '# website-api\nMakes API calls via curl.',
    );

    const result = await validateGeneratedWorkspace(ws);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes('skills/website-api/SKILL.md') && e.includes('workflows/'),
      ),
      `expected workflows/ marker error in skill, got: ${result.errors.join('; ')}`,
    );
  });

  it('detects {{PLACEHOLDER}} in .json files', async () => {
    const ws = join(baseDir, 'json-placeholder');
    await mkdir(ws, { recursive: true });
    await writeFile(join(ws, 'AGENTS.md'), '# Agent\nReal content.\n## Workflow-as-Code\nactions go to workflows/');
    await writeFile(join(ws, 'IDENTITY.md'), '# Identity\nName: Bot');
    await writeFile(join(ws, 'SOUL.md'), '# Soul\nKind.');
    await writeFile(
      join(ws, 'agent-config.json'),
      '{\n  "apiBaseUrl": "{{API_BASE_URL}}"\n}',
    );

    const result = await validateGeneratedWorkspace(ws);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('agent-config.json') && e.includes('{{API_BASE_URL}}')));
  });
});
