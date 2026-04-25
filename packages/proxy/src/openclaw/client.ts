import { loadConfig } from '../config.js';
import { execFile } from 'node:child_process';

interface AgentResponse {
  success: boolean;
  response?: string;
  error?: string;
}

function execFilePromise(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        reject({
          error,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        });
        return;
      }

      resolve({
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  });
}

export class OpenClawClient {
  private gatewayUrl: string;
  private token: string;

  constructor(gatewayUrl?: string, token?: string) {
    const config = loadConfig();
    this.gatewayUrl = gatewayUrl || config.openClawGatewayUrl;
    this.token = token || config.openClawGatewayToken;
  }

  /**
   * Send a message to an agent via the OpenClaw CLI.
   */
  async sendMessage(opts: {
    message: string;
    agentId: string;
    sessionKey?: string;
    name?: string;
    timeoutSeconds?: number;
  }): Promise<AgentResponse> {
    const timeoutSeconds = opts.timeoutSeconds ?? 120;
    const args = ['agent', '--agent', opts.agentId, '-m', opts.message];
    if (opts.sessionKey) {
      args.push('--session-id', opts.sessionKey);
    }
    args.push('--json');

    try {
      const { stdout } = await execFilePromise('openclaw', args, timeoutSeconds * 1000);
      const parsed = JSON.parse(stdout) as {
        status?: unknown;
        summary?: unknown;
        result?: {
          error?: unknown;
          payloads?: Array<{ text?: unknown }>;
        };
      };

      if (parsed.status === 'error') {
        const errorText =
          (typeof parsed.result?.error === 'string' && parsed.result.error) ||
          (typeof parsed.summary === 'string' && parsed.summary) ||
          'OpenClaw CLI returned an error';
        return { success: false, error: errorText };
      }

      const payloads = Array.isArray(parsed.result?.payloads) ? parsed.result.payloads : [];
      const response = payloads
        .map((p) => (typeof p?.text === 'string' ? p.text : ''))
        .join('');
      return { success: true, response };
    } catch (error) {
      if (error && typeof error === 'object' && 'error' in error) {
        const wrapped = error as {
          error: NodeJS.ErrnoException & { code?: string | number; signal?: string | null; killed?: boolean };
          stderr: string;
        };
        const execError = wrapped.error;
        const isTimeout =
          execError.code === 'ETIMEDOUT'
          || (execError.killed === true
            && execError.signal === 'SIGTERM'
            && (execError.code === null || typeof execError.code === 'undefined'));
        if (isTimeout) {
          return { success: false, error: `OpenClaw CLI timed out after ${timeoutSeconds}s` };
        }
        return { success: false, error: wrapped.stderr?.trim() || execError.message };
      }

      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  /** Fire-and-forget: enqueue a system event via the hooks API */
  async wake(text: string, mode: 'now' | 'next-heartbeat' = 'now'): Promise<boolean> {
    const res = await fetch(`${this.gatewayUrl}/hooks/wake`, {
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
      const res = await fetch(`${this.gatewayUrl}/hooks/wake`, {
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
