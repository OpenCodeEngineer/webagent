import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as authSchema from "./auth-schema";

// Lazy-init so Next.js build doesn't crash when DATABASE_URL is unset.
let _db: ReturnType<typeof drizzle<typeof authSchema>> | undefined;

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required at runtime");
    const sql = neon(url);
    _db = drizzle(sql, { schema: authSchema });
  }
  return _db;
}
