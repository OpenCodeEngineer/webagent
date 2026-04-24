import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../config.js';

const execFileAsync = promisify(execFile);

/**
 * Extract the visible agent text from OpenClaw CLI JSON output.
 * The CLI wraps the response in a deep structure — the actual text lives at:
 *   result.payloads[0].text       (primary)
 *   meta.finalAssistantVisibleText (fallback)
 *   response / text / reply       (flat fallback)
 */
function extractAgentText(data: Record<string, unknown>): string | undefined {
  // Primary: result.payloads[0].text
  const result = data.result as Record<string, unknown> | undefined;
  if (result && Array.isArray(result.payloads)) {
    const first = result.payloads[0] as Record<string, unknown> | undefined;
    if (first && typeof first.text === 'string' && first.text.trim()) {
      return first.text;
    }
  }

  // Fallback: meta.finalAssistantVisibleText
  const meta = data.meta as Record<string, unknown> | undefined;
  if (meta && typeof meta.finalAssistantVisibleText === 'string') {
    return meta.finalAssistantVisibleText;
  }

  // Flat fallback for simpler response shapes
  for (const key of ['response', 'text', 'reply', 'output'] as const) {
    if (typeof data[key] === 'string' && (data[key] as string).trim()) {
      return data[key] as string;
    }
  }

  return undefined;
}

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
        const text = extractAgentText(data);
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
