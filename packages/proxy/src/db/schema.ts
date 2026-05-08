import { pgTable, uuid, text, timestamp, jsonb, bigserial, uniqueIndex, index } from 'drizzle-orm/pg-core';

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
  paperclipAgentId: text('paperclip_agent_id'),
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

export const metaAgentSessions = pgTable(
  'meta_agent_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    openclawSessionKey: text('openclaw_session_key').notNull().unique(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    metaAgentSessionsCustomerIdx: uniqueIndex('meta_agent_sessions_customer_idx').on(table.customerId),
  }),
);

export const metaAgentMessages = pgTable(
  'meta_agent_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => metaAgentSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    metaAgentMessagesSessionCreatedIdx: index('meta_agent_messages_session_created_idx').on(
      table.sessionId,
      table.createdAt,
    ),
  }),
);
