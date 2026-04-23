import type { FastifyInstance } from 'fastify';

import type { HealthResponse } from '@webagent/shared/types';

import { OpenClawClient } from '../openclaw/client.js';

interface OpenClawHealthResponse extends HealthResponse {
  openclaw: 'ok' | 'unreachable';
}

function healthPayload(): HealthResponse {
  return {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
}

export function registerHealthRoutes(app: FastifyInstance, openClaw = new OpenClawClient()): void {
  app.get('/health', async () => {
    return healthPayload();
  });

  app.get('/health/openclaw', async (_request, reply) => {
    const ok = await openClaw.ping();
    const payload: OpenClawHealthResponse = {
      ...healthPayload(),
      openclaw: ok ? 'ok' : 'unreachable'
    };

    if (!ok) {
      return reply.code(503).send(payload);
    }

    return payload;
  });
}
