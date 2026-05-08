import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as authSchema from "./auth-schema";

// Lazy-init so Next.js build doesn't crash when DATABASE_URL is unset.
let _db: ReturnType<typeof drizzle<typeof authSchema>> | undefined;

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required at runtime");
    const pool = new pg.Pool({ connectionString: url });
    _db = drizzle(pool, { schema: authSchema });
  }
  return _db;
}
