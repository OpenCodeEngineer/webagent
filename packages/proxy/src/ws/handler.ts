import * as crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage } from '@webagent/shared/protocol';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { agents, widgetEmbeds } from '../db/schema.js';
import { OpenClawClient } from '../openclaw/client.js';
import {
  appendMetaHistoryMessage,
  extractEmbedCodeFromMessages,
  getMetaHistory,
} from '../openclaw/meta-history.js';
import { getOrCreateSession, touchSessionLastActiveAt } from '../openclaw/sessions.js';
import { detectAgentCreation, getAgentSkillsFromDisk, registerAgentInOpenClaw } from '../routes/api.js';

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
  userContext: Record<string, unknown>;
  unknownAgentRepairAttempted: boolean;
}

interface TokenLookup {
  agentId: string;
  openclawAgentId: string;
  allowedOrigins: string[] | null;
  widgetConfig: Record<string, unknown> | null;
}

interface TokenCacheEntry {
  value: TokenLookup;
  expiresAt: number;
}

const openclawClient = new OpenClawClient();
const TOKEN_CACHE_TTL_MS = 60_000;
const MAX_FILES = 5;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 120;
const ADMIN_UPLOADS_ROOT = '/opt/webagent/openclaw/workspaces/meta/uploads';
const tokenCache = new Map<string, TokenCacheEntry>();

function isUnknownAgentError(message?: string): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return normalized.includes('unknown agent') || normalized.includes('invalid agent params');
}

function getSkillsFromWidgetConfig(widgetConfig: unknown): string[] | undefined {
  if (!widgetConfig || typeof widgetConfig !== 'object' || Array.isArray(widgetConfig)) {
    return undefined;
  }

  const maybeSkills = (widgetConfig as Record<string, unknown>).skills;
  if (!Array.isArray(maybeSkills)) {
    return undefined;
  }

  const skills = maybeSkills.filter((skill): skill is string => typeof skill === 'string' && skill.trim().length > 0);
  return skills.length > 0 ? skills : undefined;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatContextValue(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);
      if (typeof serialized === 'string') {
        return serialized;
      }
    } catch {
      // Fall back below.
    }
  }
  return String(value);
}

function normalizeSessionAuthContext(rawContext: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...rawContext };
  const authHeader = typeof normalized.Authorization === 'string' ? normalized.Authorization.trim() : '';
  const bearer = typeof normalized.Bearer === 'string' ? normalized.Bearer.trim() : '';
  const apiToken = typeof normalized.apiToken === 'string' ? normalized.apiToken.trim() : '';
  const legacyToken = typeof normalized.token === 'string' ? normalized.token.trim() : '';
  const headers = isRecord(normalized.headers) ? normalized.headers : null;
  const headerAuth = headers && typeof headers.Authorization === 'string'
    ? headers.Authorization.trim()
    : '';

  const preferredToken = apiToken || legacyToken;
  if (!normalized.apiToken && preferredToken) {
    normalized.apiToken = preferredToken;
  }

  if (!normalized.Bearer && preferredToken) {
    normalized.Bearer = preferredToken;
  }

  if (!authHeader) {
    if (headerAuth) {
      normalized.Authorization = headerAuth;
    } else if (bearer) {
      normalized.Authorization = bearer.toLowerCase().startsWith('bearer ')
        ? bearer
        : `Bearer ${bearer}`;
    } else if (preferredToken) {
      normalized.Authorization = `Bearer ${preferredToken}`;
    }
  }

  return normalized;
}

