import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { customers, metaAgentMessages, metaAgentSessions } from '../db/schema.js';
import { buildAgentSessionKey } from './sessions.js';

export type MetaMessageRole = 'user' | 'assistant';

export interface MetaHistoryMessage {
  role: MetaMessageRole;
  content: string;
  createdAt: Date;
}

export interface MetaHistory {
  sessionId: string;
  openclawSessionKey: string;
  messages: MetaHistoryMessage[];
}

const EMBED_CODE_RE = /<script\s[^>]*data-agent-token="[^"]*"[^>]*><\/script>/i;

async function ensureCustomer(db: Database, customerId: string): Promise<void> {
  await db
    .insert(customers)
    .values({
      id: customerId,
      email: `customer-${customerId}@webagent.local`,
    })
    .onConflictDoNothing();
}

async function getOrCreateMetaSession(db: Database, customerId: string) {
  const openclawSessionKey = buildAgentSessionKey('meta', `admin-${customerId}`);
  await db
    .insert(metaAgentSessions)
    .values({
      customerId,
      openclawSessionKey,
      lastActiveAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [metaAgentSessions.customerId],
      set: {
        openclawSessionKey,
        lastActiveAt: new Date(),
      },
    });

  const [session] = await db
    .select()
    .from(metaAgentSessions)
    .where(eq(metaAgentSessions.customerId, customerId))
    .limit(1);

  if (!session) {
    throw new Error('Failed to create meta-agent session');
  }

  return session;
}

export async function getMetaHistory(db: Database, customerId: string): Promise<MetaHistory> {
  await ensureCustomer(db, customerId);
  const session = await getOrCreateMetaSession(db, customerId);

  const rows = await db
    .select({
      role: metaAgentMessages.role,
      content: metaAgentMessages.content,
      createdAt: metaAgentMessages.createdAt,
    })
    .from(metaAgentMessages)
    .where(eq(metaAgentMessages.sessionId, session.id))
    .orderBy(asc(metaAgentMessages.createdAt));

  const messages = rows
    .filter((row): row is { role: MetaMessageRole; content: string; createdAt: Date } =>
      (row.role === 'user' || row.role === 'assistant')
      && typeof row.content === 'string'
      && row.content.length > 0,
    )
    .map((row) => ({
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
    }));

  return {
    sessionId: session.id,
    openclawSessionKey: session.openclawSessionKey,
    messages,
  };
}

export async function appendMetaHistoryMessage(
  db: Database,
  customerId: string,
  role: MetaMessageRole,
  content: string,
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;

  await ensureCustomer(db, customerId);
  const session = await getOrCreateMetaSession(db, customerId);
  const now = new Date();
  await db.insert(metaAgentMessages).values({
    sessionId: session.id,
    role,
    content: trimmed,
    createdAt: now,
  });
  await db
    .update(metaAgentSessions)
    .set({ lastActiveAt: now })
    .where(and(eq(metaAgentSessions.id, session.id), eq(metaAgentSessions.customerId, customerId)));
}

export function extractEmbedCodeFromMessages(messages: Array<{ content: string }>): string {
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const content = messages[idx]?.content ?? '';
    const match = content.match(EMBED_CODE_RE)?.[0];
    if (match) {
      return match;
    }
  }
  return '';
}
