import * as crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage } from '@webagent/shared/protocol';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { agents, widgetEmbeds } from '../db/schema.js';
import { OpenClawClient } from '../openclaw/client.js';
import { buildAgentSessionKey, getOrCreateSession, touchSessionLastActiveAt } from '../openclaw/sessions.js';
import { detectAgentCreation } from '../routes/api.js';

interface WebSocket {
  readyState: number;
  OPEN: number;
  send(data: string): void;
  close(code?: number, data?: string): void;
  on(event: 'message', listener: (raw: Buffer | string) => void | Promise<void>): void;
  on(event: 'close', listener: () => void): void;
}

interface AuthenticatedSocket {
  ws: WebSocket;
  agentToken: string;
  userId: string;
  agentId: string;
  openclawAgentId: string;
  sessionKey: string;
  authenticated: boolean;
  isAdmin: boolean;
  firstMessage: boolean;
}

interface TokenLookup {
  agentId: string;
  openclawAgentId: string;
  allowedOrigins: string[] | null;
}

interface TokenCacheEntry {
  value: TokenLookup;
  expiresAt: number;
}

const openclawClient = new OpenClawClient();
const TOKEN_CACHE_TTL_MS = 60_000;
const tokenCache = new Map<string, TokenCacheEntry>();

function timingSafeBufferEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function getInternalSecret(): string {
  return (
    process.env.PROXY_INTERNAL_SECRET?.trim()
    || process.env.PROXY_API_TOKEN?.trim()
    || process.env.PROXY_CUSTOMER_API_TOKEN?.trim()
    || ''
  );
}

function verifyWsTicket(ticket: string): string | null {
  const trimmed = ticket.trim();
  const [b64Raw, signatureRaw] = trimmed.split('.');
  const b64 = b64Raw?.trim();
  const signature = signatureRaw?.trim();
  if (!b64 || !signature) {
    return null;
  }

  const secret = getInternalSecret();
  if (!secret) {
    return null;
  }

  const expected = crypto.createHmac('sha256', secret).update(b64).digest('hex');
  if (!timingSafeBufferEqual(signature, expected)) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as unknown;
  } catch {
    return null;
  }

  if (!decoded || typeof decoded !== 'object') {
    return null;
  }

  const payload = decoded as Record<string, unknown>;
  const customerId = typeof payload.customerId === 'string' ? payload.customerId : '';
  const exp = typeof payload.exp === 'number' ? payload.exp : Number.NaN;
  if (!customerId || !Number.isFinite(exp)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (exp < now) {
    return null;
  }

  return customerId;
}

export function invalidateEmbedTokenCache(token?: string): void {
  if (token) {
    tokenCache.delete(token);
    return;
  }

  tokenCache.clear();
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function isOriginAllowed(origin: string | undefined, allowedOrigins: string[] | null): boolean {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return true;
  }

  if (!origin) {
    return false;
  }

  return allowedOrigins.includes(origin);
}

function getCachedTokenLookup(embedToken: string): TokenLookup | null {
  const cached = tokenCache.get(embedToken);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    tokenCache.delete(embedToken);
    return null;
  }

  return cached.value;
}

