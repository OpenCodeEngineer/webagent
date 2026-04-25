import Fastify from 'fastify';
import websocket from '@fastify/websocket';

import { loadConfig } from './config.js';
import { dbPlugin } from './db/plugin.js';
import { registerApiRoutes } from './routes/api.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerWidgetRoutes } from './routes/widget.js';
import { handleConnection } from './ws/handler.js';
import { DEFAULT_WS_PATH } from '@webagent/shared/constants';

interface ManagedSocket {
  close(code?: number, data?: string): void;
  on(event: 'close', listener: () => void): void;
}

const config = loadConfig();
const app = Fastify({ logger: true });
const activeSockets = new Set<ManagedSocket>();

await app.register(websocket);
await app.register(dbPlugin);

registerHealthRoutes(app);
registerWidgetRoutes(app);
registerApiRoutes(app);

app.get(DEFAULT_WS_PATH, { websocket: true }, (connection, request) => {
  const socket = connection.socket as ManagedSocket;
  activeSockets.add(socket);
  socket.on('close', () => {
    activeSockets.delete(socket);
  });

  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
  handleConnection(connection.socket, { db: app.db, origin });
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

void start();
