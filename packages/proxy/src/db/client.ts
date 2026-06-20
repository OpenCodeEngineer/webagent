import pg from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export function createDb(databaseUrl: string) {
  // Block Neon pooler and Vercel Postgres — they require async WebSocket init.
  // Direct Neon connections (without '-pooler.') work fine with pg.Pool.
  if (databaseUrl.includes('-pooler.') || databaseUrl.includes('vercel-storage.com')) {
    throw new Error('Neon pooler/Vercel Postgres detected. Use the direct (non-pooler) Neon connection URL.');
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return drizzlePg(pool, { schema });
}

export type Database = ReturnType<typeof drizzlePg<typeof schema>>;
