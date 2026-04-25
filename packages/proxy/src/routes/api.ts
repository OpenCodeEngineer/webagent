import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { OpenClawClient } from '../openclaw/client.js';
import { agents, customers, widgetEmbeds, widgetSessions } from '../db/schema.js';
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
  customerId: z.string().uuid(),
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

function requireCustomerAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = getCustomerApiToken();
  if (!expected) {
    sendError(reply, 500, 'missing_api_token', 'Server API token is not configured');
    return false;
  }

  const token = readBearerToken(request);
  if (!token || token !== expected) {
    sendError(reply, 401, 'unauthorized', 'Invalid or missing bearer token');
    return false;
  }

  return true;
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

/**
 * Register a newly created agent in the OpenClaw gateway config (~/.openclaw/openclaw.json)
 * and restart the gateway so it picks up the new agent.
 */
async function registerAgentInOpenClaw(
  slug: string,
  name: string,
  app: FastifyInstance,
): Promise<void> {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');
  try {
    const raw = await readFile(configPath, 'utf8');
    const config = JSON.parse(raw) as {
      agents?: { list?: Array<{ id: string; [k: string]: unknown }> };
      [k: string]: unknown;
    };

    if (!config.agents?.list) {
      app.log.warn('openclaw.json missing agents.list — skipping registration');
      return;
    }

    if (config.agents.list.some((a) => a.id === slug)) {
      app.log.info({ slug }, 'agent already in openclaw.json — skipping');
      return;
    }

    config.agents.list.push({
      id: slug,
      name,
      workspace: `~/openclaw/workspaces/${slug}`,
      skills: ['website-api'],
      heartbeat: { every: '30m' },
    });

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    app.log.info({ slug }, 'registered agent in openclaw.json');

    // Restart the gateway so it picks up the new agent
    await new Promise<void>((resolve) => {
      execFile('systemctl', ['restart', 'openclaw-gateway'], { timeout: 15_000 }, (err) => {
        if (err) {
          app.log.warn({ err }, 'failed to restart openclaw-gateway');
        } else {
          app.log.info('openclaw-gateway restarted after agent registration');
        }
        resolve();
      });
    });
  } catch (err) {
    app.log.warn({ err, configPath }, 'failed to register agent in openclaw config');
  }
}

async function detectAgentCreation(
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
    .returning();

  const createdAgent = createdAgentRows[0];
  if (!createdAgent) return null;

  // Register agent in OpenClaw gateway config and restart gateway
  await registerAgentInOpenClaw(config.agentSlug, config.agentName, app);

  const embedToken = randomUUID();
  await app.db.insert(widgetEmbeds).values({
    id: randomUUID(),
    agentId: createdAgent.id,
    embedToken,
    createdAt: now,
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
  app.post('/api/internal/agents', async (request, reply) => {
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

  app.post('/api/agents/create-via-meta', async (request, reply) => {
    if (!requireCustomerAuth(request, reply)) return;

    const query = parseOrError(agentsQuerySchema, request.query, reply, 'invalid_agents_query');
    if (!query) return;

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
Customer ID: ${query.customerId}
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
        sessionKey: `admin-${query.customerId}-${sessionId}`,
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
      const createdAgentData = await detectAgentCreation(responseText, query.customerId, app, domain);

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
    if (!requireCustomerAuth(request, reply)) return;

    const query = parseOrError(agentsQuerySchema, request.query, reply, 'invalid_agents_query');
    if (!query) return;

    try {
      const rows = await app.db
        .select()
        .from(agents)
        .where(and(eq(agents.customerId, query.customerId), ne(agents.status, 'deleted')));

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
            .where(and(eq(agents.customerId, query.customerId), ne(agents.status, 'deleted')))
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
    if (!requireCustomerAuth(request, reply)) return;

    const params = parseOrError(idParamsSchema, request.params, reply, 'invalid_agent_id');
    if (!params) return;
    const query = parseOrError(agentsQuerySchema, request.query, reply, 'invalid_agents_query');
    if (!query) return;

    try {
      const rows = await app.db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.id, params.id),
            eq(agents.customerId, query.customerId),
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

  app.patch('/api/agents/:id', async (request, reply) => {
    if (!requireCustomerAuth(request, reply)) return;

    const params = parseOrError(idParamsSchema, request.params, reply, 'invalid_agent_id');
    if (!params) return;

    const query = parseOrError(agentsQuerySchema, request.query, reply, 'invalid_agents_query');
    if (!query) return;

    const body = parseOrError(updateAgentBodySchema, request.body, reply, 'invalid_agent_patch');
    if (!body) return;

    try {
      const existingAgentRows = await app.db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.id, params.id),
            eq(agents.customerId, query.customerId),
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
        .where(and(eq(agents.id, params.id), eq(agents.customerId, query.customerId)))
        .returning();

      const updated = updatedRows[0];
      if (!updated) {
        return sendError(reply, 404, 'not_found', 'Agent not found');
      }

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

  app.delete('/api/agents/:id', async (request, reply) => {
    if (!requireCustomerAuth(request, reply)) return;

    const params = parseOrError(idParamsSchema, request.params, reply, 'invalid_agent_id');
    if (!params) return;

    const query = parseOrError(agentsQuerySchema, request.query, reply, 'invalid_agents_query');
    if (!query) return;

    try {
      const embedRows = await app.db
        .select({ embedToken: widgetEmbeds.embedToken })
        .from(widgetEmbeds)
        .innerJoin(agents, eq(widgetEmbeds.agentId, agents.id))
        .where(and(eq(agents.id, params.id), eq(agents.customerId, query.customerId)));

      const updatedRows = await app.db
        .update(agents)
        .set({
          status: 'deleted',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agents.id, params.id),
            eq(agents.customerId, query.customerId),
            ne(agents.status, 'deleted'),
          ),
        )
        .returning();

      const updated = updatedRows[0];
      if (!updated) {
        return sendError(reply, 404, 'not_found', 'Agent not found');
      }

      for (const embedRow of embedRows) {
        invalidateEmbedTokenCache(embedRow.embedToken);
      }

      return reply.send({ data: updated });
    } catch (error) {
      request.log.error({ error }, 'failed to soft delete agent');
      return sendError(reply, 500, 'internal_error', 'Failed to soft delete agent');
    }
  });

  app.post('/api/agents/:id/embed-token', async (request, reply) => {
    if (!requireCustomerAuth(request, reply)) return;

    const params = parseOrError(idParamsSchema, request.params, reply, 'invalid_agent_id');
    if (!params) return;

    const query = parseOrError(agentsQuerySchema, request.query, reply, 'invalid_agents_query');
    if (!query) return;

    const body = parseOrError(createEmbedBodySchema, request.body ?? {}, reply, 'invalid_embed_payload');
    if (!body) return;

    try {
      const existingRows = await app.db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.id, params.id),
            eq(agents.customerId, query.customerId),
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

      return reply.send({ embedToken });
    } catch (error) {
      request.log.error({ error }, 'failed to create embed token');
      return sendError(reply, 500, 'internal_error', 'Failed to create embed token');
    }
  });
}
