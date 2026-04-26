import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { widgetSessions } from '../db/schema.js';

function normalizeSessionSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return normalized || 'main';
}

export function buildAgentSessionKey(agentId: string, suffix: string): string {
  return `agent:${normalizeSessionSegment(agentId)}:${normalizeSessionSegment(suffix)}`;
}

function sessionKey(agentId: string, userId: string): string {
  return buildAgentSessionKey(agentId, `widget-${agentId}-${userId}`);
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
