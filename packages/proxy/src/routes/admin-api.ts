import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { count, desc, eq, sql } from 'drizzle-orm';
import { agents, auditLog, customers, widgetSessions } from '../db/schema.js';

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send({
    error: {
      code,
      message,
    },
  });
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

function getInternalApiToken(): string | null {
  return (
    process.env.PROXY_CUSTOMER_API_TOKEN?.trim()
    || process.env.PROXY_API_TOKEN?.trim()
    || process.env.OPENCLAW_GATEWAY_TOKEN?.trim()
    || null
  );
}

function timingSafeBufferEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function requireInternalAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = getInternalApiToken();
  if (!expected) {
    sendError(reply, 500, 'missing_api_token', 'Server API token is not configured');
    return false;
  }

  const token = readBearerToken(request);
  if (!token || !timingSafeBufferEqual(token, expected)) {
    sendError(reply, 401, 'unauthorized', 'Invalid or missing bearer token');
    return false;
  }

  return true;
}

export function registerAdminApiRoutes(app: FastifyInstance) {
  const sessionCountByAgentQuery = app.db
    .select({
      agentId: widgetSessions.agentId,
      sessionCount: count(widgetSessions.id),
    })
    .from(widgetSessions)
    .groupBy(widgetSessions.agentId)
    .as('session_count_by_agent');

  app.get('/api/admin/stats', async (request, reply) => {
    if (!requireInternalAuth(request, reply)) return;

    try {
      const [totalUsersRow, totalAgentsRow, totalSessionsRow, activeAgentsRow] = await Promise.all([
        app.db.select({ value: count(customers.id) }).from(customers),
        app.db.select({ value: count(agents.id) }).from(agents),
        app.db.select({ value: count(widgetSessions.id) }).from(widgetSessions),
        app.db.select({ value: count(agents.id) }).from(agents).where(eq(agents.status, 'active')),
      ]);

      return reply.send({
        totalUsers: Number(totalUsersRow[0]?.value ?? 0),
        totalAgents: Number(totalAgentsRow[0]?.value ?? 0),
        totalSessions: Number(totalSessionsRow[0]?.value ?? 0),
        activeAgents: Number(activeAgentsRow[0]?.value ?? 0),
      });
    } catch (error) {
      request.log.error({ error }, 'failed to fetch admin stats');
      return sendError(reply, 500, 'internal_error', 'Failed to fetch admin stats');
    }
  });

  app.get('/api/admin/users', async (request, reply) => {
    if (!requireInternalAuth(request, reply)) return;

    try {
      const rows = await app.db
        .select({
          id: customers.id,
          email: customers.email,
          name: customers.name,
          image: sql<null>`null`,
          agentCount: count(agents.id),
          createdAt: customers.createdAt,
        })
        .from(customers)
        .leftJoin(agents, eq(agents.customerId, customers.id))
        .groupBy(customers.id, customers.email, customers.name, customers.createdAt)
        .orderBy(desc(customers.createdAt));

      return reply.send({
        data: rows.map((row) => ({
          ...row,
          agentCount: Number(row.agentCount ?? 0),
        })),
      });
    } catch (error) {
      request.log.error({ error }, 'failed to list admin users');
      return sendError(reply, 500, 'internal_error', 'Failed to list users');
    }
  });

  app.get('/api/admin/users/:id', async (request, reply) => {
    if (!requireInternalAuth(request, reply)) return;

    const { id } = request.params as { id: string };

    try {
      const userRows = await app.db
        .select({
          id: customers.id,
          email: customers.email,
          name: customers.name,
          image: sql<null>`null`,
          createdAt: customers.createdAt,
        })
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1);

      const user = userRows[0];
      if (!user) {
        return sendError(reply, 404, 'not_found', 'User not found');
      }

      const [customerAgents, recentAuditLog] = await Promise.all([
        app.db
          .select({
            id: agents.id,
            name: agents.name,
            customerId: agents.customerId,
            status: agents.status,
            createdAt: agents.createdAt,
            sessionCount: sql<number>`coalesce(${sessionCountByAgentQuery.sessionCount}, 0)`,
          })
          .from(agents)
          .leftJoin(sessionCountByAgentQuery, eq(sessionCountByAgentQuery.agentId, agents.id))
          .where(eq(agents.customerId, id))
          .orderBy(desc(agents.createdAt)),
        app.db
          .select({
            id: sql<string>`${auditLog.id}::text`,
            customerId: auditLog.customerId,
            action: auditLog.action,
            details: auditLog.details,
            createdAt: auditLog.createdAt,
          })
          .from(auditLog)
          .where(eq(auditLog.customerId, id))
          .orderBy(desc(auditLog.createdAt))
          .limit(50),
      ]);

      return reply.send({
        user,
        agents: customerAgents.map((agent) => ({
          ...agent,
          sessionCount: Number(agent.sessionCount ?? 0),
        })),
        recentAuditLog,
      });
    } catch (error) {
      request.log.error({ error }, 'failed to fetch admin user detail');
      return sendError(reply, 500, 'internal_error', 'Failed to fetch user details');
    }
  });

  app.get('/api/admin/agents', async (request, reply) => {
    if (!requireInternalAuth(request, reply)) return;

    try {
      const rows = await app.db
        .select({
          id: agents.id,
          name: agents.name,
          customerId: agents.customerId,
          customerEmail: customers.email,
          status: agents.status,
          sessionCount: sql<number>`coalesce(${sessionCountByAgentQuery.sessionCount}, 0)`,
          createdAt: agents.createdAt,
        })
        .from(agents)
        .leftJoin(customers, eq(customers.id, agents.customerId))
        .leftJoin(sessionCountByAgentQuery, eq(sessionCountByAgentQuery.agentId, agents.id))
        .orderBy(desc(agents.createdAt));

      return reply.send({
        data: rows.map((row) => ({
          ...row,
          sessionCount: Number(row.sessionCount ?? 0),
        })),
      });
    } catch (error) {
      request.log.error({ error }, 'failed to list admin agents');
      return sendError(reply, 500, 'internal_error', 'Failed to list agents');
    }
  });

  app.get('/api/admin/audit-log', async (request, reply) => {
    if (!requireInternalAuth(request, reply)) return;

    try {
      const rows = await app.db
        .select({
          id: sql<string>`${auditLog.id}::text`,
          customerId: auditLog.customerId,
          action: auditLog.action,
          details: auditLog.details,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(100);

      return reply.send({ data: rows });
    } catch (error) {
      request.log.error({ error }, 'failed to list admin audit log');
      return sendError(reply, 500, 'internal_error', 'Failed to list audit log');
    }
  });
}
