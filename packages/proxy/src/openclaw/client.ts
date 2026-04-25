import { loadConfig } from '../config.js';

interface AgentResponse {
  success: boolean;
  response?: string;
  error?: string;
}

/**
 * Extract text from an OpenAI-compatible /v1/responses payload.
 *
 * The response shape is:
 *   { output: [ { type: "message", content: [ { type: "output_text", text: "…" } ] } ] }
 *
 * We concatenate every output_text block we find, falling back to a flat
 * `output_text` field or stringified `output` if the structure is unexpected.
 */
function extractResponseText(data: Record<string, unknown>): string | undefined {
  // Primary: output[].content[].text
  if (Array.isArray(data.output)) {
    const texts: string[] = [];
    for (const item of data.output) {
      const entry = item as Record<string, unknown> | undefined;
      if (!entry) continue;

      if (Array.isArray(entry.content)) {
        for (const block of entry.content) {
          const b = block as Record<string, unknown> | undefined;
          if (b && typeof b.text === 'string' && b.text.trim()) {
            texts.push(b.text);
          }
        }
      }

      // Single-text shorthand on the item itself
      if (typeof entry.text === 'string' && entry.text.trim()) {
        texts.push(entry.text);
      }
    }

    if (texts.length > 0) return texts.join('\n\n');
  }

  // Flat fallback: output_text at the top level
  if (typeof data.output_text === 'string' && (data.output_text as string).trim()) {
    return data.output_text as string;
  }

  // Last resort: stringify output if it exists
  if (data.output !== undefined) {
    const raw = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
    if (raw.trim()) return raw;
  }

  return undefined;
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
   * Send a message to an agent via the OpenAI-compatible /v1/responses HTTP API.
   */
  async sendMessage(opts: {
    message: string;
    agentId: string;
    sessionKey?: string;
    name?: string;
    timeoutSeconds?: number;
  }): Promise<AgentResponse> {
    const url = `${this.gatewayUrl}/v1/responses`;
    const body: Record<string, unknown> = {
      model: `openclaw/${opts.agentId}`,
      input: opts.message,
    };

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    if (opts.sessionKey) {
      headers['x-openclaw-session-key'] = opts.sessionKey;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout((opts.timeoutSeconds ?? 120) * 1000),
      });

      if (!res.ok) {
        let detail = '';
        try {
          detail = await res.text();
        } catch { /* ignore */ }
        return {
          success: false,
          error: `Gateway error: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
        };
      }

      const data = (await res.json()) as Record<string, unknown>;
      const text = extractResponseText(data);
      return { success: true, response: text ?? '' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `OpenClaw gateway error: ${msg}` };
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
