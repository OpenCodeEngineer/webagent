import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@webagent/shared/types';
import { OpenClawClient } from '../openclaw/client.js';

export function registerHealthRoutes(app: FastifyInstance) {
  const openclaw = new OpenClawClient();

  app.get('/health', async () => {
    const payload: HealthResponse = {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
    return payload;
  });

  app.get('/health/openclaw', async () => {
    const ok = await openclaw.ping();
    return { status: ok ? 'ok' : 'unreachable', timestamp: new Date().toISOString() };
  });
}
