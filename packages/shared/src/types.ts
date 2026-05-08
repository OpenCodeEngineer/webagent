// Customer
export interface Customer {
  id: string;
  email: string;
  name: string | null;
  plan: 'free' | 'pro' | 'enterprise';
  createdAt: Date;
}

// Agent
export interface Agent {
  id: string;
  customerId: string;
  openclawAgentId: string;
  paperclipAgentId: string | null;
  name: string;
  websiteUrl: string | null;
  description: string | null;
  status: 'provisioning' | 'active' | 'paused' | 'error';
  widgetConfig: Record<string, unknown>;
  createdAt: Date;
}

// Widget session
export interface WidgetSession {
  id: string;
  agentId: string;
  externalUserId: string;
  openclawSessionKey: string;
  lastActiveAt: Date;
  createdAt: Date;
}

// Widget embed
export interface WidgetEmbed {
  id: string;
  agentId: string;
  embedToken: string;
  allowedOrigins: string[];
  createdAt: Date;
}

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
}
