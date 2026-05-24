// Test-only env stubs — must be set BEFORE importing handler.ts (which
// transitively pulls in client/config that validates these at module load).
process.env.OPENCLAW_GATEWAY_TOKEN ??= 'test-token';
process.env.OPENCLAW_GATEWAY_URL ??= 'http://127.0.0.1:0';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { classifyTokenLookupRow } = await import('../handler.js');

const baseRow = {
  agentId: 'a',
  openclawAgentId: 'slug',
  allowedOrigins: null,
  widgetConfig: null,
};

test('classifyTokenLookupRow returns not_found when row is missing', () => {
  const r = classifyTokenLookupRow(null);
  assert.equal(r.kind, 'not_found');
});

test('classifyTokenLookupRow returns not_found when status is deleted (token leak protection)', () => {
  const r = classifyTokenLookupRow({ ...baseRow, status: 'deleted' });
  assert.equal(r.kind, 'not_found');
});

test('classifyTokenLookupRow returns paused when status is paused', () => {
  const r = classifyTokenLookupRow({ ...baseRow, status: 'paused' });
  assert.equal(r.kind, 'paused');
});

test('classifyTokenLookupRow returns active for an active agent and surfaces token-lookup fields', () => {
  const r = classifyTokenLookupRow({ ...baseRow, status: 'active' });
  assert.equal(r.kind, 'active');
  if (r.kind === 'active') {
    assert.equal(r.agentId, 'a');
    assert.equal(r.openclawAgentId, 'slug');
  }
});

test('classifyTokenLookupRow returns active for provisioning status (treated as active for chat)', () => {
  // 'provisioning' is the default status set by detectAgentCreation before
  // any explicit transition. Widget should accept it — agents that finish
  // creation but have not yet been flipped to 'active' must still chat.
  const r = classifyTokenLookupRow({ ...baseRow, status: 'provisioning' });
  assert.equal(r.kind, 'active');
});
