export interface MessageAttachment {
  name: string;
  type: string;
  data: string;
}

export interface AuthContext {
  Authorization?: string;
  Bearer?: string;
  apiToken?: string;
  token?: string;
  headers?: Record<string, unknown>;
  [key: string]: unknown;
}

// Client → Server messages
export type ClientMessage =
  | {
    type: 'auth';
    userId: string;
    mode?: 'widget' | 'admin';
    token: string;
    ticket?: string;
    agentToken?: string;
    context?: AuthContext;
  }
  | {
    type: 'auth';
    userId: string;
    mode?: 'widget' | 'admin';
    agentToken: string;
    token?: string;
    ticket?: string;
    context?: AuthContext;
  }
  | {
    type: 'auth';
    userId: string;
    mode?: 'widget' | 'admin';
    ticket: string;
    token?: string;
    agentToken?: string;
    context?: AuthContext;
  }
  | { type: 'message'; content: string; attachments?: MessageAttachment[] }
  | { type: 'ping' };

// Server → Client messages
export type ServerMessage =
  | { type: 'auth_ok'; sessionId: string }
  | { type: 'auth_error'; reason: string }
  | {
    type: 'history';
    sessionId: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    embedCode?: string;
  }
  | { type: 'thinking' }
  | { type: 'message'; content: string; done: boolean }
  | { type: 'error'; message: string }
  | { type: 'pong' };

// Distinct reason literal returned when the widget connects with a valid token
// but the agent has been paused by its owner. Widget renders a specific UX.
export const AUTH_ERROR_AGENT_PAUSED = 'agent_paused' as const;
