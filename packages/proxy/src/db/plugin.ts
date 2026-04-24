import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loadConfig } from '../config.js';
import { createDb, type Database } from './client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

const plugin: FastifyPluginAsync = async (fastify) => {
  const config = loadConfig();
  fastify.decorate('db', createDb(config.databaseUrl));
};

export const dbPlugin = fp(plugin, { name: 'db-plugin' });
