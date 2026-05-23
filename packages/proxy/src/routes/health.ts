import type { FastifyInstance, FastifyReply } from 'fastify';
import type { HealthResponse } from '@webagent/shared/types';
import { sql } from 'drizzle-orm';
import { OpenClawClient } from '../openclaw/client.js';

const DB_CHECK_TIMEOUT_MS = 3_000;
const OPENCLAW_CHECK_TIMEOUT_MS = 5_000;

async function checkDb(app: FastifyInstance): Promise<'ok' | 'error'> {
  try {
    const timeoutSignal = AbortSignal.timeout(DB_CHECK_TIMEOUT_MS);
    await Promise.race([
      app.db.execute(sql`SELECT 1`),
      new Promise<never>((_, reject) =>
        timeoutSignal.addEventListener('abort', () => reject(new Error('db check timeout')), { once: true }),
      ),
    ]);
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkOpenClaw(openclaw: OpenClawClient): Promise<'ok' | 'unreachable'> {
  try {
    const result = await Promise.race([
      openclaw.ping(),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), OPENCLAW_CHECK_TIMEOUT_MS)),
    ]);
    return result ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

export function registerHealthRoutes(app: FastifyInstance) {
  const openclaw = new OpenClawClient();

  app.get('/health', async (_request, reply: FastifyReply) => {
    const [dbStatus, openclawStatus] = await Promise.all([
      checkDb(app),
      checkOpenClaw(openclaw),
    ]);

    const isHealthy = dbStatus === 'ok' && openclawStatus === 'ok';
    const overallStatus: HealthResponse['status'] = isHealthy ? 'ok' : 'error';

    const payload: HealthResponse = {
      status: overallStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: {
        db: dbStatus,
        openclaw: openclawStatus,
      },
    };

    reply.code(isHealthy ? 200 : 503);
    return payload;
  });

  app.get('/health/openclaw', async () => {
    const ok = await openclaw.ping();
    return { status: ok ? 'ok' : 'unreachable', timestamp: new Date().toISOString() };
  });

  app.get('/health/paperclip', async () => {
    if (!app.paperclip?.isEnabled) {
      return { status: 'disabled', timestamp: new Date().toISOString() };
    }
    const ok = await app.paperclip.healthCheck();
    return { status: ok ? 'ok' : 'unreachable', timestamp: new Date().toISOString() };
  });
}
