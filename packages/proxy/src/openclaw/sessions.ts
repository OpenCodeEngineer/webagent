const sessions = new Map<string, string>();

export function sessionKey(agentId: string, userId: string): string {
  return `widget:${agentId}:${userId}`;
}

export function getOrCreateSession(agentId: string, userId: string): string {
  const key = sessionKey(agentId, userId);
  const existing = sessions.get(key);

  if (existing) {
    return existing;
  }

  const created = key;
  sessions.set(key, created);
  return created;
}

export function getSession(agentId: string, userId: string): string | undefined {
  return sessions.get(sessionKey(agentId, userId));
}

export function removeSession(agentId: string, userId: string): boolean {
  return sessions.delete(sessionKey(agentId, userId));
}
