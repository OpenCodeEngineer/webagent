import { test } from 'node:test';
import assert from 'node:assert/strict';

const { formatAuthErrorMessage } = await import('../widget.js');

test('formatAuthErrorMessage returns paused copy when reason is agent_paused', () => {
  const out = formatAuthErrorMessage({ type: 'auth_error', reason: 'agent_paused' });
  assert.match(out, /temporarily unavailable/i);
});

test('formatAuthErrorMessage falls back to generic copy for other reasons', () => {
  const out = formatAuthErrorMessage({ type: 'auth_error', reason: 'Invalid agent token' });
  assert.doesNotMatch(out, /temporarily unavailable/i);
  assert.match(out, /Invalid agent token/);
  assert.match(out, /Connection failed/i);
});

test('formatAuthErrorMessage prefers explicit message field over reason', () => {
  const out = formatAuthErrorMessage({ type: 'auth_error', message: 'detail', reason: 'Invalid agent token' });
  assert.match(out, /detail/);
});

test('formatAuthErrorMessage falls back to a generic phrase when neither field is set', () => {
  const out = formatAuthErrorMessage({ type: 'auth_error' });
  assert.match(out, /Authentication error|Connection failed/i);
});
