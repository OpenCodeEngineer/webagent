// Test-only env stubs — must be set BEFORE importing api.ts.
process.env.OPENCLAW_GATEWAY_TOKEN ??= 'test-token';
process.env.OPENCLAW_GATEWAY_URL ??= 'http://127.0.0.1:0';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { pickWorkspaceSyncFieldsFromPatch } = await import('../api.js');

test('pickWorkspaceSyncFieldsFromPatch returns null when no workspace-relevant fields changed', () => {
  assert.equal(pickWorkspaceSyncFieldsFromPatch({}), null);
  assert.equal(pickWorkspaceSyncFieldsFromPatch({ status: 'paused' }), null);
  assert.equal(pickWorkspaceSyncFieldsFromPatch({ widgetConfig: { foo: 1 } }), null);
  assert.equal(pickWorkspaceSyncFieldsFromPatch({ apiDescription: 'x' }), null);
});

test('pickWorkspaceSyncFieldsFromPatch picks name when provided', () => {
  assert.deepEqual(pickWorkspaceSyncFieldsFromPatch({ name: 'New' }), { name: 'New' });
});

test('pickWorkspaceSyncFieldsFromPatch picks websiteUrl when provided (including null)', () => {
  assert.deepEqual(pickWorkspaceSyncFieldsFromPatch({ websiteUrl: 'https://x.test' }), { websiteUrl: 'https://x.test' });
  assert.deepEqual(pickWorkspaceSyncFieldsFromPatch({ websiteUrl: null }), { websiteUrl: null });
});

test('pickWorkspaceSyncFieldsFromPatch picks description when provided (including null)', () => {
  assert.deepEqual(pickWorkspaceSyncFieldsFromPatch({ description: 'd' }), { description: 'd' });
  assert.deepEqual(pickWorkspaceSyncFieldsFromPatch({ description: null }), { description: null });
});

test('pickWorkspaceSyncFieldsFromPatch combines multiple fields, ignores irrelevant ones', () => {
  const out = pickWorkspaceSyncFieldsFromPatch({
    name: 'N',
    websiteUrl: 'https://w.test',
    description: 'd',
    status: 'active',
    widgetConfig: { skills: ['x'] },
    apiDescription: 'a',
  });
  assert.deepEqual(out, { name: 'N', websiteUrl: 'https://w.test', description: 'd' });
});
