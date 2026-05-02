import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rmdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import JSON5 from 'json5';
import { OpenClawClient } from '../openclaw/client.js';
import { validateGeneratedWorkspace } from '../openclaw/workspace-validator.js';
import { atomicWriteFile } from '../openclaw/atomic-write.js';
import {
  appendMetaHistoryMessage,
  extractEmbedCodeFromMessages,
  getMetaHistory,
} from '../openclaw/meta-history.js';
import { agents, auditLog, customers, widgetEmbeds, widgetSessions } from '../db/schema.js';
import { invalidateEmbedTokenCache } from '../ws/handler.js';

const localhostIps = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const createInternalAgentBodySchema = z.object({
  customerId: z.string().uuid(),
  openclawAgentId: z.string().min(1),
  name: z.string().min(1),
  websiteUrl: z.string().url().optional(),
  description: z.string().optional(),
  apiDescription: z.string().optional(),
  widgetConfig: z.record(z.string(), z.unknown()).optional(),
  allowedOrigins: z.array(z.string().min(1)).optional(),
});

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const updateAgentBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    websiteUrl: z.string().url().nullable().optional(),
    description: z.string().nullable().optional(),
    status: z.string().min(1).optional(),
    widgetConfig: z.record(z.string(), z.unknown()).optional(),
    apiDescription: z.string().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const createEmbedBodySchema = z.object({
  allowedOrigins: z.array(z.string().min(1)).optional(),
});

const createViaMetaBodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.string().min(1),
      content: z.string(),
    }),
  ),
  sessionId: z.string().min(1).optional(),
});

const customerIdHeaderSchema = z.string().uuid();

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return reply.status(statusCode).send({
    error: {
      code,
      message,
      details,
    },
  });
}

function parseOrError<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
  reply: FastifyReply,
  code: string,
): T | null {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  sendError(reply, 400, code, 'Validation failed', parsed.error.flatten());
  return null;
}

function isLocalhost(request: FastifyRequest): boolean {
  if (localhostIps.has(request.ip)) return true;

  const remoteAddress = request.raw.socket.remoteAddress;
  if (!remoteAddress) return false;
  return localhostIps.has(remoteAddress);
}

function getInternalSecret(): string {
  return (
    process.env.PROXY_INTERNAL_SECRET?.trim()
    || process.env.PROXY_API_TOKEN?.trim()
    || process.env.PROXY_CUSTOMER_API_TOKEN?.trim()
    || ''
  );
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

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return null;
}

type CustomerAuthVerification =
  | { ok: true; customerId: string }
  | { ok: false; message: string };

function verifyCustomerHmac(request: FastifyRequest): CustomerAuthVerification {
  const customerId = getHeaderValue(request.headers['x-customer-id'])?.trim() ?? null;
  const customerSig = getHeaderValue(request.headers['x-customer-sig'])?.trim() ?? null;
  if (!customerId && !customerSig) {
    return { ok: false, message: 'Missing required authentication headers: x-customer-id and x-customer-sig' };
  }
  if (!customerId) {
    return { ok: false, message: 'Missing required authentication header: x-customer-id' };
  }
  if (!customerSig) {
    return { ok: false, message: 'Missing required authentication header: x-customer-sig' };
  }
  const parsedCustomerId = customerIdHeaderSchema.safeParse(customerId);
  if (!parsedCustomerId.success) {
    return { ok: false, message: 'Invalid x-customer-id format; expected UUID' };
  }
  const normalizedCustomerId = parsedCustomerId.data;

  const [signatureRaw, timestampRaw] = customerSig.split(':');
  const signature = signatureRaw?.trim();
  const timestampStr = timestampRaw?.trim();
  if (!signature || !timestampStr) {
    return { ok: false, message: 'Invalid x-customer-sig format; expected "<hex_hmac>:<unix_ts>"' };
  }

  const timestamp = Number.parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, message: 'Invalid x-customer-sig timestamp' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return { ok: false, message: 'Expired or invalid x-customer-sig timestamp' };
  }

  const secret = getInternalSecret();
  if (!secret) {
    return { ok: false, message: 'Customer signature verification is not configured' };
  }

  const expected = createHmac('sha256', secret)
    .update(`${normalizedCustomerId}:${timestamp}`)
    .digest('hex');

  if (!timingSafeBufferEqual(signature, expected)) {
    return { ok: false, message: 'Invalid x-customer-sig signature' };
  }

  return { ok: true, customerId: normalizedCustomerId };
}

function requireCustomerAuth(request: FastifyRequest, reply: FastifyReply): string | null {
  const verification = verifyCustomerHmac(request);
  if (verification.ok) {
    return verification.customerId;
  }

  sendError(reply, 401, 'unauthorized', verification.message);
  return null;
}

async function ensureCustomer(app: FastifyInstance, customerId: string) {
  await app.db
    .insert(customers)
    .values({
      id: customerId,
      email: `customer-${customerId}@webagent.local`,
    })
    .onConflictDoNothing();
}

async function insertAuditLog(
  app: FastifyInstance,
  customerId: string,
  action: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await app.db.insert(auditLog).values({ customerId, action, details: details ?? null });
}

