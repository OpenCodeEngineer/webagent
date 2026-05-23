/**
 * Lamoom E2E test — run via: node .agents/skills/test-lamoom/e2e.js
 *
 * Requires:
 *   - Chrome CDP on localhost:9222
 *   - AUTH_SECRET env var (or hardcoded below for dev)
 *   - pnpm playwright available at /home/azureuser/VibeWebAgent/node_modules/playwright
 *
 * Steps:
 *   1. Session auth (JWT via @auth/core)
 *   2. Create agent via /create meta-agent chat
 *   3. Verify agent in /dashboard
 *   4. Widget WebSocket exchange
 */

const { chromium } = require('/home/azureuser/VibeWebAgent/node_modules/playwright');
const { createSign } = require('crypto');
const path = require('path');
const fs = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────
const BASE = process.env.LAMOOM_BASE_URL || 'https://dev.lamoom.com';
const OUT_DIR = process.env.OUT_DIR || '/tmp/lamoom-e2e-' + Date.now();
const USER_ID = process.env.LAMOOM_USER_ID || '0e3d9d31-2219-42d3-b4d9-1440cbce8682';
const USER_EMAIL = process.env.LAMOOM_USER_EMAIL || 'dzianisvv@gmail.com';
const USER_NAME = process.env.LAMOOM_USER_NAME || 'Den';

// AUTH_SECRET must match the server. For dev, read from env or .env file.
let authSecret = process.env.AUTH_SECRET;
if (!authSecret) {
  // Try reading from server .env (dev only)
  const envPaths = [
    '/opt/webagent/.env',
    path.resolve(__dirname, '../../../../.env'),
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const match = fs.readFileSync(p, 'utf8').match(/^AUTH_SECRET=(.+)$/m);
      if (match) { authSecret = match[1].trim(); break; }
    }
  }
}
if (!authSecret) {
  console.error('✗ AUTH_SECRET not set. Export it or place it in /opt/webagent/.env');
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });
const frame = (n, label) => path.join(OUT_DIR, `frame-${String(n).padStart(2,'0')}-${label}.png`);

async function buildJwt() {
  // Dynamic import of ESM @auth/core/jwt
  const jwtMod = await import(
    '/home/azureuser/workspace/webagent/node_modules/.pnpm/@auth+core@0.41.2_nodemailer@7.0.13/node_modules/@auth/core/jwt.js'
  );
  const encode = jwtMod.encode;
  const now = Math.floor(Date.now() / 1000);
  const cookieName = '__Secure-authjs.session-token';
  return encode({
    secret: authSecret,
    salt: cookieName,
    token: {
      name: USER_NAME, email: USER_EMAIL, picture: null,
      sub: USER_ID, id: USER_ID,   // BOTH required — session.user.id reads token.id
      isAdmin: true,
      iat: now, exp: now + 30 * 24 * 60 * 60, jti: 'e2e-' + now,
    },
  });
}