export function buildWidgetMessageWithSessionPolicy(userContext: Record<string, unknown>, customerContent: string): string {
  const credentialPolicy
    = 'Credential source: server-side session auth context provided by the widget/integration backend.\n'
    + 'Never ask end users to fetch or copy JWTs/tokens from DevTools, localStorage, sessionStorage, cookies, or network tabs.\n'
    + 'Never reveal, display, echo, or include raw credential/token values in your responses. '
    + 'Use them ONLY in fetch/API tool call headers. If a user asks for the token, decline.';
  const fallbackGuidance
    = 'If an API call needs authentication and session context is missing:\n'
    + '1. State the exact API call you would make (method, path, body) so the user knows what will happen.\n'
    + '2. Explain: "I need session auth context to execute this. An admin must configure the `Authorization` or `apiToken` field in the widget integration settings (Settings → Integrations → Auth Context)."\n'
    + '3. Never give a vague refusal — always name the endpoint (e.g., `POST /api/v1/tenants/:id/restart`) and confirm expected outcome + that you will execute it once credentials are available.';
  if (Object.keys(userContext).length > 0) {
    // Determine if actual credentials are present
    const hasToken = typeof userContext.apiToken === 'string' && (userContext.apiToken as string).trim() !== '';
    const hasAuthorization = typeof userContext.Authorization === 'string' && (userContext.Authorization as string).trim() !== '';
    const hasHeaders = isRecord(userContext.headers) && Object.keys(userContext.headers).length > 0;
    const hasCredentials = hasToken || hasAuthorization || hasHeaders;

    const credentialStatus = hasCredentials
      ? 'Authentication credentials are configured and will be injected into API requests automatically. Proceed with API calls confidently — do not ask the user to provide credentials.'
      : 'Auth context is present but contains no usable credentials. If the user needs to make authenticated API calls, direct them to the admin dashboard to configure credentials.';

    const contextLines = Object.entries(userContext)
      .map(([k, v]) => `${k}: ${formatContextValue(v)}`)
      .join('\n');
    return `[Session Context]\n${credentialPolicy}\n${credentialStatus}\n${fallbackGuidance}\n${contextLines}\n\nUser: ${customerContent}`;
  }

  return `[Session Context — no credentials]\n${credentialPolicy}\nNo API credentials are configured. If the user needs to make authenticated API calls, direct them to the admin dashboard to configure credentials.\n${fallbackGuidance}\n\nUser: ${customerContent}`;
}

function isStrictBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;
}

function sanitizeSessionId(sessionKey: string): string {
  const safe = sessionKey
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'session';
}

function sanitizeFileName(name: string): string {
  const baseName = path.basename(name).normalize('NFKC').trim();
  const stripped = baseName
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.\.+/g, '.');
  return stripped.slice(0, MAX_FILENAME_LENGTH);
}

interface ValidatedAttachment {
  originalName: string;
  mimeType: string;
  data: Buffer;
  safeName: string;
}

function validateAttachments(raw: unknown): { valid: true; attachments: ValidatedAttachment[] } | { valid: false; error: string } {
  if (raw === undefined) {
    return { valid: true, attachments: [] };
  }

  if (!Array.isArray(raw)) {
    return { valid: false, error: 'Attachments must be an array' };
  }

  if (raw.length > MAX_FILES) {
    return { valid: false, error: `Too many attachments (max ${MAX_FILES})` };
  }

  const validated: ValidatedAttachment[] = [];
  let totalSize = 0;

  for (const item of raw) {
    if (!isRecord(item)) {
      return { valid: false, error: 'Each attachment must be an object' };
    }

    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const mimeType = typeof item.type === 'string' ? item.type.trim() : '';
    const base64 = typeof item.data === 'string' ? item.data.trim() : '';

    if (!name) {
      return { valid: false, error: 'Attachment name is required' };
    }

    if (name.length > MAX_FILENAME_LENGTH) {
      return { valid: false, error: `Attachment name too long (max ${MAX_FILENAME_LENGTH} characters)` };
    }

    if (!mimeType) {
      return { valid: false, error: 'Attachment MIME type is required' };
    }

    if (!base64) {
      return { valid: false, error: 'Attachment data must be a non-empty base64 string' };
    }

    if (!isStrictBase64(base64)) {
      return { valid: false, error: `Invalid base64 payload for attachment ${name}` };
    }

    let decoded: Buffer;
    try {
      decoded = Buffer.from(base64, 'base64');
    } catch {
      return { valid: false, error: `Unable to decode attachment ${name}` };
    }

    if (decoded.length === 0) {
      return { valid: false, error: `Attachment ${name} decoded to empty content` };
    }

    if (decoded.length > MAX_FILE_SIZE_BYTES) {
      return { valid: false, error: `Attachment ${name} exceeds max size of ${MAX_FILE_SIZE_BYTES} bytes` };
    }

    totalSize += decoded.length;
    if (totalSize > MAX_TOTAL_FILE_SIZE_BYTES) {
      return { valid: false, error: `Total attachment size exceeds ${MAX_TOTAL_FILE_SIZE_BYTES} bytes` };
    }

    const safeName = sanitizeFileName(name);
    if (!safeName) {
      return { valid: false, error: `Attachment ${name} has an invalid filename` };
    }

    validated.push({ originalName: name, mimeType, data: decoded, safeName });
  }

  return { valid: true, attachments: validated };
}