/**
 * Resolve the OpenClaw gateway config path (shared with reconciler).
 *
 * Order: OPENCLAW_CONFIG_PATH > <cwd>/openclaw/config/openclaw.json5
 *        > ~/.openclaw/openclaw.json
 */
export function resolveOpenClawConfigPath(): string {
  return (
    process.env.OPENCLAW_CONFIG_PATH?.trim()
    || join(process.cwd(), 'openclaw', 'config', 'openclaw.json5')
    || join(homedir(), '.openclaw', 'openclaw.json')
  );
}

/**
 * Resolve the directory that contains per-agent workspaces.
 * Mirrors the fallback logic in detectAgentCreation.
 */
export function resolveOpenClawWorkspacesDir(): string {
  return (
    process.env.OPENCLAW_WORKSPACES_DIR?.trim()
    || join(process.cwd(), 'openclaw', 'workspaces')
  );
}

/**
 * Read on-disk agent-config.json for a given slug, trying both the configured
 * workspaces dir and a repo-root fallback. Returns null on any failure.
 */
export async function readAgentConfigFromDisk(
  slug: string,
): Promise<Record<string, unknown> | null> {
  const configuredWorkspacesDir = process.env.OPENCLAW_WORKSPACES_DIR?.trim();
  const primaryWorkspacesDir = configuredWorkspacesDir || join(process.cwd(), 'openclaw', 'workspaces');
  const candidates = [join(primaryWorkspacesDir, slug, 'agent-config.json')];
  if (!configuredWorkspacesDir) {
    const fallbackWorkspacesDir = join(process.cwd(), '..', '..', 'openclaw', 'workspaces');
    const fallbackPath = join(fallbackWorkspacesDir, slug, 'agent-config.json');
    if (fallbackPath !== candidates[0]) candidates.push(fallbackPath);
  }
  for (const p of candidates) {
    try {
      const raw = await readFile(p, 'utf8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {}
  }
  return null;
}

/**
 * Read just the skills array from a workspace's agent-config.json.
 */
export async function getAgentSkillsFromDisk(slug: string): Promise<string[] | undefined> {
  const cfg = await readAgentConfigFromDisk(slug);
  if (!cfg) return undefined;
  const raw = (cfg as { skills?: unknown }).skills;
  if (!Array.isArray(raw)) return undefined;
  const skills = raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  return skills.length > 0 ? skills : undefined;
}

/**
 * Extract a leading comment/whitespace block that appears BEFORE the first
 * top-level `{`. JSON5 files in this repo place all comments inside the
 * object so this is usually empty, but we preserve it when present so a
 * future copyright/license header survives a rewrite. Walks character by
 * character so the cut point is not confused by `{` inside comments.
 */
export function extractLeadingHeader(raw: string): string {
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '/' && raw[i + 1] === '/') {
      const nl = raw.indexOf('\n', i + 2);
      i = nl < 0 ? raw.length : nl + 1;
      continue;
    }
    if (ch === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2);
      i = end < 0 ? raw.length : end + 2;
      continue;
    }
    break;
  }
  return raw.slice(0, i);
}



/**
 * Register (or update) an agent entry in the OpenClaw gateway config and
 * restart/reload the gateway so it picks up the change.
 *
 * If an entry with the same id (slug) already exists, this updates its
 * mutable fields (name, workspace, sandbox, skills, heartbeat) IN PLACE
 * while preserving any additional fields that may have been hand-edited.
 */
