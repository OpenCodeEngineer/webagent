import type { FastifyPluginAsync } from 'fastify';
import { loadConfig } from '../config.js';
import { createDb, type Database } from './client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export const dbPlugin: FastifyPluginAsync = async (fastify) => {
  const config = loadConfig();
  fastify.decorate('db', createDb(config.databaseUrl));
};
