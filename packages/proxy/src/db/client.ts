import pg from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export function createDb(databaseUrl: string) {
  // Use Neon serverless driver for Neon/Vercel URLs, pg for local PostgreSQL
  if (databaseUrl.includes('neon.tech') || databaseUrl.includes('vercel')) {
    // Dynamic import for optional neon dependency — but this path is sync,
    // so we use createRequire as a workaround for ESM
    throw new Error('Neon serverless driver requires async initialization. Set DATABASE_URL to a standard PostgreSQL URL.');
  }
  // Local/standard PostgreSQL
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return drizzlePg(pool, { schema });
}

export type Database = ReturnType<typeof drizzlePg<typeof schema>>;
