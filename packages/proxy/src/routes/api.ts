import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rmdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import JSON5 from 'json5';
import { OpenClawClient } from '../openclaw/client.js';
import { buildAgentSessionKey } from '../openclaw/sessions.js';
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

const agentsQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
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

function readBearerToken(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  if (!value) return null;

  const [scheme, token] = value.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

function getCustomerApiToken(): string | null {
  return (
    process.env.PROXY_CUSTOMER_API_TOKEN?.trim()
    || process.env.PROXY_API_TOKEN?.trim()
    || process.env.OPENCLAW_GATEWAY_TOKEN?.trim()
    || null
  );
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

function verifyCustomerHmac(request: FastifyRequest): string | null {
  const customerId = getHeaderValue(request.headers['x-customer-id'])?.trim() ?? null;
  const customerSig = getHeaderValue(request.headers['x-customer-sig'])?.trim() ?? null;
  if (!customerId || !customerSig) {
    return null;
  }

  const [signatureRaw, timestampRaw] = customerSig.split(':');
  const signature = signatureRaw?.trim();
  const timestampStr = timestampRaw?.trim();
  if (!signature || !timestampStr) {
    return null;
  }

  const timestamp = Number.parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return null;
  }

  const secret = getInternalSecret();
  if (!secret) {
    return null;
  }

  const expected = createHmac('sha256', secret)
    .update(`${customerId}:${timestamp}`)
    .digest('hex');

  if (!timingSafeBufferEqual(signature, expected)) {
    return null;
  }

  return customerId;
}

function requireCustomerAuth(request: FastifyRequest, reply: FastifyReply): string | null {
  const hmacCustomerId = verifyCustomerHmac(request);
  if (hmacCustomerId) {
    return hmacCustomerId;
  }

  const expected = getCustomerApiToken();
  const token = readBearerToken(request);
  if (!expected || !token || !timingSafeBufferEqual(token, expected)) {
    sendError(reply, 401, 'unauthorized', 'Invalid or missing credentials');
    return null;
  }

  const query = agentsQuerySchema.safeParse(request.query);
  const customerId = query.success ? query.data.customerId : undefined;
  if (!customerId) {
    sendError(reply, 401, 'unauthorized', 'Missing customerId query parameter for bearer authentication');
    return null;
  }

  request.log.warn('Bearer customer auth is deprecated; use x-customer-id/x-customer-sig headers.');
  return customerId;
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
 * Register a newly created agent in the OpenClaw gateway config (~/.openclaw/openclaw.json)
 * and restart the gateway so it picks up the new agent.
 */
async function registerAgentInOpenClaw(
  slug: string,
  name: string,
  app: FastifyInstance,
): Promise<void> {
  // Resolve config path: OPENCLAW_CONFIG_PATH > /opt/webagent/openclaw/config/openclaw.json5 > ~/.openclaw/openclaw.json
  const configPath =
    process.env.OPENCLAW_CONFIG_PATH?.trim() ||
    join(process.cwd(), 'openclaw', 'config', 'openclaw.json5') ||
    join(homedir(), '.openclaw', 'openclaw.json');
  const lockPath = `${configPath}.lock`;
  try {
    await mkdir(lockPath, { recursive: false });
  } catch (err) {
    app.log.warn({ err, lockPath }, 'openclaw config lock acquisition failed');
    return;
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

      if (config.agents.list.some((a) => a.id === slug)) {
        app.log.info({ slug }, 'agent already in openclaw config — skipping');
        return;
      }

      // Resolve workspace path for the new agent
      const workspacesDir = process.env.OPENCLAW_WORKSPACES_DIR?.trim()
        || join(process.cwd(), 'openclaw', 'workspaces');

      config.agents.list.push({
        id: slug,
        name,
        workspace: join(workspacesDir, slug),
        skills: ['website-api'],
        heartbeat: { every: '30m' },
      });

      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
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
): Promise<{ agent: typeof agents.$inferSelect; embedToken: string; embedCode: string } | null> {
  const markerMatch = responseText.match(/\[AGENT_CREATED::([a-z0-9-]+)\]/i);
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
    createdAt: string;
  };

  let config: AgentConfig | null = null;
  let lastReadError: unknown;
  for (const configPath of configPaths) {
    try {
      const rawConfig = await readFile(configPath, 'utf8');
      config = JSON.parse(rawConfig) as AgentConfig;
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

  // Try to reclaim an existing agent with the same slug (update owner + config)
  // MVP: single-server, slug is globally unique per website — reassign to requesting customer
  const reclaimedRows = await app.db
    .update(agents)
    .set({
      customerId,
      name: config.agentName,
      websiteUrl: normalizeNullable(config.websiteUrl),
      apiDescription: normalizeNullable(config.apiDescription),
      status: 'active',
      updatedAt: now,
    })
    .where(eq(agents.openclawAgentId, config.agentSlug))
    .returning();

  let createdAgent = reclaimedRows[0];

  if (!createdAgent) {
    const createdAgentRows = await app.db
      .insert(agents)
      .values({
        id: randomUUID(),
        customerId,
        openclawAgentId: config.agentSlug,
        name: config.agentName,
        websiteUrl: normalizeNullable(config.websiteUrl),
        apiDescription: normalizeNullable(config.apiDescription),
        description: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: agents.openclawAgentId })
      .returning();

    createdAgent = createdAgentRows[0]
      ?? (
        await app.db
          .select()
          .from(agents)
          .where(
            and(
              eq(agents.openclawAgentId, config.agentSlug),
              eq(agents.customerId, customerId),
              ne(agents.status, 'deleted'),
            ),
          )
          .limit(1)
      )[0];
  }

  if (!createdAgent) {
    app.log.warn(
      { slug: config.agentSlug, customerId },
      'failed to create or reclaim agent',
    );
    return null;
  }

  // Register agent in OpenClaw gateway config and restart gateway
  await registerAgentInOpenClaw(config.agentSlug, config.agentName, app);

  const existingEmbedRows = await app.db
    .select()
    .from(widgetEmbeds)
    .where(eq(widgetEmbeds.agentId, createdAgent.id))
    .limit(1);
  const existingEmbed = existingEmbedRows[0];
  const embedToken = randomUUID();
  if (existingEmbed) {
    await app.db
      .update(widgetEmbeds)
      .set({ embedToken })
      .where(eq(widgetEmbeds.id, existingEmbed.id));
  } else {
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
  const embedCode
    = `<script src="https://${normalizedDomain}/widget.js" data-agent-token="${embedToken}" async></script>`;

  return {
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

    const sessionId = body.sessionId?.trim() || randomUUID();
    const isNewSession = !body.sessionId?.trim();
    const latestUserMessage = body.messages
      .filter((message) => message.role.toLowerCase() === 'user')
      .map((message) => message.content.trim())
      .filter((message) => message.length > 0)
      .at(-1) ?? '';

    const domain = (process.env.AUTH_URL || 'https://dev.lamoom.com').replace(/\/+$/, '');
    const messageForAgent = isNewSession
      ? `[Lamoom Platform — Agent Creation Session]
Customer ID: ${customerId}
Platform domain: ${domain}

Customer: ${latestUserMessage || 'I want to create a chat agent for my website.'}`
      : latestUserMessage;

    if (!messageForAgent.trim()) {
      return sendError(reply, 400, 'empty_message', 'Message content is required');
    }

    try {
      const openclawClient = new OpenClawClient();
      const agentResponse = await openclawClient.sendMessage({
        message: messageForAgent,
        agentId: 'meta',
        sessionKey: buildAgentSessionKey('meta', `admin-${customerId}-${sessionId}`),
        name: 'agent-builder',
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
      const existingEmbedCode
        = responseText.match(/<script\s[^>]*data-agent-token="[^"]*"[^>]*><\/script>/i)?.[0] ?? '';
      const createdAgentData = await detectAgentCreation(responseText, customerId, app, domain);

      return reply.send({
        data: {
          response: responseText,
          sessionId,
          agent: createdAgentData?.agent ?? null,
          embedToken: createdAgentData?.embedToken ?? null,
          embedCode: createdAgentData?.embedCode ?? existingEmbedCode,
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

      const updatedRows = await app.db
        .update(agents)
        .set({
          ...body,
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
}