async function persistAdminAttachments(sessionKey: string, attachments: ValidatedAttachment[]): Promise<string[]> {
  if (attachments.length === 0) {
    return [];
  }

  const sessionSafeId = sanitizeSessionId(sessionKey);
  const uploadDir = path.join(ADMIN_UPLOADS_ROOT, sessionSafeId);

  try {
    await mkdir(uploadDir, { recursive: true });
  } catch (err) {
    console.error('Failed to create attachment upload directory:', { uploadDir, sessionSafeId, err });
    throw new Error('Unable to prepare attachment upload directory');
  }

  const relativePaths: string[] = [];
  for (const [index, attachment] of attachments.entries()) {
    const timestamp = new Date(Date.now() + index).toISOString().replace(/[:.]/g, '-');
    const fileName = `${timestamp}-${attachment.safeName}`;
    const absolutePath = path.join(uploadDir, fileName);
    const relativePath = `uploads/${sessionSafeId}/${fileName}`;

    try {
      await writeFile(absolutePath, attachment.data);
    } catch (err) {
      console.error('Failed to write attachment file:', {
        absolutePath,
        sessionSafeId,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        err,
      });
      throw new Error(`Unable to save attachment ${attachment.originalName}`);
    }

    relativePaths.push(relativePath);
  }

  return relativePaths;
}

