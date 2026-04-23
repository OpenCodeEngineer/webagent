import { WS_CLOSE_CODES } from '@webagent/shared/constants';
import type { ClientMessage, ServerMessage } from '@webagent/shared/protocol';

import { OpenClawClient } from '../openclaw/client.js';
import { getOrCreateSession } from '../openclaw/sessions.js';

const AUTH_TIMEOUT_MS = 30_000;
const tokenAgentMap = new Map<string, string>();

export function registerAgentToken(agentToken: string, agentId: string): void {
  const token = agentToken.trim();
  const id = agentId.trim();

  if (!token || !id) {
    return;
  }

  tokenAgentMap.set(token, id);
}

function serializeIncoming(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw;
  }

  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf8');
  }

  return String(raw);
}

interface WebSocketLike {
  OPEN: number;
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (raw: unknown) => void): void;
  on(event: 'close' | 'error', listener: () => void): void;
}

export function handleConnection(ws: WebSocketLike): void {
  const openClaw = new OpenClawClient();

  let authenticated = false;
  let activeAgentId = '';
  let activeSessionKey = '';

  const send = (payload: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  const closeUnauthorized = (reason: string): void => {
    send({ type: 'auth_error', reason });
    ws.close(WS_CLOSE_CODES.POLICY_VIOLATION, reason);
  };

  const authTimer = setTimeout(() => {
    if (!authenticated) {
      closeUnauthorized('Authentication timeout');
    }
  }, AUTH_TIMEOUT_MS);

  const cleanup = (): void => {
    clearTimeout(authTimer);
  };

  ws.on('message', (raw: unknown) => {
    void (async () => {
      let incoming: ClientMessage;

      try {
        incoming = JSON.parse(serializeIncoming(raw)) as ClientMessage;
      } catch {
        send({ type: 'error', message: 'Invalid JSON payload' });
        return;
      }

      switch (incoming.type) {
        case 'auth': {
          if (!incoming.agentToken || !incoming.userId) {
            closeUnauthorized('Missing agentToken or userId');
            return;
          }

          const resolvedAgentId = tokenAgentMap.get(incoming.agentToken);
          if (!resolvedAgentId) {
            closeUnauthorized('Invalid agent token');
            return;
          }

          activeAgentId = resolvedAgentId;
          activeSessionKey = getOrCreateSession(activeAgentId, incoming.userId);

          try {
            await openClaw.wake(activeAgentId);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'OpenClaw wake failed';
            send({ type: 'error', message });
            return;
          }

          authenticated = true;
          clearTimeout(authTimer);
          send({ type: 'auth_ok', sessionId: activeSessionKey });
          return;
        }

        case 'message': {
          if (!authenticated) {
            closeUnauthorized('Authenticate before sending messages');
            return;
          }

          if (!incoming.content || typeof incoming.content !== 'string') {
            send({ type: 'error', message: 'Missing message content' });
            return;
          }

          try {
            const response = await openClaw.sendMessage(activeAgentId, activeSessionKey, incoming.content);
            send({ type: 'message', content: response.content, done: response.done });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to relay message';
            send({ type: 'error', message });
          }
          return;
        }

        case 'ping': {
          send({ type: 'pong' });
          return;
        }

        default: {
          send({ type: 'error', message: 'Unsupported message type' });
        }
      }
    })();
  });

  ws.on('close', () => {
    cleanup();
  });

  ws.on('error', () => {
    cleanup();
  });
}
