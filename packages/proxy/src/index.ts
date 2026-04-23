import Fastify from 'fastify';
import websocket from '@fastify/websocket';

import { DEFAULT_WS_PATH } from '@webagent/shared/constants';

import { loadConfig } from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerWidgetRoutes } from './routes/widget.js';
import { handleConnection, registerAgentToken } from './ws/handler.js';

const config = loadConfig();
const app = Fastify({ logger: true });

const tokenAgentMapValue = process.env.AGENT_TOKEN_MAP?.trim();
if (tokenAgentMapValue) {
  for (const entry of tokenAgentMapValue.split(',').map((part) => part.trim())) {
    if (!entry) {
      continue;
    }

    const [token, agentId] = entry.split(':').map((part) => part.trim());
    if (token && agentId) {
      registerAgentToken(token, agentId);
    }
  }
}

await app.register(websocket);
registerHealthRoutes(app);
registerWidgetRoutes(app);

app.get(DEFAULT_WS_PATH, { websocket: true }, (connection) => {
  handleConnection(connection.socket);
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
