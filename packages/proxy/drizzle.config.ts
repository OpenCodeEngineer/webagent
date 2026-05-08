import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  driver: process.env.DATABASE_URL?.includes('neon.tech') ? 'neon-serverless' as any : undefined,
  dbCredentials: {
    url: process.env.DATABASE_URL!
  }
});
