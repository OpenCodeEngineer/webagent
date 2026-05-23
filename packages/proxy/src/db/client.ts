import pg from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export function createDb(databaseUrl: string) {
  if (databaseUrl.includes('neon.tech') || databaseUrl.includes('vercel')) {
    throw new Error('Neon serverless driver requires async initialization. Set DATABASE_URL to a standard PostgreSQL URL.');
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return drizzlePg(pool, { schema });
}

export type Database = ReturnType<typeof drizzlePg<typeof schema>>;