export async function registerAgentInOpenClaw(
  slug: string,
  name: string,
  app: FastifyInstance,
  skills?: string[],
): Promise<void> {
  const configPath = resolveOpenClawConfigPath();
  const lockPath = `${configPath}.lock`;
  let staleLockCleaned = false;
  try {
    const lockInfo = await stat(lockPath);
    if (Date.now() - lockInfo.mtimeMs > 60_000) {
      await rmdir(lockPath);
      staleLockCleaned = true;
    }
  } catch {}

  try {
    await mkdir(lockPath, { recursive: false });
  } catch (err) {
    if (staleLockCleaned) {
      try {
        await mkdir(lockPath, { recursive: false });
      } catch (retryErr) {
        app.log.error({ err: retryErr, lockPath }, 'openclaw config lock acquisition failed');
        return;
      }
    } else {
      app.log.error({ err, lockPath }, 'openclaw config lock acquisition failed');
      return;
    }
  }

  try {
    try {
      const raw = await readFile(configPath, 'utf8');
      const config = JSON5.parse(raw) as {
        agents?: { list?: Array<{ id: string; [k: string]: unknown }> };
        [k: string]: unknown;
      };

      if (!config.agents?.list) {
        app.log.warn('openclaw config missing agents.list — skipping registration');
        return;
      }

      // Resolve workspace path for the agent
      const workspacesDir = resolveOpenClawWorkspacesDir();
      const desiredEntry = {
        id: slug,
        name,
        workspace: join(workspacesDir, slug),
        sandbox: { mode: 'off' },
        skills: skills?.length ? skills : ['website-api'],
        heartbeat: { every: '30m' },
      };

      const existingIdx = config.agents.list.findIndex((a) => a.id === slug);
      if (existingIdx >= 0) {
        // 4a: update existing entry in place. Preserve any extra fields that
        // were hand-edited (e.g. custom heartbeat target) by spreading first.
        const existing = config.agents.list[existingIdx]!;
        config.agents.list[existingIdx] = {
          ...existing,
          name: desiredEntry.name,
          workspace: desiredEntry.workspace,
          sandbox: desiredEntry.sandbox,
          skills: desiredEntry.skills,
          // Only set heartbeat if not already present, to preserve overrides.
          heartbeat: (existing as { heartbeat?: unknown }).heartbeat ?? desiredEntry.heartbeat,
        };
        app.log.info({ slug }, 'updated existing openclaw agent entry');
      } else {
        config.agents.list.push(desiredEntry);
        app.log.info({ slug }, 'appended new openclaw agent entry');
      }

      // 4d: preserve a leading comment block from the original file. JSON5 inline
      // comments inside the object are still lost — proper preservation requires
      // a JSON5 CST-aware editor.
      // TODO(#193): replace JSON5.stringify with surgical edits that preserve
      // all inline comments. For now we keep any header comments that appear
      // *before* the opening `{`.
      const header = extractLeadingHeader(raw);
      const serialized = JSON5.stringify(config, null, 2);
      const output = `${header}${serialized}\n`;

      // 4e: atomic write — write to temp file then rename.
      await atomicWriteFile(configPath, output);
      app.log.info({ slug, configPath }, 'registered agent in openclaw config');

      // Try SIGHUP first (no root needed for same-user processes), fall back to systemctl
      const reloaded = await new Promise<boolean>((resolve) => {
        execFile('pgrep', ['-f', 'openclaw.*gateway'], { timeout: 5_000 }, (err, stdout) => {
          if (err || !stdout?.trim()) {
            app.log.warn('could not find openclaw gateway PID via pgrep');
            resolve(false);
            return;
          }
          const pid = stdout.trim().split('\n')[0] ?? '';
          if (!pid) {
            app.log.warn('could not parse openclaw gateway PID from pgrep output');
            resolve(false);
            return;
          }
          execFile('kill', ['-HUP', pid], { timeout: 5_000 }, (killErr) => {
            const killError = killErr as NodeJS.ErrnoException | null;
            if (killError) {
              app.log.warn({ err: killError, pid }, 'SIGHUP failed');
              resolve(false);
            } else {
              app.log.info({ pid }, 'sent SIGHUP to openclaw gateway');
              resolve(true);
            }
          });
        });
      });

      if (!reloaded) {
        await new Promise<void>((resolve) => {
          execFile('sudo', ['systemctl', 'restart', 'openclaw-gateway'], { timeout: 15_000 }, (err) => {
            if (err) {
              app.log.warn({ err }, 'systemctl restart fallback also failed');
            } else {
              app.log.info('openclaw-gateway restarted via systemctl fallback');
            }
            resolve();
          });
        });
      }
    } catch (err) {
      app.log.warn({ err, configPath }, 'failed to register agent in openclaw config');
    }
  } finally {
    try {
      await rmdir(lockPath);
    } catch {}
  }
}

export async function detectAgentCreation(
  responseText: string,
  customerId: string,
  app: FastifyInstance,
  domain: string,
): Promise<
  | { status: 'created'; agent: typeof agents.$inferSelect; embedToken: string; embedCode: string }
  | { status: 'conflict'; slug: string; existingCustomerId: string; message: string }
  | { status: 'validation_failed'; slug: string; errors: string[] }
  | null