(async () => {
  const results = [];
  const pass = (phase, note = '') => { results.push({ phase, status: 'PASS', note }); console.log(`✓ Phase ${phase}${note ? ': ' + note : ''}`); };
  const fail = (phase, note = '') => { results.push({ phase, status: 'FAIL', note }); console.log(`✗ Phase ${phase}${note ? ': ' + note : ''}`); };

  // ── Phase 0: Health ──────────────────────────────────────────────────────
  console.log('\n=== Phase 0: Platform Health ===');
  const { execSync } = require('child_process');
  let healthOk = true;
  for (const url of [`${BASE}/health`, `${BASE}/health/openclaw`]) {
    try {
      const out = execSync(`curl -sf --max-time 5 ${url}`, { encoding: 'utf8' });
      if (out.includes('"ok"') || out.includes('ok')) {
        console.log(`  ${url} → ok`);
      } else {
        console.log(`  ${url} → unexpected: ${out.substring(0, 80)}`);
        healthOk = false;
      }
    } catch {
      console.log(`  ${url} → FAILED`);
      healthOk = false;
    }
  }
  if (healthOk) pass('0: Health'); else { fail('0: Health', 'endpoint down'); printReport(results); process.exit(1); }

  // ── Build JWT ────────────────────────────────────────────────────────────
  let jwt;
  try { jwt = await buildJwt(); } catch(e) { fail('JWT', e.message); process.exit(1); }
  console.log(`JWT built (${jwt.length} chars)`);

  // ── Browser setup ────────────────────────────────────────────────────────
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  context.setDefaultNavigationTimeout(30000);
  await context.addCookies([{
    name: '__Secure-authjs.session-token', value: jwt,
    domain: new URL(BASE).hostname, path: '/',
    expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    httpOnly: true, sameSite: 'Lax', secure: true,
  }]);
  const page = await context.newPage();

  // ── Phase 1: Session + Dashboard ────────────────────────────────────────
  console.log('\n=== Phase 1: Session + Dashboard ===');
  await page.goto(`${BASE}/api/auth/session`, { waitUntil: 'networkidle', timeout: 10000 });
  const sessText = await page.innerText('body').catch(() => '{}');
  let sess;
  try { sess = JSON.parse(sessText); } catch { sess = {}; }
  if (!sess?.user?.id) {
    fail('1: Session', 'no user.id — JWT may be wrong');
    await page.screenshot({ path: frame(1, 'session-fail'), fullPage: true });
    await context.close(); printReport(results); process.exit(1);
  }
  console.log('  user.id:', sess.user.id);

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);
  if (page.url().includes('/login')) {
    fail('1: Dashboard', 'redirected to login');
    await page.screenshot({ path: frame(1, 'dashboard-fail'), fullPage: true });
    await context.close(); printReport(results); process.exit(1);
  }
  await page.screenshot({ path: frame(1, 'dashboard'), fullPage: true });
  pass('1: Dashboard');

  // ── Phase 2: Create agent ─────────────────────────────────────────────
  console.log('\n=== Phase 2: Create Agent ===');
  await page.goto(`${BASE}/create`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  const body0 = await page.innerText('body').catch(() => '');
  if (body0.includes('Unable to authenticate')) {
    fail('2: Create', 'WS auth failed — ws-ticket rejected JWT');
    await page.screenshot({ path: frame(2, 'ws-auth-fail'), fullPage: true });
    await context.close(); printReport(results); process.exit(1);
  }

  const ta = await page.waitForSelector('textarea:not([disabled])', { timeout: 15000 }).catch(() => null);
  if (!ta) {
    fail('2: Textarea', 'textarea stayed disabled after 15s');
    await page.screenshot({ path: frame(2, 'textarea-disabled'), fullPage: true });
    await context.close(); printReport(results); process.exit(1);
  }

  // Snapshot existing tokens so we only react to NEW ones
  const existingTokens = new Set(
    [...(await page.content()).matchAll(/data-agent-token="([a-f0-9-]{36})"/g)].map(m => m[1])
  );

  const ts = Date.now();
  const label = `E2ETest-${ts}`;
  await ta.click();
  await ta.fill(`Create a simple customer support agent for ${label} (sells electronics). Website: https://example.com`);
  await page.keyboard.press('Enter');
  console.log('  Message sent:', new Date().toISOString());

  let embedToken = null;
  let urlReplied = false;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(3000);
    const content = await page.content();
    const newTokens = [...content.matchAll(/data-agent-token="([a-f0-9-]{36})"/g)]
      .map(m => m[1]).filter(t => !existingTokens.has(t));
    if (newTokens.length > 0) {
      embedToken = newTokens[0];
      console.log(`  Embed token after ${(i+1)*3}s: ${embedToken}`);
      await page.screenshot({ path: frame(2, 'agent-created'), fullPage: true });
      await page.waitForTimeout(2000); // let DB write settle
      break;
    }
    if (!urlReplied) {
      const bl = (await page.innerText('body').catch(() => '')).toLowerCase();
      if (bl.includes('url') && (bl.includes('website') || bl.includes('what') || bl.includes('provide'))) {
        const enabledTa = await page.$('textarea:not([disabled])');
        if (enabledTa) {
          urlReplied = true;
          await enabledTa.click(); await enabledTa.fill('https://example.com'); await page.keyboard.press('Enter');
          console.log(`  ${(i+1)*3}s: URL reply sent`);
        }
      }
    }
    if (i % 10 === 9) console.log(`  ${(i+1)*3}s: still waiting...`);
  }

  if (!embedToken) {
    fail('2: Create', 'no new embed token after 300s');
    await page.screenshot({ path: frame(2, 'create-timeout'), fullPage: true });
    await context.close(); printReport(results); process.exit(1);
  }
  pass('2: Create', `token ${embedToken}`);

  // ── Phase 3: Dashboard ────────────────────────────────────────────────
  console.log('\n=== Phase 3: Dashboard ===');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  const dashText = await page.innerText('body');
  await page.screenshot({ path: frame(3, 'dashboard'), fullPage: true });
  if (dashText.toLowerCase().includes(label.toLowerCase()) || dashText.toLowerCase().includes('e2etest')) {
    pass('3: Dashboard', 'agent visible');
  } else {
    fail('3: Dashboard', 'agent label not found in dashboard');
    console.log('  Dashboard snippet:', dashText.substring(0, 300));
  }

  // ── Phase 4: Widget WebSocket ─────────────────────────────────────────
  console.log('\n=== Phase 4: Widget WebSocket ===');
  const wsUrl = BASE.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/ws';
  const wsResult = await page.evaluate(async ({ token, wsUrl }) => {
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      const messages = [];
      const timeout = setTimeout(() => resolve({ error: 'timeout', messages }), 120000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', agentToken: token, userId: 'e2e-' + Date.now() }));
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        messages.push(data);
        if (data.type === 'auth_ok') ws.send(JSON.stringify({ type: 'message', content: 'Hello! What products do you sell?' }));
        if (data.done === true || data.type === 'done') { clearTimeout(timeout); ws.close(); resolve({ ok: true, messages }); }
      };
      ws.onerror = () => { clearTimeout(timeout); resolve({ error: 'ws_error', messages }); };
      ws.onclose = (e) => {
        if (!messages.some(m => m.done === true || m.type === 'done')) {
          clearTimeout(timeout); resolve({ error: `closed(${e.code})`, reason: e.reason, messages });
        }
      };
    });
  }, { token: embedToken, wsUrl });

  const hasContent = wsResult.messages?.some(m => m.content && m.content.length > 10);
  if (wsResult.ok || hasContent) {
    const reply = wsResult.messages.filter(m => m.content).map(c => c.content).join('');
    console.log('  Agent reply:', reply.substring(0, 200));
    pass('4: WebSocket', `${wsResult.messages.length} messages`);
  } else {
    fail('4: WebSocket', `${wsResult.error || ''} ${wsResult.reason || ''} types:${wsResult.messages?.map(m=>m.type).join(',')}`);
  }

  await context.close();
  printReport(results);

  const allPass = results.every(r => r.status === 'PASS');
  console.log('\nVERDICT:', allPass ? '✓✓✓ READY' : '✗ NOT READY');
  console.log('Output dir:', OUT_DIR);
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

function printReport(results) {
  console.log('\n── E2E Report ───────────────────────────');
  for (const r of results) console.log(`  ${r.status === 'PASS' ? '✓' : '✗'} ${r.phase}${r.note ? ' — ' + r.note : ''}`);
  console.log('─────────────────────────────────────────');
}
