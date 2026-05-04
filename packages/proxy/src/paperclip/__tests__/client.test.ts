process.env.OPENCLAW_GATEWAY_TOKEN ??= 'test-token';
process.env.OPENCLAW_GATEWAY_URL ??= 'http://127.0.0.1:0';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';

import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PaperclipClient } from '../client.js';

const BASE_URL = 'http://127.0.0.1:9999';

function makeClient(enabled: boolean) {
  return new PaperclipClient({ paperclipEnabled: enabled, paperclipUrl: BASE_URL });
}

function mockFetch(response: { ok: boolean; json?: unknown; status?: number }) {
  const fn = mock.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.json ?? {},
  }));
  (globalThis as any).fetch = fn;
  return fn;
}

describe('PaperclipClient disabled', () => {
  test('isEnabled returns false', () => {
    const client = makeClient(false);
    assert.equal(client.isEnabled, false);
  });

  test('healthCheck returns false without fetching', async () => {
    const fn = mockFetch({ ok: true });
    const client = makeClient(false);
    assert.equal(await client.healthCheck(), false);
    assert.equal(fn.mock.callCount(), 0);
  });

  test('listCompanies returns empty array', async () => {
    const client = makeClient(false);
    assert.deepEqual(await client.listCompanies(), []);
  });

  test('getDefaultCompanyId returns null', async () => {
    const client = makeClient(false);
    assert.equal(await client.getDefaultCompanyId(), null);
  });

  test('upsertAgent returns null', async () => {
    const client = makeClient(false);
    const result = await client.upsertAgent({
      companyId: 'c1',
      slug: 'bot',
      name: 'Bot',
      openclawAgentId: 'oa1',
    });
    assert.equal(result, null);
  });

  test('findAgentBySlug returns null', async () => {
    const client = makeClient(false);
    assert.equal(await client.findAgentBySlug('c1', 'bot'), null);
  });

  test('deleteAgent returns false', async () => {
    const client = makeClient(false);
    assert.equal(await client.deleteAgent('c1', 'a1'), false);
  });

  test('configureAdapter returns false', async () => {
    const client = makeClient(false);
    assert.equal(await client.configureAdapter({ companyId: 'c1', gatewayUrl: 'http://x' }), false);
  });
});

describe('PaperclipClient healthCheck', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('returns true when API responds ok', async () => {
    mockFetch({ ok: true });
    const client = makeClient(true);
    assert.equal(await client.healthCheck(), true);
  });

  test('returns false when API responds non-ok', async () => {
    mockFetch({ ok: false, status: 503 });
    const client = makeClient(true);
    assert.equal(await client.healthCheck(), false);
  });

  test('returns false when fetch throws', async () => {
    (globalThis as any).fetch = mock.fn(async () => { throw new Error('connection refused'); });
    const client = makeClient(true);
    assert.equal(await client.healthCheck(), false);
  });
});

describe('PaperclipClient upsertAgent', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('creates agent when none exists', async () => {
    const agent = { id: 'a1', name: 'Bot', slug: 'bot', adapter: 'openclaw-gateway', adapterConfig: {}, status: 'active' };
    let callCount = 0;
    (globalThis as any).fetch = mock.fn(async (url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        // findAgentBySlug returns empty
        return { ok: true, status: 200, json: async () => ({ agents: [] }) };
      }
      // POST create
      return { ok: true, status: 201, json: async () => agent };
    });

    const client = makeClient(true);
    const result = await client.upsertAgent({
      companyId: 'c1',
      slug: 'bot',
      name: 'Bot',
      openclawAgentId: 'oa1',
    });
    assert.deepEqual(result, agent);
    assert.equal(callCount, 2);
  });

  test('updates agent when one already exists', async () => {
    const existing = { id: 'a1', name: 'Bot', slug: 'bot', adapter: 'openclaw-gateway', adapterConfig: {}, status: 'active' };
    const updated = { ...existing, name: 'Bot v2' };
    let callCount = 0;
    (globalThis as any).fetch = mock.fn(async (url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, status: 200, json: async () => ({ agents: [existing] }) };
      }
      // PATCH update
      return { ok: true, status: 200, json: async () => updated };
    });

    const client = makeClient(true);
    const result = await client.upsertAgent({
      companyId: 'c1',
      slug: 'bot',
      name: 'Bot v2',
      openclawAgentId: 'oa1',
    });
    assert.deepEqual(result, updated);
  });

  test('returns null on create failure', async () => {
    let callCount = 0;
    (globalThis as any).fetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) return { ok: true, status: 200, json: async () => ({ agents: [] }) };
      return { ok: false, status: 500, json: async () => ({}) };
    });

    const client = makeClient(true);
    assert.equal(await client.upsertAgent({ companyId: 'c1', slug: 'bot', name: 'Bot', openclawAgentId: 'oa1' }), null);
  });
});

describe('PaperclipClient configureAdapter', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('returns true on success', async () => {
    const fn = mockFetch({ ok: true });
    const client = makeClient(true);
    const result = await client.configureAdapter({ companyId: 'c1', gatewayUrl: 'http://gw', gatewayToken: 'tok' });
    assert.equal(result, true);

    const [url, init] = fn.mock.calls[0]!.arguments as unknown as [string, RequestInit];
    assert.equal(url, `${BASE_URL}/api/v1/companies/c1/adapters/openclaw-gateway`);
    assert.equal(init.method, 'PUT');
    const body = JSON.parse(init.body as string);
    assert.equal(body.gateway_url, 'http://gw');
    assert.equal(body.gateway_token, 'tok');
  });

  test('returns false on failure', async () => {
    mockFetch({ ok: false, status: 422 });
    const client = makeClient(true);
    assert.equal(await client.configureAdapter({ companyId: 'c1', gatewayUrl: 'http://gw' }), false);
  });
});
