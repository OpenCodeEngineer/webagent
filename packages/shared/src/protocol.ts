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
  | { type: 'message'; content: string; done: boolean }
  | { type: 'error'; message: string }
  | { type: 'pong' };
