import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * SSO bridge between the admin dashboard (NextAuth) and LibreChat.
 *
 * Flow:
 *   1. Admin /create page calls POST /api/librechat/sso (Next.js API route)
 *   2. Next.js API route calls POST /sso/librechat/code (this file) → returns signed code
 *   3. Admin loads iframe src="/sso/librechat?code=xxx"
 *   4. This endpoint validates code, provisions+logs in LibreChat user, returns HTML bridge
 *   5. Bridge sets localStorage token and redirects to /c/new (LibreChat)
 */

type SsoCodePayload = {
  userId: string;
  email: string;
  name: string;
  exp: number;
  nonce: string;
};

const usedCodes = new Map<string, number>();

const cleanupTimer = setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const [code, expiresAt] of usedCodes) {
    if (expiresAt <= now) usedCodes.delete(code);
  }
}, 60_000);
cleanupTimer.unref();

function getSsoSecret(): string | null {
  return process.env.LIBRECHAT_SSO_SECRET?.trim() || process.env.LIBRECHAT_API_KEY?.trim() || null;
}

function timingSafeBufferEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function signCode(payload: SsoCodePayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyCode(
  code: string,
  secret: string,
): { valid: true; payload: SsoCodePayload } | { valid: false } {
  const dotIndex = code.indexOf('.');
  if (dotIndex === -1) return { valid: false };

  const encoded = code.slice(0, dotIndex);
  const sig = code.slice(dotIndex + 1);
  if (!encoded || !sig) return { valid: false };

  const expectedSig = createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!timingSafeBufferEqual(sig, expectedSig)) return { valid: false };

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as
      | Partial<SsoCodePayload>
      | null;
    if (!payload || typeof payload !== 'object') return { valid: false };
    if (!payload.email || !payload.name || !payload.userId || !payload.nonce) return { valid: false };
    if (typeof payload.exp !== 'number') return { valid: false };
    if (payload.exp < Math.floor(Date.now() / 1000)) return { valid: false };
    return {
      valid: true,
      payload: payload as SsoCodePayload,
    };
  } catch {
    return { valid: false };
  }
}

function verifyInternalAuth(request: FastifyRequest): boolean {
  const authHeader = request.headers.authorization?.trim();
  if (!authHeader) return false;
  const [scheme, token] = authHeader.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return false;

  const expected = process.env.PROXY_API_TOKEN?.trim() || process.env.PROXY_CUSTOMER_API_TOKEN?.trim() || '';
  if (!expected) return false;

  return timingSafeBufferEqual(token, expected);
}

export function registerSsoRoutes(app: FastifyInstance) {
  // Generate a one-time SSO code (called by admin Next.js API route)
  app.post('/sso/librechat/code', async (request, reply) => {
    if (!verifyInternalAuth(request)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as { userId?: string; email?: string; name?: string } | undefined;
    if (!body?.email) {
      return reply.status(400).send({ error: 'email is required' });
    }

    const secret = getSsoSecret();
    if (!secret) {
      request.log.error('missing librechat sso secret');
      return reply.status(500).send({ error: 'SSO secret is not configured' });
    }

    const now = Math.floor(Date.now() / 1000);
    const code = signCode({
      userId: body.userId || randomUUID(),
      email: body.email,
      name: body.name || body.email.split('@')[0] || body.email,
      exp: now + 60,
      nonce: randomUUID(),
    }, secret);

    return reply.send({ code });
  });

  // SSO bridge page — validates code, provisions LibreChat user, sets token, redirects
  app.get('/sso/librechat', async (request, reply) => {
    const { code } = request.query as { code?: string };
    if (!code) return reply.status(400).type('text/html').send(errorPage('Missing SSO code'));

    const secret = getSsoSecret();
    if (!secret) {
      request.log.error('missing librechat sso secret');
      return reply.status(500).type('text/html').send(errorPage('Chat SSO is not configured'));
    }

    const verifyResult = verifyCode(code, secret);
    if (!verifyResult.valid) {
      return reply.status(401).type('text/html').send(errorPage('Invalid or expired SSO code'));
    }
    const { payload } = verifyResult;

    if (usedCodes.has(code)) {
      return reply.status(401).type('text/html').send(errorPage('SSO code already used'));
    }
    usedCodes.set(code, payload.exp);

    const librechatUrl = process.env.LIBRECHAT_INTERNAL_URL?.trim() || 'http://localhost:3080';
    const email = payload.email;
    const name = payload.name;

    // Derive a deterministic password for this user
    const password =
      createHmac('sha256', secret).update(`librechat-user:${email}`).digest('hex').slice(0, 28) +
      'Zz9!';

    // Register (ignore if exists)
    try {
      const registerRes = await fetch(`${librechatUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          username: (email.split('@')[0] ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 20) || 'user',
          password,
          confirm_password: password,
        }),
      });
      if (!registerRes.ok) {
        request.log.info({ status: registerRes.status }, 'LibreChat register not successful (continuing)');
      }
    } catch (err) {
      request.log.warn({ err }, 'LibreChat register call failed (user may already exist)');
    }

    // Login — capture response cookies for HttpOnly auth (LibreChat ≥ 0.7)
    let librechatToken = '';
    const setCookieHeaders: string[] = [];
    try {
      const loginRes = await fetch(`${librechatUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!loginRes.ok) {
        request.log.error({ status: loginRes.status }, 'LibreChat login failed');
        return reply.status(502).type('text/html').send(errorPage('Chat service authentication failed'));
      }
      // Forward Set-Cookie headers from LibreChat (refreshToken, token_provider)
      const rawCookies = loginRes.headers.getSetCookie?.() ?? [];
      for (const cookie of rawCookies) {
        setCookieHeaders.push(cookie);
      }
      const loginData = (await loginRes.json()) as { token?: string };
      librechatToken = typeof loginData.token === 'string' ? loginData.token : '';
    } catch (err) {
      request.log.error({ err }, 'LibreChat login failed');
      return reply.status(502).type('text/html').send(errorPage('Chat service authentication failed'));
    }

    if (!librechatToken) {
      return reply.status(502).type('text/html').send(errorPage('Chat service returned no token'));
    }

    // Forward LibreChat's auth cookies to the browser
    for (const cookie of setCookieHeaders) {
      void reply.header('Set-Cookie', cookie);
    }

    // Return HTML bridge: sets localStorage token + redirects to LibreChat
    const tokenJson = JSON.stringify(librechatToken);
    return reply.type('text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Loading chat...</title>
<style>body{margin:0;background:#171717;color:#999;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh}
.loader{text-align:center}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#555;margin:0 4px;animation:pulse .6s infinite alternate}
.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes pulse{to{opacity:.2}}</style></head>
<body><div class="loader"><div><span class="dot"></span><span class="dot"></span><span class="dot"></span></div><p>Loading agent builder...</p></div>
<script>
try{localStorage.setItem("token",${tokenJson});
}catch(e){console.error("SSO bridge:",e)}
window.location.replace("/c/new");
</script></body></html>`);
  });
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Error</title>
<style>body{margin:0;background:#171717;color:#e55;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center}</style></head>
<body><div><h2>Authentication Error</h2><p>${message}</p><p><a href="/create" style="color:#999">Back to dashboard</a></p></div></body></html>`;
}
