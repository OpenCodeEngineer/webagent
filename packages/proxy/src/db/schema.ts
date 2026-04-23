import { pgTable, uuid, text, timestamp, jsonb, bigserial, uniqueIndex } from 'drizzle-orm/pg-core';

export const customers = pgTable('customers', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  passwordHash: text('password_hash'),
  oauthProvider: text('oauth_provider'),
  oauthId: text('oauth_id'),
  plan: text('plan').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  openclawAgentId: text('openclaw_agent_id').notNull().unique(),
  name: text('name').notNull(),
  websiteUrl: text('website_url'),
  description: text('description'),
  status: text('status').notNull().default('provisioning'),
  widgetConfig: jsonb('widget_config').default({}).notNull(),
  apiDescription: text('api_description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const widgetSessions = pgTable(
  'widget_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    externalUserId: text('external_user_id').notNull(),
    openclawSessionKey: text('openclaw_session_key').notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    widgetSessionsAgentUserIdx: uniqueIndex('widget_sessions_agent_user_idx').on(
      table.agentId,
      table.externalUserId
    )
  })
);

export const widgetEmbeds = pgTable('widget_embeds', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  embedToken: text('embed_token').notNull().unique(),
  allowedOrigins: text('allowed_origins').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  customerId: uuid('customer_id').references(() => customers.id),
  action: text('action').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
