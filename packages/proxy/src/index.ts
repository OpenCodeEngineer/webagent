import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';

import { loadConfig } from './config.js';
import { dbPlugin } from './db/plugin.js';
import { registerApiRoutes } from './routes/api.js';
import { registerAdminApiRoutes } from './routes/admin-api.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerOpenAiCompatRoutes } from './routes/openai-compat.js';
import { registerSsoRoutes } from './routes/sso.js';
import { registerWidgetRoutes } from './routes/widget.js';
import { handleConnection } from './ws/handler.js';
import { DEFAULT_WS_PATH } from '@webagent/shared/constants';

interface ManagedSocket {
  close(code?: number, data?: string): void;
  on(event: 'close', listener: () => void): void;
}

const config = loadConfig();
const app = Fastify({ logger: true, bodyLimit: 1048576 });
const activeSockets = new Set<ManagedSocket>();
const connectionsPerIp = new Map<string, number>();
const MAX_WS_PER_IP = 20;
const WS_MAX_PAYLOAD_BYTES = 12 * 1024 * 1024;

await app.register(websocket, { options: { maxPayload: WS_MAX_PAYLOAD_BYTES } });
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
await app.register(dbPlugin);

registerHealthRoutes(app);
registerWidgetRoutes(app);
registerApiRoutes(app);
registerAdminApiRoutes(app);
registerOpenAiCompatRoutes(app);
registerSsoRoutes(app);

app.get(DEFAULT_WS_PATH, { websocket: true }, (socket, request) => {
  const ip = request.ip;
  const currentConnections = connectionsPerIp.get(ip) ?? 0;
  if (currentConnections >= MAX_WS_PER_IP) {
    socket.close(4029, 'Too many connections');
    return;
  }

  connectionsPerIp.set(ip, currentConnections + 1);

  const managed = socket as unknown as ManagedSocket;
  activeSockets.add(managed);
  managed.on('close', () => {
    activeSockets.delete(managed);
    const remaining = (connectionsPerIp.get(ip) ?? 1) - 1;
    if (remaining <= 0) {
      connectionsPerIp.delete(ip);
      return;
    }
    connectionsPerIp.set(ip, remaining);
  });

  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
  handleConnection(socket as any, { db: app.db, origin, app });
});

let shuttingDown = false;

const shutdown = async (signal: 'SIGTERM' | 'SIGINT'): Promise<void> => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal, sockets: activeSockets.size }, 'shutting down proxy server');

  for (const socket of activeSockets) {
    try {
      socket.close(1001, 'Going Away');
    } catch (error) {
      app.log.warn({ error }, 'failed to close websocket during shutdown');
    }
  }

  await app.close();
};

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

const start = async (): Promise<void> => {
  try {
    await app.listen({ host: '0.0.0.0', port: config.port });
    app.log.info(
      { port: config.port, openClawGatewayUrl: config.openClawGatewayUrl },
      'proxy server started',
    );
  } catch (error) {
    app.log.error(error, 'failed to start proxy server');
    process.exit(1);
  }
};

process.on('unhandledRejection', (error) => {
  app.log.error({ error }, 'unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  app.log.fatal({ error }, 'uncaught exception');
  void shutdown('SIGTERM');
});

void start();
