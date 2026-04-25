import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { widgetSessions } from '../db/schema.js';

function sessionKey(agentId: string, userId: string): string {
  return `widget-${agentId}-${userId}`;
}

export async function getOrCreateSession(
  db: Database,
  agentId: string,
  userId: string,
): Promise<string> {
  const openclawSessionKey = sessionKey(agentId, userId);

  await db
    .insert(widgetSessions)
    .values({
      agentId,
      externalUserId: userId,
      openclawSessionKey,
      lastActiveAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [widgetSessions.agentId, widgetSessions.externalUserId],
      set: {
        openclawSessionKey,
        lastActiveAt: new Date(),
      },
    });

  return openclawSessionKey;
}

export async function touchSessionLastActiveAt(
  db: Database,
  agentId: string,
  userId: string,
): Promise<void> {
  await db
    .update(widgetSessions)
    .set({ lastActiveAt: new Date() })
    .where(and(eq(widgetSessions.agentId, agentId), eq(widgetSessions.externalUserId, userId)));
}
