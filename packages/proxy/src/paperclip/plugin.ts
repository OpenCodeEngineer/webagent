import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loadConfig } from '../config.js';
import { PaperclipClient } from './client.js';

declare module 'fastify' {
  interface FastifyInstance {
    paperclip: PaperclipClient;
  }
}

const plugin: FastifyPluginAsync = async (fastify) => {
  const config = loadConfig();
  const client = new PaperclipClient(config);
  fastify.decorate('paperclip', client);

  if (client.isEnabled) {
    const healthy = await client.healthCheck();
    if (healthy) {
      fastify.log.info('Paperclip control plane connected');
    } else {
      fastify.log.warn('Paperclip enabled but not reachable — agent sync will retry on demand');
    }
  }
};

export const paperclipPlugin = fp(plugin, { name: 'paperclip-plugin' });