function buildAttachmentContext(relativePaths: string[]): string {
  return `Attached files saved in workspace:
${relativePaths.map((relativePath) => `- ${relativePath}`).join('\n')}
Use these files as source context.`;
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
      widgetConfig: agents.widgetConfig,
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
    widgetConfig: row.widgetConfig as Record<string, unknown> | null,
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
    userContext: {},
    unknownAgentRepairAttempted: false,
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

            let history: Awaited<ReturnType<typeof getMetaHistory>> | null = null;
            try {
              history = await getMetaHistory(ctx.db, state.userId);
            } catch (err) {
              console.error('Failed to load meta history during admin auth — falling back to fresh session:', err);
            }

            state.sessionKey = history?.openclawSessionKey
              ?? `agent:meta:admin-${state.userId}-${crypto.randomUUID()}`;
            state.authenticated = true;
            state.isAdmin = true;
            state.firstMessage = !history || history.messages.length === 0;
            clearTimeout(authTimeout);
            send(ws, { type: 'auth_ok', sessionId: state.sessionKey });
            send(ws, {
              type: 'history',
              sessionId: history?.sessionId ?? '',
              messages: history?.messages.map(({ role, content }) => ({ role, content })) ?? [],
              embedCode: history ? extractEmbedCodeFromMessages(history.messages) : '',
            });
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

          // Inject server-side auth context from agent config (takes priority)
          const serverAuthCtx = tokenData.widgetConfig?.authContext;
          if (serverAuthCtx && typeof serverAuthCtx === 'object' && !Array.isArray(serverAuthCtx)) {
            state.userContext = normalizeSessionAuthContext(serverAuthCtx as Record<string, unknown>);
          }

          // Client context: allow auth passthrough only when widgetConfig.allowClientAuth is true
          const allowClientAuth = !!(tokenData.widgetConfig as Record<string, unknown> | null)?.allowClientAuth;
          const rawContext = msg.context;
          if (rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext)) {
            const clientCtx = rawContext as Record<string, unknown>;
            const AUTH_KEYS = new Set(['Authorization', 'Bearer', 'apiToken', 'token', 'headers']);
            for (const [k, v] of Object.entries(clientCtx)) {
              if (allowClientAuth || !AUTH_KEYS.has(k)) {
                state.userContext[k] = v;
              }
            }
            if (Object.keys(state.userContext).length > 0) {
              state.firstMessage = true;
            }
          }

          state.authenticated = true;
          state.isAdmin = false;
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
            let customerContent = msg.content;

            const messageWithAttachments = msg as { attachments?: unknown };
            if (!state.isAdmin && messageWithAttachments.attachments !== undefined) {
              send(ws, { type: 'error', message: 'Attachments are only supported in admin mode' });
              return;
            }

            if (state.isAdmin) {
              const adminMessage = msg as { attachments?: unknown };
              const rawAttachments = adminMessage.attachments;
              const validated = validateAttachments(rawAttachments);
              if (!validated.valid) {
                send(ws, { type: 'error', message: validated.error });
                return;
              }

              if (validated.attachments.length > 0) {
                let relativePaths: string[];
                try {
                  relativePaths = await persistAdminAttachments(state.sessionKey, validated.attachments);
                } catch (err) {
                  console.error('Failed to persist admin attachments:', {
                    sessionKey: state.sessionKey,
                    userId: state.userId,
                    err,
                  });
                  send(ws, { type: 'error', message: 'Failed to save attachments' });
                  return;
                }

                customerContent = `${buildAttachmentContext(relativePaths)}\n\n${msg.content}`;
              }
            }

            const prefixedAdminMessage
              = `[Lamoom Platform — Agent Creation Session]\nCustomer ID: ${state.userId}\nPlatform domain: ${domain}\n\nCustomer: ${customerContent}`;

            let outboundMessage: string;
            if (state.isAdmin && state.firstMessage) {
              outboundMessage = prefixedAdminMessage;
            } else if (!state.isAdmin) {
              outboundMessage = buildWidgetMessageWithSessionPolicy(state.userContext, customerContent);
            } else {
              outboundMessage = customerContent;
            }
            let streamed = false;
            let result = await openclawClient.sendMessage({
              message: outboundMessage,
              agentId: state.openclawAgentId,
              sessionKey: state.sessionKey,
              onDelta: (delta) => {
                if (!delta) {
                  return;
                }
                streamed = true;
                send(ws, { type: 'message', content: delta, done: false });
              },
            });

            if (
              !result.success
              && !state.isAdmin
              && !state.unknownAgentRepairAttempted
              && isUnknownAgentError(result.error)
            ) {
              state.unknownAgentRepairAttempted = true;
              ctx.app.log.info(
                { agentId: state.agentId, openclawAgentId: state.openclawAgentId, sessionKey: state.sessionKey },
                'unknown agent from openclaw; attempting registration self-heal',
              );
              try {
                const rows = await ctx.db
                  .select({
                    openclawAgentId: agents.openclawAgentId,
                    name: agents.name,
                    widgetConfig: agents.widgetConfig,
                  })
                  .from(agents)
                  .where(eq(agents.id, state.agentId))
                  .limit(1);
                const agentRow = rows[0];
                if (!agentRow) {
                  ctx.app.log.warn(
                    { agentId: state.agentId, sessionKey: state.sessionKey },
                    'self-heal skipped; agent row not found',
                  );
                } else {
                  // 4c: skills live in on-disk agent-config.json, NOT in widgetConfig
                  // (detectAgentCreation does not persist skills to the DB column).
                  // Read from disk first; fall back to widgetConfig for legacy rows.
                  const diskSkills = await getAgentSkillsFromDisk(agentRow.openclawAgentId);
                  const skills = diskSkills ?? getSkillsFromWidgetConfig(agentRow.widgetConfig);
                  await registerAgentInOpenClaw(agentRow.openclawAgentId, agentRow.name, ctx.app, skills);
                  result = await openclawClient.sendMessage({
                    message: outboundMessage,
                    agentId: state.openclawAgentId,
                    sessionKey: state.sessionKey,
                    onDelta: (delta) => {
                      if (!delta) {
                        return;
                      }
                      streamed = true;
                      send(ws, { type: 'message', content: delta, done: false });
                    },
                  });
                }
              } catch (err) {
                ctx.app.log.error(
                  { err, agentId: state.agentId, openclawAgentId: state.openclawAgentId, sessionKey: state.sessionKey },
                  'self-heal registration attempt failed',
                );
              }
            }

            if (result.success) {
              let responseText = result.response || '';
              let embedSuffix = '';
              if (state.isAdmin && responseText) {
                const created = await detectAgentCreation(responseText, state.userId, ctx.app, domain);
                if (created?.status === 'created') {
                  embedSuffix = `\n\n${created.embedCode}`;
                  responseText = `${responseText}${embedSuffix}`;
                } else if (created?.status === 'conflict') {
                  const conflictMessage
                    = `${created.message} Please retry with a more unique website or agent name.`;
                  send(ws, { type: 'error', message: conflictMessage });
                  embedSuffix = `\n\n⚠️ ${conflictMessage}`;
                  responseText = `${responseText}${embedSuffix}`;
                } else if (created?.status === 'validation_failed') {
                  const errorList = created.errors.slice(0, 10).join('\n');
                  const sentinel = `[AGENT_VALIDATION_FAILED::${created.slug}::${errorList}]`;
                  embedSuffix = `\n\n${sentinel}`;
                  responseText = `${responseText}${embedSuffix}`;
                }
              }

              if (streamed) {
                // Streaming chunks already delivered the main response text.
                // Send any extra suffix (e.g. embed code for admin) as the
                // final done message; widget gets an empty done signal.
                send(ws, { type: 'message', content: embedSuffix, done: true });
              } else {
                send(ws, { type: 'message', content: responseText, done: true });
              }
              if (state.isAdmin) {
                try {
                  await appendMetaHistoryMessage(ctx.db, state.userId, 'user', customerContent);
                  await appendMetaHistoryMessage(ctx.db, state.userId, 'assistant', responseText);
                } catch (err) {
                  console.error('Failed to persist meta history (non-fatal):', err);
                }
              }
              state.firstMessage = false;
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
    } catch (err) {
      console.error('Unhandled WS message error:', { type: msg.type, authenticated: state.authenticated, err });
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
