import { loadConfig } from '../config.js';

interface AgentResponse {
  success: boolean;
  response?: string;
  error?: string;
}

export class OpenClawClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl?: string, token?: string) {
    const config = loadConfig();
    this.baseUrl = baseUrl || config.openClawHooksUrl;
    this.token = token || config.openClawHooksToken;
  }

  // Send message to an agent via hooks API
  async sendMessage(opts: {
    message: string;
    agentId: string;
    sessionKey?: string;
    name?: string;
  }): Promise<AgentResponse> {
    const res = await fetch(`${this.baseUrl}/hooks/agent`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: opts.message,
        agentId: opts.agentId,
        name: opts.name || 'widget-chat',
        wakeMode: 'now',
      }),
    });

    if (!res.ok) {
      return { success: false, error: `OpenClaw API error: ${res.status} ${res.statusText}` };
    }

    const data = await res.json() as Record<string, unknown>;
    return { success: true, response: data.response as string || data.text as string || JSON.stringify(data) };
  }

  // Wake the main session (for system events)
  async wake(text: string, mode: 'now' | 'next-heartbeat' = 'now'): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/hooks/wake`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, mode }),
    });
    return res.ok;
  }

  // Health check
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/hooks/wake`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'health-check', mode: 'next-heartbeat' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
