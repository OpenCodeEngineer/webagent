import { timingSafeEqual } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { count, desc, eq, sql } from 'drizzle-orm';
import { agents, auditLog, customers, widgetSessions } from '../db/schema.js';

const WEBSITE_API_SKILL_RELATIVE_PATH = join('skills', 'website-api', 'SKILL.md');
const WEBSITE_API_TEMPLATE_RELATIVE_PATH = join('templates', WEBSITE_API_SKILL_RELATIVE_PATH);
const FALLBACK_ENDPOINTS_TABLE = [
  '| Method | Path | Description | Request Body | Response |',
  '|--------|------|-------------|-------------|----------|',
].join('\n');

type WorkspaceAgentConfig = {
  agentName?: string;
  websiteName?: string;
  apiBaseUrl?: string;
  apiAuthMethod?: string;
  apiStyle?: string;
  apiEndpoints?: string;
  apiDescription?: string;
};

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
    timingSafeEqual(left, left);
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

function resolveWorkspaceBaseDirs(): string[] {
  const configured = process.env.OPENCLAW_WORKSPACES_DIR?.trim();
  if (configured) {
    return [configured];
  }

  const primary = join(process.cwd(), 'openclaw', 'workspaces');
  const fallback = join(process.cwd(), '..', '..', 'openclaw', 'workspaces');
  return primary === fallback ? [primary] : [primary, fallback];
}

function resolveAgentWorkspaceCandidates(slug: string): string[] {
  return resolveWorkspaceBaseDirs().map((baseDir) => join(baseDir, slug));
}

async function resolveFirstExistingPath(paths: string[]): Promise<string | null> {
  for (const candidatePath of paths) {
    try {
      await access(candidatePath, fsConstants.F_OK);
      return candidatePath;
    } catch {
      // continue
    }
  }
  return null;
}

function parseRenderedField(skillText: string, fieldName: string): string | null {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = skillText.match(new RegExp(`- \\*\\*${escaped}:\\*\\*\\s*(.+)`, 'i'));
  const value = match?.[1]?.trim();
  return value ? value : null;
}

function extractRenderedApiEndpoints(skillText: string): string | null {
  const sectionMatch = skillText.match(
    /## Available Actions\s*\n+([\s\S]*?)(?:\n<!-- GENERATION NOTE:|\n## )/,
  );
  if (!sectionMatch?.[1]) return null;
  const value = sectionMatch[1].trim();
  if (!value || value.includes('{{API_ENDPOINTS}}')) return null;
  return value;
}

function renderWebsiteApiSkillFromTemplate(params: {
  templateText: string;
  websiteName: string;
  apiBaseUrl: string;
  apiAuthMethod: string;
  apiStyle: string;
  apiEndpoints: string;
}): string {
  return params.templateText
    .replaceAll('{{WEBSITE_NAME}}', params.websiteName)
    .replaceAll('{{API_BASE_URL}}', params.apiBaseUrl)
    .replaceAll('{{API_AUTH_METHOD}}', params.apiAuthMethod)
    .replaceAll('{{API_STYLE}}', params.apiStyle)
    .replaceAll('{{API_ENDPOINTS}}', params.apiEndpoints);
}

async function regenerateWebsiteApiSkill(params: {
  agent: typeof agents.$inferSelect;
  logger: FastifyRequest['log'];
}): Promise<{ workspacePath: string; skillPath: string; templatePath: string }> {
  const workspaceCandidates = resolveAgentWorkspaceCandidates(params.agent.openclawAgentId);
  const workspacePath = await resolveFirstExistingPath(workspaceCandidates);
  if (!workspacePath) {
    throw new Error(`Workspace not found for agent slug "${params.agent.openclawAgentId}"`);
  }

  const skillPath = join(workspacePath, WEBSITE_API_SKILL_RELATIVE_PATH);
  const agentConfigPath = join(workspacePath, 'agent-config.json');

  const templateCandidates = [
    join(workspacePath, '..', 'meta', WEBSITE_API_TEMPLATE_RELATIVE_PATH),
    join(process.cwd(), 'openclaw', 'workspaces', 'meta', WEBSITE_API_TEMPLATE_RELATIVE_PATH),
    join(process.cwd(), 'openclaw', WEBSITE_API_TEMPLATE_RELATIVE_PATH),
  ];
  const templatePath = await resolveFirstExistingPath(templateCandidates);
  if (!templatePath) {
    throw new Error('website-api skill template not found');
  }

  let existingSkillText = '';
  try {
    existingSkillText = await readFile(skillPath, 'utf8');
  } catch {
    existingSkillText = '';
  }

  let agentConfig: WorkspaceAgentConfig = {};
  try {
    const rawConfig = await readFile(agentConfigPath, 'utf8');
    agentConfig = JSON.parse(rawConfig) as WorkspaceAgentConfig;
  } catch (error) {
    params.logger.warn({ error, agentConfigPath }, 'failed to read agent config for skill refresh');
  }

  const templateText = await readFile(templatePath, 'utf8');
  const apiEndpoints = extractRenderedApiEndpoints(existingSkillText)
    || agentConfig.apiEndpoints?.trim()
    || agentConfig.apiDescription?.trim()
    || FALLBACK_ENDPOINTS_TABLE;
  const apiAuthMethod = parseRenderedField(existingSkillText, 'Auth')
    || agentConfig.apiAuthMethod?.trim()
    || 'Not specified';
  const apiStyle = parseRenderedField(existingSkillText, 'Style')
    || agentConfig.apiStyle?.trim()
    || 'Not specified';
  const apiBaseUrl = agentConfig.apiBaseUrl?.trim() || '';
  const websiteName = agentConfig.websiteName?.trim() || params.agent.name;

  const renderedSkill = renderWebsiteApiSkillFromTemplate({
    templateText,
    websiteName,
    apiBaseUrl,
    apiAuthMethod,
    apiStyle,
    apiEndpoints,
  });

  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(skillPath, `${renderedSkill.trimEnd()}\n`, 'utf8');
  return { workspacePath, skillPath, templatePath };
}

export function registerAdminApiRoutes(app: FastifyInstance) {
  const sessionCountByAgentQuery = app.db
    .select({
      agentId: widgetSessions.agentId,
      sessionCount: count(widgetSessions.id).as('session_count'),
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
      const errMsg = error instanceof Error ? error.message : String(error);
      request.log.error({ error: errMsg, stack: error instanceof Error ? error.stack : undefined }, 'failed to list admin agents');
      return sendError(reply, 500, 'internal_error', 'Failed to list agents');
    }
  });

  app.post('/api/admin/agents/:id/refresh-workspace', async (request, reply) => {
    if (!requireInternalAuth(request, reply)) return;

    const { id } = request.params as { id: string };

    try {
      const agentRows = await app.db
        .select()
        .from(agents)
        .where(eq(agents.id, id))
        .limit(1);

      const agent = agentRows[0];
      if (!agent) {
        return sendError(reply, 404, 'not_found', 'Agent not found');
      }

      const refreshed = await regenerateWebsiteApiSkill({
        agent,
        logger: request.log,
      });

      return reply.send({
        success: true,
        data: {
          agentId: agent.id,
          openclawAgentId: agent.openclawAgentId,
          workspacePath: refreshed.workspacePath,
          skillPath: refreshed.skillPath,
          templatePath: refreshed.templatePath,
        },
      });
    } catch (error) {
      request.log.error({ error, id }, 'failed to refresh agent workspace');
      return sendError(reply, 500, 'internal_error', 'Failed to refresh agent workspace');
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
