export interface MessageAttachment {
  name: string;
  type: string;
  data: string;
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
    context?: Record<string, unknown>;
  }
  | {
    type: 'auth';
    userId: string;
    mode?: 'widget' | 'admin';
    agentToken: string;
    token?: string;
    ticket?: string;
    context?: Record<string, unknown>;
  }
  | {
    type: 'auth';
    userId: string;
    mode?: 'widget' | 'admin';
    ticket: string;
    token?: string;
    agentToken?: string;
    context?: Record<string, unknown>;
  }
  | { type: 'message'; content: string; attachments?: MessageAttachment[] }
  | { type: 'ping' };

// Server → Client messages
export type ServerMessage =
  | { type: 'auth_ok'; sessionId: string }
  | { type: 'auth_error'; reason: string }
  | { type: 'message'; content: string; done: boolean }
  | { type: 'error'; message: string }
  | { type: 'pong' };
