// Test-only env stubs — must be set BEFORE importing api.ts (which transitively
// pulls in client/config that validates these at module load).
process.env.OPENCLAW_GATEWAY_TOKEN ??= 'test-token';
process.env.OPENCLAW_GATEWAY_URL ??= 'http://127.0.0.1:0';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildWidgetEmbedCode } = await import('./api.js');

test('buildWidgetEmbedCode escapes user token key attribute', () => {
  const embedCode = buildWidgetEmbedCode('https://dev.lamoom.com', 'embed-token', 'auth" onload="alert(1)&<x>');

  assert.equal(
    embedCode,
    '<script src="https://dev.lamoom.com/widget.js" data-agent-token="embed-token" data-user-token-key="auth&quot; onload=&quot;alert(1)&amp;&lt;x&gt;" async></script>',
  );
});

test('buildWidgetEmbedCode omits blank user token key attribute', () => {
  const embedCode = buildWidgetEmbedCode('dev.lamoom.com', 'embed-token', '   ');

  assert.equal(
    embedCode,
    '<script src="https://dev.lamoom.com/widget.js" data-agent-token="embed-token" async></script>',
  );
});
