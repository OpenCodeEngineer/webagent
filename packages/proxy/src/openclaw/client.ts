import { loadConfig } from '../config.js';

export interface AgentResponse {
  content: string;
  done: boolean;
}

interface RequestOptions {
  expectJson?: boolean;
}

/**
 * Join a base URL with an endpoint path, deduplicating any overlapping
 * path suffix/prefix so that both of these produce the same result:
 *   base "http://host:port/hooks" + endpoint "/hooks/agent" → "http://host:port/hooks/agent"
 *   base "http://host:port"       + endpoint "/hooks/agent" → "http://host:port/hooks/agent"
 */
function joinUrl(base: string, endpoint: string): string {
  const cleanBase = base.replace(/\/+$/, '');
  const cleanEndpoint = endpoint.replace(/^\/+/, '');

  const baseParts = cleanBase.split('/');
  const endpointParts = cleanEndpoint.split('/');

  // Find the longest overlapping suffix of baseParts that matches a prefix of endpointParts.
  let overlap = 0;
  for (let len = 1; len <= Math.min(baseParts.length, endpointParts.length); len++) {
    const baseSuffix = baseParts.slice(-len).join('/');
    const endpointPrefix = endpointParts.slice(0, len).join('/');
    if (baseSuffix === endpointPrefix) {
      overlap = len;
    }
  }

  return `${cleanBase}/${endpointParts.slice(overlap).join('/')}`.replace(/\/+$/, '');
}

export class OpenClawClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config = loadConfig()) {
    this.baseUrl = config.openClawHooksUrl.replace(/\/$/, '');
    this.token = config.openClawHooksToken;
  }

  async sendMessage(agentId: string, sessionKey: string, content: string): Promise<AgentResponse> {
    const payload = await this.request<unknown>(
      '/hooks/agent',
      {
        method: 'POST',
        body: JSON.stringify({ agentId, sessionKey, content })
      },
      { expectJson: true }
    );

    return this.normalizeAgentResponse(payload);
  }

  async wake(agentId: string): Promise<void> {
    await this.request(
      '/hooks/wake',
      {
        method: 'POST',
        body: JSON.stringify({ agentId })
      },
      { expectJson: false }
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.request('/hooks/wake', { method: 'POST', body: JSON.stringify({}) }, { expectJson: false });
      return true;
    } catch {
      return false;
    }
  }

  private async request<T>(
    endpoint: string,
    init: RequestInit,
    options: RequestOptions = {}
  ): Promise<T | undefined> {
    const url = joinUrl(this.baseUrl, endpoint);

    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
          ...(init.headers ?? {})
        }
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown network failure';
      throw new Error(`OpenClaw request failed (${endpoint}): ${reason}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const detail = body ? ` - ${body.slice(0, 500)}` : '';
      throw new Error(`OpenClaw request failed (${endpoint}): HTTP ${response.status}${detail}`);
    }

    if (!options.expectJson) {
      return undefined;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new Error(`OpenClaw request failed (${endpoint}): invalid JSON response`);
    }
  }

  private normalizeAgentResponse(payload: unknown): AgentResponse {
    if (!payload || typeof payload !== 'object') {
      return { content: '', done: true };
    }

    const maybe = payload as { content?: unknown; done?: unknown; message?: unknown; output?: unknown };
    const content =
      typeof maybe.content === 'string'
        ? maybe.content
        : typeof maybe.message === 'string'
          ? maybe.message
          : typeof maybe.output === 'string'
            ? maybe.output
            : '';

    const done = typeof maybe.done === 'boolean' ? maybe.done : true;

    return { content, done };
  }
}