function setCachedTokenLookup(embedToken: string, value: TokenLookup): void {
  tokenCache.set(embedToken, { value, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
}

async function lookupEmbedToken(db: Database, embedToken: string): Promise<TokenLookup | null> {
  const cached = getCachedTokenLookup(embedToken);
  if (cached) {
    return cached;
  }

  const rows = await db
    .select({
      agentId: agents.id,
      openclawAgentId: agents.openclawAgentId,
      allowedOrigins: widgetEmbeds.allowedOrigins,
    })
    .from(widgetEmbeds)
    .innerJoin(agents, eq(widgetEmbeds.agentId, agents.id))
    .where(and(eq(widgetEmbeds.embedToken, embedToken), eq(agents.status, 'active')))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  const value = {
    agentId: row.agentId,
    openclawAgentId: row.openclawAgentId,
    allowedOrigins: row.allowedOrigins,
  };

  setCachedTokenLookup(embedToken, value);
  return value;
}

export function handleConnection(
  ws: WebSocket,
  ctx: { db: Database; origin?: string; app: FastifyInstance },
) {
  const state: AuthenticatedSocket = {
    ws,
    agentToken: '',
    userId: '',
    agentId: '',
    openclawAgentId: '',
    sessionKey: '',
    authenticated: false,
    isAdmin: false,
    firstMessage: false,
  };

  // 30s auth timeout
  const authTimeout = setTimeout(() => {
    if (!state.authenticated) {
      send(ws, { type: 'auth_error', reason: 'Authentication timeout' });
      ws.close(4001, 'Auth timeout');
    }
  }, 30_000);

  ws.on('message', async (raw: Buffer | string) => {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');

    let msg: ClientMessage;
    try {
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    try {
      if (state.authenticated && !state.isAdmin && msg.type !== 'auth') {
        touchSessionLastActiveAt(ctx.db, state.agentId, state.userId).catch((err) =>
          console.error('Failed to touch session:', err),
        );
      }

      switch (msg.type) {
        case 'auth': {
          if (state.authenticated) {
            send(ws, { type: 'error', message: 'Already authenticated' });
            return;
          }

          if (msg.mode === 'admin') {
            const rawTicket = (msg as { ticket?: unknown }).ticket;
            const ticketCustomerId = typeof rawTicket === 'string' ? verifyWsTicket(rawTicket) : null;
            const authToken = msg.token ?? msg.agentToken;

            if (!ticketCustomerId) {
              const expectedToken = (
                process.env.PROXY_CUSTOMER_API_TOKEN?.trim()
                || process.env.PROXY_API_TOKEN?.trim()
                || process.env.OPENCLAW_GATEWAY_TOKEN?.trim()
              );
              if (!authToken || !expectedToken || !timingSafeBufferEqual(authToken, expectedToken)) {
                send(ws, { type: 'auth_error', reason: 'Invalid admin token' });
                ws.close(4003, 'Invalid admin token');
                return;
              }
            }

            state.agentToken = authToken ?? '';
            state.userId = ticketCustomerId ?? msg.userId;
            state.agentId = 'meta';
            state.openclawAgentId = 'meta';
            state.sessionKey = buildAgentSessionKey('meta', `admin-${state.userId}-${crypto.randomUUID()}`);
            state.authenticated = true;
            state.isAdmin = true;
            state.firstMessage = true;
            clearTimeout(authTimeout);
            send(ws, { type: 'auth_ok', sessionId: state.sessionKey });
            return;
          }

          const authToken = msg.token ?? msg.agentToken;
          if (!authToken) {
            send(ws, { type: 'auth_error', reason: 'Invalid agent token' });
            ws.close(4003, 'Invalid token');
            return;
          }

          let tokenData: TokenLookup | null;
          try {
            tokenData = await lookupEmbedToken(ctx.db, authToken);
          } catch {
            send(ws, { type: 'auth_error', reason: 'Internal server error' });
            ws.close(1011, 'Internal error');
            return;
          }

          if (!tokenData) {
            send(ws, { type: 'auth_error', reason: 'Invalid agent token' });
            ws.close(4003, 'Invalid token');
            return;
          }

          if (!isOriginAllowed(ctx.origin, tokenData.allowedOrigins)) {
            send(ws, { type: 'auth_error', reason: 'Origin not allowed' });
            ws.close(4003, 'Origin not allowed');
            return;
          }

          state.agentToken = authToken;
          state.userId = msg.userId;
          state.agentId = tokenData.agentId;
          state.openclawAgentId = tokenData.openclawAgentId;
          try {
            state.sessionKey = await getOrCreateSession(ctx.db, tokenData.agentId, msg.userId, tokenData.openclawAgentId);
          } catch {
            send(ws, { type: 'auth_error', reason: 'Internal server error' });
            ws.close(1011, 'Internal error');
            return;
          }
          state.authenticated = true;
          state.isAdmin = false;
          state.firstMessage = false;
          clearTimeout(authTimeout);

          send(ws, { type: 'auth_ok', sessionId: state.sessionKey });
          break;
        }

        case 'message': {
          if (!state.authenticated) {
            send(ws, { type: 'auth_error', reason: 'Not authenticated' });
            return;
          }

          if (!msg.content?.trim()) {
            send(ws, { type: 'error', message: 'Empty message' });
            return;
          }

          if (msg.content.length > 10_000) {
            send(ws, { type: 'error', message: 'Message too long (max 10,000 characters)' });
            return;
          }

          try {
            const domain = (process.env.AUTH_URL || 'https://dev.lamoom.com').replace(/\/+$/, '');
            const prefixedAdminMessage
              = `[Lamoom Platform — Agent Creation Session]\nCustomer ID: ${state.userId}\nPlatform domain: ${domain}\n\nCustomer: ${msg.content}`;
            const outboundMessage = state.isAdmin && state.firstMessage ? prefixedAdminMessage : msg.content;
            let streamed = false;
            const result = await openclawClient.sendMessage({
              message: outboundMessage,
              agentId: state.openclawAgentId,
              sessionKey: state.sessionKey,
              onDelta: state.isAdmin
                ? undefined
                : (delta) => {
                    if (!delta) {
                      return;
                    }
                    streamed = true;
                    send(ws, { type: 'message', content: delta, done: false });
                  },
            });

            if (result.success) {
              let responseText = result.response || '';
              if (state.isAdmin && responseText) {
                const created = await detectAgentCreation(responseText, state.userId, ctx.app, domain);
                if (created) {
                  responseText = `${responseText}\n\n${created.embedCode}`;
                }
              }

              if (streamed && !state.isAdmin) {
                send(ws, { type: 'message', content: '', done: true });
              } else {
                send(ws, { type: 'message', content: responseText, done: true });
              }
              if (state.isAdmin) {
                state.firstMessage = false;
              }
            } else {
              send(ws, { type: 'error', message: result.error || 'Agent error' });
            }
          } catch {
            send(ws, { type: 'error', message: 'Internal error processing message' });
          }
          break;
        }

        case 'ping': {
          send(ws, { type: 'pong' });
          break;
        }

        default: {
          send(ws, { type: 'error', message: 'Unknown message type' });
        }
      }
    } catch {
      if (msg.type === 'auth' && !state.authenticated) {
        send(ws, { type: 'auth_error', reason: 'Internal server error' });
        ws.close(1011, 'Internal error');
        return;
      }

      send(ws, { type: 'error', message: 'Internal error processing message' });
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
  });
}
