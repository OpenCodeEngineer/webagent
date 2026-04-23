// In-memory session map (will later use DB)
const sessionMap = new Map<string, string>();

function sessionKey(agentId: string, userId: string): string {
  return `widget:${agentId}:${userId}`;
}

export function getOrCreateSession(agentId: string, userId: string): string {
  const key = `${agentId}::${userId}`;
  let session = sessionMap.get(key);
  if (!session) {
    session = sessionKey(agentId, userId);
    sessionMap.set(key, session);
  }
  return session;
}

export function getSession(agentId: string, userId: string): string | undefined {
  return sessionMap.get(`${agentId}::${userId}`);
}

export function removeSession(agentId: string, userId: string): boolean {
  return sessionMap.delete(`${agentId}::${userId}`);
}
