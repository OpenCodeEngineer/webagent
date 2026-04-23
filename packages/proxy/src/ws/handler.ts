import type { ClientMessage, ServerMessage } from '@webagent/shared/protocol';
import { OpenClawClient } from '../openclaw/client.js';
import { getOrCreateSession } from '../openclaw/sessions.js';

interface WebSocket {
  readyState: number;
  OPEN: number;
  send(data: string): void;
  close(code?: number, data?: string): void;
  on(event: 'message', listener: (raw: Buffer | string) => void | Promise<void>): void;
  on(event: 'close', listener: () => void): void;
}

interface AuthenticatedSocket {
  ws: WebSocket;
  agentToken: string;
  userId: string;
  agentId: string;
  sessionKey: string;
  authenticated: boolean;
}

const openclawClient = new OpenClawClient();

// In-memory token→agentId map (will later use DB)
const tokenAgentMap = new Map<string, string>();

export function registerAgentToken(token: string, agentId: string) {
  tokenAgentMap.set(token, agentId);
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function handleConnection(ws: WebSocket) {
  const state: AuthenticatedSocket = {
    ws,
    agentToken: '',
    userId: '',
    agentId: '',
    sessionKey: '',
    authenticated: false,
  };

  // 30s auth timeout
  const authTimeout = setTimeout(() => {
    if (!state.authenticated) {
      send(ws, { type: 'auth_error', reason: 'Authentication timeout' });
      ws.close(4001, 'Auth timeout');
    }
  }, 30_000);

  ws.on('message', async (raw: Buffer | string) => {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'auth': {
        if (state.authenticated) {
          send(ws, { type: 'error', message: 'Already authenticated' });
          return;
        }

        const agentId = tokenAgentMap.get(msg.agentToken);
        if (!agentId) {
          send(ws, { type: 'auth_error', reason: 'Invalid agent token' });
          ws.close(4003, 'Invalid token');
          return;
        }

        state.agentToken = msg.agentToken;
        state.userId = msg.userId;
        state.agentId = agentId;
        state.sessionKey = getOrCreateSession(agentId, msg.userId);
        state.authenticated = true;
        clearTimeout(authTimeout);

        send(ws, { type: 'auth_ok', sessionId: state.sessionKey });
        break;
      }

      case 'message': {
        if (!state.authenticated) {
          send(ws, { type: 'auth_error', reason: 'Not authenticated' });
          return;
        }

        if (!msg.content?.trim()) {
          send(ws, { type: 'error', message: 'Empty message' });
          return;
        }

        try {
          const result = await openclawClient.sendMessage({
            message: msg.content,
            agentId: state.agentId,
            sessionKey: state.sessionKey,
          });

          if (result.success) {
            send(ws, { type: 'message', content: result.response || '', done: true });
          } else {
            send(ws, { type: 'error', message: result.error || 'Agent error' });
          }
        } catch (err) {
          send(ws, { type: 'error', message: 'Internal error processing message' });
        }
        break;
      }

      case 'ping': {
        send(ws, { type: 'pong' });
        break;
      }

      default: {
        send(ws, { type: 'error', message: 'Unknown message type' });
      }
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
  });
}
