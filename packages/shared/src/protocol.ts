// Client → Server messages
export type ClientMessage =
  | {
    type: 'auth';
    userId: string;
    mode?: 'widget' | 'admin';
    token: string;
    ticket?: string;
    agentToken?: string;
  }
  | {
    type: 'auth';
    userId: string;
    mode?: 'widget' | 'admin';
    agentToken: string;
    token?: string;
    ticket?: string;
  }
  | {
    type: 'auth';
    userId: string;
    mode?: 'widget' | 'admin';
    ticket: string;
    token?: string;
    agentToken?: string;
  }
  | { type: 'message'; content: string }
  | { type: 'ping' };

// Server → Client messages
export type ServerMessage =
  | { type: 'auth_ok'; sessionId: string }
  | { type: 'auth_error'; reason: string }
  | { type: 'message'; content: string; done: boolean }
  | { type: 'error'; message: string }
  | { type: 'pong' };