> {
  const markerMatch = responseText.match(/\[AGENT_CREATED::\s*<?([a-z0-9_-]+)>?\s*\]/i);
  if (!markerMatch?.[1]) return null;

  const slug = markerMatch[1];
  const configuredWorkspacesDir = process.env.OPENCLAW_WORKSPACES_DIR?.trim();
  const primaryWorkspacesDir = configuredWorkspacesDir || join(process.cwd(), 'openclaw', 'workspaces');
  const configPaths = [join(primaryWorkspacesDir, slug, 'agent-config.json')];
  if (!configuredWorkspacesDir) {
    const fallbackWorkspacesDir = join(process.cwd(), '..', '..', 'openclaw', 'workspaces');
    const fallbackConfigPath = join(fallbackWorkspacesDir, slug, 'agent-config.json');
    if (fallbackConfigPath !== configPaths[0]) {
      configPaths.push(fallbackConfigPath);
    }
  }

  type AgentConfig = {
    agentSlug: string;
    agentName: string;
    websiteName: string;
    websiteUrl: string;
    apiDescription: string;
    apiBaseUrl: string;
    skills?: string[];
    userTokenKey?: string;
    createdAt: string;
  };

  let config: AgentConfig | null = null;
  let resolvedConfigPath: string | null = null;
  let lastReadError: unknown;
  for (const configPath of configPaths) {
    try {
      const rawConfig = await readFile(configPath, 'utf8');
      config = JSON.parse(rawConfig) as AgentConfig;
      resolvedConfigPath = configPath;
      break;
    } catch (error) {
      lastReadError = error;
    }
  }

  if (!config) {
    app.log.warn(
      { error: lastReadError, slug, configPaths },
      'failed to read agent config after creation marker',
    );
    return null;
  }

  const normalizeNullable = (value: string | undefined): string | null => {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  };

  await ensureCustomer(app, customerId);

  const now = new Date();

  const existingBySlugRows = await app.db
    .select()
    .from(agents)
    .where(eq(agents.openclawAgentId, config.agentSlug))
    .limit(1);
  const existingBySlug = existingBySlugRows[0];

  if (existingBySlug && existingBySlug.customerId !== customerId) {
    return {
      status: 'conflict',
      slug: config.agentSlug,
      existingCustomerId: existingBySlug.customerId,
      message: `Agent slug "${config.agentSlug}" is already in use by another customer.`,
    };
  }

  let createdAgent = existingBySlug;
  if (existingBySlug) {
    const updatedRows = await app.db
      .update(agents)
      .set({
        name: config.agentName,
        websiteUrl: normalizeNullable(config.websiteUrl),
        apiDescription: normalizeNullable(config.apiDescription),
        status: 'active',
        updatedAt: now,
      })
      .where(and(eq(agents.id, existingBySlug.id), eq(agents.customerId, customerId)))
      .returning();
    createdAgent = updatedRows[0] ?? existingBySlug;
  } else {
    const createdAgentRows = await app.db
      .insert(agents)
      .values({
        id: randomUUID(),
        name: config.agentName,
        customerId,
        openclawAgentId: config.agentSlug,
        websiteUrl: normalizeNullable(config.websiteUrl),
        apiDescription: normalizeNullable(config.apiDescription),
        description: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: agents.openclawAgentId })
      .returning();

    createdAgent = createdAgentRows[0];
  }

  if (!createdAgent) {
    const conflictingRows = await app.db
      .select()
      .from(agents)
      .where(eq(agents.openclawAgentId, config.agentSlug))
      .limit(1);
    const conflictingAgent = conflictingRows[0];

    if (conflictingAgent?.customerId && conflictingAgent.customerId !== customerId) {
      return {
        status: 'conflict',
        slug: config.agentSlug,
        existingCustomerId: conflictingAgent.customerId,
        message: `Agent slug "${config.agentSlug}" is already in use by another customer.`,
      };
    }

    if (conflictingAgent?.customerId === customerId) {
      const updatedRows = await app.db
        .update(agents)
        .set({
          name: config.agentName,
          websiteUrl: normalizeNullable(config.websiteUrl),
          apiDescription: normalizeNullable(config.apiDescription),
          status: 'active',
          updatedAt: now,
        })
        .where(and(eq(agents.id, conflictingAgent.id), eq(agents.customerId, customerId)))
        .returning();
      createdAgent = updatedRows[0] ?? conflictingAgent;
    }
  }

  if (!createdAgent) {
    app.log.warn(
      { slug: config.agentSlug, customerId },
      'failed to create or resolve agent for customer',
    );
    return null;
  }

  // Validate workspace for unresolved template placeholders and required files
  const workspacePath = join(resolvedConfigPath!, '..');
  const validation = await validateGeneratedWorkspace(workspacePath);
  if (!validation.valid) {
    app.log.warn(
      { slug: config.agentSlug, errors: validation.errors },
      'workspace has validation errors — rejecting agent registration',
    );
    return {
      status: 'validation_failed',
      slug: config.agentSlug,
      errors: validation.errors,
    };
  }

  // Register agent in OpenClaw gateway config and restart gateway
  await registerAgentInOpenClaw(config.agentSlug, config.agentName, app, config.skills);

  const existingEmbedRows = await app.db
    .select()
    .from(widgetEmbeds)
    .where(eq(widgetEmbeds.agentId, createdAgent.id))
    .limit(1);
  const existingEmbed = existingEmbedRows[0];
  const embedToken = existingEmbed?.embedToken ?? randomUUID();
  if (!existingEmbed) {
    await app.db.insert(widgetEmbeds).values({
      id: randomUUID(),
      agentId: createdAgent.id,
      embedToken,
      createdAt: now,
    });
  }
  await insertAuditLog(app, customerId, 'agent.create_via_meta', {
    agentId: createdAgent.id,
    openclawAgentId: config.agentSlug,
    slug,
  });

  const normalizedDomain = domain.replace(/^https?:\/\//i, '');
  const tokenKeyAttr = config.userTokenKey
    ? ` data-user-token-key="${config.userTokenKey}"`
    : '';
  const embedCode
    = `<script src="https://${normalizedDomain}/widget.js" data-agent-token="${embedToken}"${tokenKeyAttr} async></script>`;

  return {
    status: 'created',
    agent: createdAgent,
    embedToken,
    embedCode,
  };
}

export function registerApiRoutes(app: FastifyInstance) {
  const mutationRateLimit = { max: 20, timeWindow: '1 minute' };

  app.post('/api/internal/agents', { config: { rateLimit: mutationRateLimit } }, async (request, reply) => {
    if (!isLocalhost(request)) {
      return sendError(reply, 403, 'forbidden', 'Route is restricted to localhost requests');
    }

    const body = parseOrError(
      createInternalAgentBodySchema,
      request.body,
      reply,
      'invalid_internal_agent_payload',
    );
    if (!body) return;

    try {
      await ensureCustomer(app, body.customerId);

      const createdAgentRows = await app.db
        .insert(agents)
        .values({
          customerId: body.customerId,
          openclawAgentId: body.openclawAgentId,
          name: body.name,
          websiteUrl: body.websiteUrl,
          description: body.description,
          status: 'active',
          widgetConfig: body.widgetConfig ?? {},
          apiDescription: body.apiDescription,
          updatedAt: new Date(),
        })
        .returning();

      const createdAgent = createdAgentRows[0];
      if (!createdAgent) {
        return sendError(reply, 500, 'agent_create_failed', 'Failed to create agent');
      }
      await insertAuditLog(app, body.customerId, 'agent.create', {
        agentId: createdAgent.id,
        openclawAgentId: body.openclawAgentId,
      });

      // 4b: ensure the new agent is registered in the OpenClaw gateway
      // config so it is reachable immediately after creation. Prefer skills
      // from the on-disk agent-config.json (source of truth maintained by
      // the meta agent); fall back to widgetConfig.skills from the request
      // body, then the registerAgentInOpenClaw default ('website-api').
      try {
        const diskSkills = await getAgentSkillsFromDisk(body.openclawAgentId);
        const widgetSkills = (() => {
          const wc = body.widgetConfig as { skills?: unknown } | undefined;
          if (!wc || !Array.isArray(wc.skills)) return undefined;
          const filtered = wc.skills.filter(
            (s): s is string => typeof s === 'string' && s.trim().length > 0,
          );
          return filtered.length > 0 ? filtered : undefined;
        })();
        await registerAgentInOpenClaw(
          body.openclawAgentId,
          body.name,
          app,
          diskSkills ?? widgetSkills,
        );
      } catch (err) {
        request.log.warn(
          { err, openclawAgentId: body.openclawAgentId },
          'failed to register internal agent in openclaw — agent row created but gateway not updated',
        );
      }

      const embedToken = randomUUID();
      const createdEmbedRows = await app.db
        .insert(widgetEmbeds)
        .values({
          agentId: createdAgent.id,
          embedToken,
          allowedOrigins: body.allowedOrigins,
        })
        .returning();

      return reply.status(201).send({
        agent: createdAgent,
        embedToken,
      });
    } catch (error) {
      request.log.error({ error }, 'failed to create internal agent');
      return sendError(reply, 500, 'internal_error', 'Failed to create internal agent');
    }
  });

  app.post('/api/agents/create-via-meta', { config: { rateLimit: mutationRateLimit } }, async (request, reply) => {
    const customerId = requireCustomerAuth(request, reply);
    if (!customerId) return;

    const body = parseOrError(
      createViaMetaBodySchema,
      request.body ?? {},
      reply,
      'invalid_create_via_meta_payload',
    );
    if (!body) return;

    const latestUserMessage = body.messages
      .filter((message) => message.role.toLowerCase() === 'user')
      .map((message) => message.content.trim())
      .filter((message) => message.length > 0)
      .at(-1) ?? '';
    const normalizedLatestMessage = latestUserMessage || 'I want to create a chat agent for my website.';

    if (!normalizedLatestMessage.trim()) {
      return sendError(reply, 400, 'empty_message', 'Message content is required');
    }

    try {
      const history = await getMetaHistory(app.db, customerId);
      const isNewSession = history.messages.length === 0;
      const sessionId = history.sessionId;
      const domain = (process.env.AUTH_URL || 'https://dev.lamoom.com').replace(/\/+$/, '');
      const messageForAgent = isNewSession
        ? `[Lamoom Platform — Agent Creation Session]
Customer ID: ${customerId}
Platform domain: ${domain}

Customer: ${normalizedLatestMessage}`
        : normalizedLatestMessage;

      const openclawClient = new OpenClawClient();
      const agentResponse = await openclawClient.sendMessage({
        message: messageForAgent,
        agentId: 'meta',
        sessionKey: history.openclawSessionKey,
        name: 'agent-builder',
        timeoutSeconds: 240,
      });

      if (!agentResponse.success) {
        request.log.error({ error: agentResponse.error }, 'meta-agent returned error');
        return sendError(
          reply,
          502,
          'meta_error',
          agentResponse.error || 'Agent builder returned an error',
        );
      }

      const responseText = agentResponse.response ?? '';
      await appendMetaHistoryMessage(app.db, customerId, 'user', normalizedLatestMessage);
      await appendMetaHistoryMessage(app.db, customerId, 'assistant', responseText);
      const existingEmbedCode
        = responseText.match(/<script\s[^>]*data-agent-token="[^"]*"[^>]*><\/script>/i)?.[0] ?? '';
      const createdAgentData = await detectAgentCreation(responseText, customerId, app, domain);
      if (createdAgentData?.status === 'conflict') {
        return sendError(
          reply,
          409,
          'agent_slug_conflict',
          `${createdAgentData.message} Please retry with a more unique website or agent name.`,
          { slug: createdAgentData.slug },
        );
      }
      if (createdAgentData?.status === 'validation_failed') {
        const errorList = createdAgentData.errors.slice(0, 10).join('\n');
        const sentinel = `[AGENT_VALIDATION_FAILED::${createdAgentData.slug}::${errorList}]`;
        return reply.send({
          data: {
            response: `${responseText}\n\n${sentinel}`,
            sessionId,
            agent: null,
            embedToken: null,
            embedCode: null,
          },
        });
      }

      return reply.send({
        data: {
          response: responseText,
          sessionId,
          agent: createdAgentData?.status === 'created' ? createdAgentData.agent : null,
          embedToken: createdAgentData?.status === 'created' ? createdAgentData.embedToken : null,
          embedCode:
            createdAgentData?.status === 'created' ? createdAgentData.embedCode : existingEmbedCode,
        },
      });
    } catch (error) {
      request.log.error({ error }, 'OpenClaw meta-agent unreachable');
      return sendError(
        reply,
        503,
        'meta_unavailable',
        'Agent builder service is temporarily unavailable. Please try again.',
      );
    }
  });

  app.get('/api/agents/meta-history', async (request, reply) => {
    const customerId = requireCustomerAuth(request, reply);
    if (!customerId) return;

    try {
      const history = await getMetaHistory(app.db, customerId);
      return reply.send({
        data: {
          sessionId: history.sessionId,
          messages: history.messages.map(({ role, content, createdAt }) => ({
            role,
            content,
            createdAt,
          })),
          embedCode: extractEmbedCodeFromMessages(history.messages),
        },
      });
    } catch (error) {
      request.log.error({ error }, 'failed to fetch meta-agent history');
      return sendError(reply, 500, 'internal_error', 'Failed to fetch meta-agent history');
    }
  });

  app.get('/api/agents', async (request, reply) => {
    const customerId = requireCustomerAuth(request, reply);
    if (!customerId) return;

    try {
      const rows = await app.db
        .select()
        .from(agents)
        .where(and(eq(agents.customerId, customerId), ne(agents.status, 'deleted')));

      let sessionCountByAgentId = new Map<string, number>();
      if (rows.length > 0) {
        try {
          const sessionCountRows = await app.db
            .select({
              agentId: widgetSessions.agentId,
              sessionCount: count(widgetSessions.id),
            })
            .from(widgetSessions)
            .innerJoin(agents, eq(widgetSessions.agentId, agents.id))
            .where(and(eq(agents.customerId, customerId), ne(agents.status, 'deleted')))
            .groupBy(widgetSessions.agentId);

          sessionCountByAgentId = new Map(
            sessionCountRows.map((row) => [row.agentId, Number(row.sessionCount) || 0]),
          );
        } catch {
          // session counts are optional
        }
      }

      return reply.send({
        data: rows.map((row) => ({
          ...row,
          sessionCount: sessionCountByAgentId.get(row.id) ?? 0,
        })),
      });
    } catch (error) {
      request.log.error({ err: error instanceof Error ? { message: error.message, stack: error.stack } : error }, 'failed to list agents');
      return sendError(reply, 500, 'internal_error', 'Failed to list agents');
    }
  });

  app.get('/api/agents/:id', async (request, reply) => {
    const customerId = requireCustomerAuth(request, reply);
    if (!customerId) return;

    const params = parseOrError(idParamsSchema, request.params, reply, 'invalid_agent_id');
    if (!params) return;

    try {
      const rows = await app.db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.id, params.id),
            eq(agents.customerId, customerId),
            ne(agents.status, 'deleted'),
          ),
        )
        .limit(1);
      const agent = rows[0];
      if (!agent) {
        return sendError(reply, 404, 'not_found', 'Agent not found');
      }

      const embedRows = await app.db
        .select()
        .from(widgetEmbeds)
        .where(eq(widgetEmbeds.agentId, params.id))
        .limit(1);
      const embed = embedRows[0] ?? null;

      return reply.send({
        data: {
          ...agent,
          embed,
          embedToken: embed?.embedToken ?? null,
          allowedOrigins: embed?.allowedOrigins ?? null,
          widgetConfig: agent.widgetConfig
            ? { ...(agent.widgetConfig as Record<string, unknown>), authContext: { configured: true } }
            : null,
        },
      });
    } catch (error) {
      request.log.error({ error }, 'failed to fetch agent');
      return sendError(reply, 500, 'internal_error', 'Failed to fetch agent');
    }
  });

  app.patch('/api/agents/:id', { config: { rateLimit: mutationRateLimit } }, async (request, reply) => {
    const customerId = requireCustomerAuth(request, reply);
    if (!customerId) return;

    const params = parseOrError(idParamsSchema, request.params, reply, 'invalid_agent_id');
    if (!params) return;

    const body = parseOrError(updateAgentBodySchema, request.body, reply, 'invalid_agent_patch');
    if (!body) return;

    try {
      const existingAgentRows = await app.db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.id, params.id),
            eq(agents.customerId, customerId),
            ne(agents.status, 'deleted'),
          ),
        )
        .limit(1);
      const existingAgent = existingAgentRows[0];
      if (!existingAgent) {
        return sendError(reply, 404, 'not_found', 'Agent not found');
      }

      // Deep-merge widgetConfig to preserve existing keys like 'skills'
      const mergedBody = { ...body };
      if (body.widgetConfig && existingAgent.widgetConfig) {
        mergedBody.widgetConfig = {
          ...(existingAgent.widgetConfig as Record<string, unknown>),
          ...body.widgetConfig,
        };
      }

      const updatedRows = await app.db
        .update(agents)
        .set({
          ...mergedBody,
          updatedAt: new Date(),
        })
        .where(and(eq(agents.id, params.id), eq(agents.customerId, customerId)))
        .returning();

      const updated = updatedRows[0];
      if (!updated) {
        return sendError(reply, 404, 'not_found', 'Agent not found');
      }
      await insertAuditLog(app, customerId, 'agent.update', {
        agentId: params.id,
        fields: Object.keys(body),
      });

      if (body.status && body.status !== existingAgent.status) {
        const embedRows = await app.db
          .select({ embedToken: widgetEmbeds.embedToken })
          .from(widgetEmbeds)
          .where(eq(widgetEmbeds.agentId, params.id));
        for (const embedRow of embedRows) {
          invalidateEmbedTokenCache(embedRow.embedToken);
        }
      }

      // Invalidate cache when widgetConfig changes
      if (body.widgetConfig) {
        const embedRows = await app.db
          .select({ embedToken: widgetEmbeds.embedToken })
          .from(widgetEmbeds)
          .where(eq(widgetEmbeds.agentId, params.id));
        for (const embedRow of embedRows) {
          invalidateEmbedTokenCache(embedRow.embedToken);
        }
      }

      return reply.send({ data: updated });
    } catch (error) {
      request.log.error({ error }, 'failed to update agent');
      return sendError(reply, 500, 'internal_error', 'Failed to update agent');
    }
  });

  app.delete('/api/agents/:id', { config: { rateLimit: mutationRateLimit } }, async (request, reply) => {
    const customerId = requireCustomerAuth(request, reply);
    if (!customerId) return;

    const params = parseOrError(idParamsSchema, request.params, reply, 'invalid_agent_id');
    if (!params) return;

    try {
      const embedRows = await app.db
        .select({ embedToken: widgetEmbeds.embedToken })
        .from(widgetEmbeds)
        .innerJoin(agents, eq(widgetEmbeds.agentId, agents.id))
        .where(and(eq(agents.id, params.id), eq(agents.customerId, customerId)));

      const updatedRows = await app.db
        .update(agents)
        .set({
          status: 'deleted',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agents.id, params.id),
            eq(agents.customerId, customerId),
            ne(agents.status, 'deleted'),
          ),
        )
        .returning();

      const updated = updatedRows[0];
      if (!updated) {
        return sendError(reply, 404, 'not_found', 'Agent not found');
      }
      await insertAuditLog(app, customerId, 'agent.delete', { agentId: params.id });

      for (const embedRow of embedRows) {
        invalidateEmbedTokenCache(embedRow.embedToken);
      }

      return reply.send({ data: updated });
    } catch (error) {
      request.log.error({ error }, 'failed to soft delete agent');
      return sendError(reply, 500, 'internal_error', 'Failed to soft delete agent');
    }
  });

  app.post('/api/agents/:id/embed-token', { config: { rateLimit: mutationRateLimit } }, async (request, reply) => {
    const customerId = requireCustomerAuth(request, reply);
    if (!customerId) return;

    const params = parseOrError(idParamsSchema, request.params, reply, 'invalid_agent_id');
    if (!params) return;

    const body = parseOrError(createEmbedBodySchema, request.body ?? {}, reply, 'invalid_embed_payload');
    if (!body) return;

    try {
      const existingRows = await app.db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.id, params.id),
            eq(agents.customerId, customerId),
            ne(agents.status, 'deleted'),
          ),
        )
        .limit(1);

      if (!existingRows[0]) {
        return sendError(reply, 404, 'not_found', 'Agent not found');
      }

      const embedRows = await app.db
        .select()
        .from(widgetEmbeds)
        .where(eq(widgetEmbeds.agentId, params.id))
        .limit(1);

      const existingEmbed = embedRows[0];
      const embedToken = randomUUID();

      if (existingEmbed) {
        await app.db
          .update(widgetEmbeds)
          .set({
            embedToken,
            allowedOrigins: body.allowedOrigins ?? existingEmbed.allowedOrigins,
          })
          .where(eq(widgetEmbeds.id, existingEmbed.id));
        invalidateEmbedTokenCache(existingEmbed.embedToken);
      } else {
        await app.db.insert(widgetEmbeds).values({
          agentId: params.id,
          embedToken,
          allowedOrigins: body.allowedOrigins,
        });
      }

      invalidateEmbedTokenCache(embedToken);
      await insertAuditLog(app, customerId, 'embed.rotate', { agentId: params.id });

      return reply.send({ embedToken });
    } catch (error) {
      request.log.error({ error }, 'failed to create embed token');
      return sendError(reply, 500, 'internal_error', 'Failed to create embed token');
    }
  });

  // ─── Web-Fetch Proxy ──────────────────────────────────────────────────────

  const webFetchBodySchema = z.object({
    url: z.string().url(),
    method: z.string().min(1).max(16).optional().default('GET'),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.unknown().optional(),
  });

  const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    'metadata.google.internal',
    '169.254.169.254', // AWS/GCP/Azure IMDS
  ]);

  function isBlockedUrl(raw: string): boolean {
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      if (BLOCKED_HOSTNAMES.has(host)) return true;
      // Block private IPv4 ranges
      const parts = host.split('.').map(Number);
      if (parts.length === 4 && parts.every((p) => p >= 0 && p <= 255)) {
        const [a, b] = parts as [number, number, number, number];
        if (a === 10) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  type VerifiedEmbedRow = {
    id: string;
    embedToken: string;
    allowedOrigins: string[] | null;
    agentId: string;
  };

  /**
   * Verify a widget embed token from Authorization header or explicit token.
   * Returns embed metadata needed by handlers.
   */
  async function verifyEmbedTokenFull(
    request: FastifyRequest,
    reply: FastifyReply,
    tokenInput?: string,
  ): Promise<{ id: string; allowedOrigins: string[] | null; agentId: string } | null> {
    const authHeader = getHeaderValue(request.headers['authorization']);
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const token = tokenInput?.trim() || bearerToken || null;
    if (!token) {
      sendError(reply, 401, 'unauthorized', 'Missing Authorization: Bearer <embed_token> header');
      return null;
    }
    const rows = await app.db
      .select({
        id: widgetEmbeds.id,
        agentId: widgetEmbeds.agentId,
        allowedOrigins: widgetEmbeds.allowedOrigins,
      })
      .from(widgetEmbeds)
      .where(eq(widgetEmbeds.embedToken, token))
      .limit(1);
    const embed = rows[0];
    if (!embed) {
      sendError(reply, 401, 'unauthorized', 'Invalid embed token');
      return null;
    }
    return embed;
  }

  function resolveSourceOrigin(request: FastifyRequest): string | null {
    const origin = getHeaderValue(request.headers['origin']);
    if (origin) {
      return origin;
    }

    const referer = getHeaderValue(request.headers['referer']);
    if (!referer) {
      return null;
    }

    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }


  function originMatches(sourceOrigin: string, allowed: string): boolean {
    try {
      const sourceHost = new URL(sourceOrigin).hostname;
      const allowedHost = new URL(allowed).hostname;
      return sourceHost === allowedHost || sourceHost.endsWith('.' + allowedHost);
    } catch {
      return sourceOrigin === allowed;
    }
  }

  function ensureAllowedOrigin(
    request: FastifyRequest,
    reply: FastifyReply,
    allowedOrigins: string[] | null,
  ): boolean {
    if (!allowedOrigins || allowedOrigins.length === 0) {
      return true;
    }

    const sourceOrigin = resolveSourceOrigin(request);
    if (!sourceOrigin || !allowedOrigins.some((o) => originMatches(sourceOrigin, o))) {
      sendError(reply, 403, 'origin_not_allowed', 'Request origin not permitted');
      return false;
    }

    return true;
  }

  app.post(
    '/api/fetch',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const embed = await verifyEmbedTokenFull(request, reply);
      if (!embed) return;

      const body = parseOrError(webFetchBodySchema, request.body, reply, 'invalid_fetch_payload');
      if (!body) return;

      if (isBlockedUrl(body.url)) {
        return sendError(reply, 400, 'blocked_url', 'Target URL is not allowed');
      }

      if (!ensureAllowedOrigin(request, reply, embed.allowedOrigins ?? null)) {
        return;
      }

      try {
        const fetchInit: RequestInit = {
          method: (body.method ?? 'GET').toUpperCase(),
          headers: body.headers as Record<string, string>,
        };
        if (body.body !== undefined && fetchInit.method !== 'GET' && fetchInit.method !== 'HEAD') {
          fetchInit.body = typeof body.body === 'string' ? body.body : JSON.stringify(body.body);
        }

        const upstream = await fetch(body.url, fetchInit);
        const contentType = upstream.headers.get('content-type') ?? '';
        const responseBody = await upstream.text();

        return reply.send({
          status: upstream.status,
          statusText: upstream.statusText,
          headers: Object.fromEntries(upstream.headers.entries()),
          body: responseBody,
          contentType,
        });
      } catch (error) {
        request.log.warn({ error, url: body.url }, 'web-fetch proxy upstream error');
        return sendError(reply, 502, 'fetch_error', 'Failed to fetch upstream URL');
      }
    },
  );

  // ─── Escalation ───────────────────────────────────────────────────────────

  const escalateBodySchema = z.object({
    token: z.string().min(1),
    userId: z.string().min(1),
    email: z.string().email(),
    name: z.string().optional().default(''),
    context: z.string().optional().default(''),
    transcript: z
      .array(z.object({ role: z.string(), content: z.string() }))
      .max(20)
      .optional()
      .default([]),
  });

  app.post(
    '/api/escalate',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const body = parseOrError(escalateBodySchema, request.body, reply, 'invalid_escalate_payload');
      if (!body) return;

      // Validate embed token
      const embed = await verifyEmbedTokenFull(request, reply, body.token);
      if (!embed) {
        return;
      }

      if (!ensureAllowedOrigin(request, reply, embed.allowedOrigins ?? null)) {
        return;
      }

      // Store ticket in audit log — reusing existing infrastructure
      await app.db.insert(auditLog).values({
        customerId: null,
        action: 'widget.escalation',
        details: {
          agentId: embed.agentId,
          userId: body.userId,
          email: body.email,
          name: body.name,
          context: body.context,
          transcriptLength: body.transcript.length,
          transcript: body.transcript,
        },
      });

      request.log.info(
        { agentId: embed.agentId, userId: body.userId, email: body.email },
        'escalation ticket received',
      );

      return reply.status(202).send({ ok: true });
    },
  );
}
