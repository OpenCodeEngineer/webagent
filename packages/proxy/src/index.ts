import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';

import { DEFAULT_WS_PATH } from '@webagent/shared/constants';
import type { ClientMessage, ServerMessage } from '@webagent/shared/protocol';
import type { HealthResponse } from '@webagent/shared/types';

import { loadConfig } from './config.js';

const config = loadConfig();
const app = Fastify({ logger: true });

await app.register(websocket);

app.get('/health', async () => {
  const payload: HealthResponse = {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };

  return payload;
});

app.get(DEFAULT_WS_PATH, { websocket: true }, (connection) => {
  connection.socket.on('message', (raw: unknown) => {
    const serialized =
      typeof raw === 'string'
        ? raw
        : Buffer.isBuffer(raw)
          ? raw.toString('utf8')
          : String(raw);

    let incoming: ClientMessage;

    try {
      incoming = JSON.parse(serialized) as ClientMessage;
    } catch {
      const invalidJson: ServerMessage = { type: 'error', message: 'Invalid JSON payload' };
      connection.socket.send(JSON.stringify(invalidJson));
      return;
    }

    switch (incoming.type) {
      case 'auth': {
        if (!incoming.agentToken || !incoming.userId) {
          const authError: ServerMessage = {
            type: 'auth_error',
            reason: 'Missing agentToken or userId'
          };
          connection.socket.send(JSON.stringify(authError));
          return;
        }

        const authOk: ServerMessage = { type: 'auth_ok', sessionId: randomUUID() };
        connection.socket.send(JSON.stringify(authOk));
        return;
      }

      case 'message': {
        if (!incoming.content || typeof incoming.content !== 'string') {
          const invalidMessage: ServerMessage = {
            type: 'error',
            message: 'Missing message content'
          };
          connection.socket.send(JSON.stringify(invalidMessage));
          return;
        }

        const message: ServerMessage = {
          type: 'message',
          content: incoming.content,
          done: true
        };
        connection.socket.send(JSON.stringify(message));
        return;
      }

      case 'ping': {
        const pong: ServerMessage = { type: 'pong' };
        connection.socket.send(JSON.stringify(pong));
        return;
      }

      default: {
        const unsupported: ServerMessage = {
          type: 'error',
          message: 'Unsupported message type'
        };
        connection.socket.send(JSON.stringify(unsupported));
      }
    }
  });
});

const start = async (): Promise<void> => {
  try {
    await app.listen({ host: '0.0.0.0', port: config.port });
    app.log.info(
      {
        port: config.port,
        openClawHooksUrl: config.openClawHooksUrl
      },
      'proxy server started'
    );
  } catch (error) {
    app.log.error(error, 'failed to start proxy server');
    process.exit(1);
  }
};

void start();
