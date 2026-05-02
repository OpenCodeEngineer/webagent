// Test-only env stubs — must be set BEFORE importing handler.ts (which
// transitively pulls in client/config that validates these at module load).
process.env.OPENCLAW_GATEWAY_TOKEN ??= 'test-token';
process.env.OPENCLAW_GATEWAY_URL ??= 'http://127.0.0.1:0';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildWidgetMessageWithSessionPolicy } = await import('./handler.js');

test('buildWidgetMessageWithSessionPolicy includes no-credentials session context', () => {
  const outbound = buildWidgetMessageWithSessionPolicy({}, 'List my tenants');

  assert.match(outbound, /^\[Session Context — no credentials\]/);
  assert.match(outbound, /No API credentials are configured/);
  assert.match(outbound, /Never ask end users to fetch or copy JWTs\/tokens/);
  assert.match(outbound, /User: List my tenants$/);
});

test('buildWidgetMessageWithSessionPolicy includes configured credentials guidance without dropping user text', () => {
  const outbound = buildWidgetMessageWithSessionPolicy({ Authorization: 'Bearer secret' }, 'Restart tenant alpha');

  assert.match(outbound, /^\[Session Context\]/);
  assert.match(outbound, /Authentication credentials are configured/);
  assert.match(outbound, /Authorization: Bearer secret/);
  assert.match(outbound, /User: Restart tenant alpha$/);
});
