import pg from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export function createDb(databaseUrl: string) {

  const pool = new pg.Pool({ connectionString: databaseUrl });
  return drizzlePg(pool, { schema });
}

export type Database = ReturnType<typeof drizzlePg<typeof schema>>;
