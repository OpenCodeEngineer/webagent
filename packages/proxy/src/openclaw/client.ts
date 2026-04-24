import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../config.js';

const execFileAsync = promisify(execFile);

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

  /**
   * Send a message to an agent synchronously via the `openclaw agent` CLI.
   * The CLI routes through the gateway and waits for the agent's full response.
   */
  async sendMessage(opts: {
    message: string;
    agentId: string;
    sessionKey?: string;
    name?: string;
    timeoutSeconds?: number;
  }): Promise<AgentResponse> {
    const args = [
      'agent',
      '--agent', opts.agentId,
      '-m', opts.message,
      '--json',
      '--timeout', String(opts.timeoutSeconds ?? 120),
    ];

    if (opts.sessionKey) {
      args.push('--session-id', opts.sessionKey);
    }

    try {
      const { stdout, stderr } = await execFileAsync('openclaw', args, {
        timeout: (opts.timeoutSeconds ?? 120) * 1000 + 5000,
        env: process.env,
        maxBuffer: 2 * 1024 * 1024,
      });

      if (!stdout.trim()) {
        const errMsg = stderr.trim() || 'Empty response from agent';
        return { success: false, error: errMsg };
      }

      try {
        const data = JSON.parse(stdout.trim()) as Record<string, unknown>;
        const text =
          (typeof data.response === 'string' ? data.response : undefined) ??
          (typeof data.text === 'string' ? data.text : undefined) ??
          (typeof data.reply === 'string' ? data.reply : undefined) ??
          (typeof data.output === 'string' ? data.output : undefined);

        return { success: true, response: text ?? stdout.trim() };
      } catch {
        // stdout wasn't JSON — return raw text as the response
        return { success: true, response: stdout.trim() };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `OpenClaw agent error: ${msg}` };
    }
  }

  /** Fire-and-forget: enqueue a system event via HTTP hooks API */
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
