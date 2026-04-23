import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { agents, widgetEmbeds, widgetSessions } from '../db/schema.js';
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
    || process.env.OPENCLAW_HOOKS_TOKEN?.trim()
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

  app.get('/api/agents', async (request, reply) => {
    if (!requireCustomerAuth(request, reply)) return;

    const query = parseOrError(agentsQuerySchema, request.query, reply, 'invalid_agents_query');
    if (!query) return;

    try {
      const rows = await app.db
        .select()
        .from(agents)
        .where(and(eq(agents.customerId, query.customerId), ne(agents.status, 'deleted')));

      const sessionCountRows = await app.db
        .select({
          agentId: widgetSessions.agentId,
          sessionCount: count(widgetSessions.id),
        })
        .from(widgetSessions)
        .innerJoin(agents, eq(widgetSessions.agentId, agents.id))
        .where(and(eq(agents.customerId, query.customerId), ne(agents.status, 'deleted')))
        .groupBy(widgetSessions.agentId);

      const sessionCountByAgentId = new Map(
        sessionCountRows.map((row) => [row.agentId, Number(row.sessionCount) || 0]),
      );

      return reply.send({
        data: rows.map((row) => ({
          ...row,
          sessionCount: sessionCountByAgentId.get(row.id) ?? 0,
        })),
      });
    } catch (error) {
      request.log.error({ error }, 'failed to list agents');
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
