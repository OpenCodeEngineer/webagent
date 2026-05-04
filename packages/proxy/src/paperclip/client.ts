/**
 * Paperclip control-plane API client.
 *
 * Paperclip runs in local_trusted mode (loopback only, no auth required).
 * This client is used when PAPERCLIP_ENABLED=true to sync agent entities
 * from the proxy into Paperclip's registry.
 */

import type { ProxyConfig } from '../config.js';

export interface PaperclipAgent {
  id: string;
  name: string;
  slug: string;
  adapter: string;
  adapterConfig: Record<string, unknown>;
  status: string;
}

export interface PaperclipCompany {
  id: string;
  name: string;
}

export class PaperclipClient {
  private readonly baseUrl: string;
  private readonly enabled: boolean;

  constructor(config: Pick<ProxyConfig, 'paperclipEnabled' | 'paperclipUrl'>) {
    this.enabled = config.paperclipEnabled;
    this.baseUrl = config.paperclipUrl.replace(/\/+$/, '');
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if Paperclip is reachable.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * List companies. After onboard, there should be exactly one.
   */
  async listCompanies(): Promise<PaperclipCompany[]> {
    if (!this.enabled) return [];
    const res = await this.request('/api/v1/companies');
    if (!res.ok) return [];
    const data = (await res.json()) as { companies?: PaperclipCompany[] };
    return data.companies ?? [];
  }

  /**
   * Get the default (first) company ID, or null if none exists.
   */
  async getDefaultCompanyId(): Promise<string | null> {
    const companies = await this.listCompanies();
    return companies[0]?.id ?? null;
  }

  /**
   * Register or update an agent in Paperclip.
   * Uses upsert semantics — if an agent with the same slug exists, it updates.
   */
  async upsertAgent(params: {
    companyId: string;
    slug: string;
    name: string;
    openclawAgentId: string;
    websiteUrl?: string | null;
  }): Promise<PaperclipAgent | null> {
    if (!this.enabled) return null;

    // Try to find existing agent by slug
    const existing = await this.findAgentBySlug(params.companyId, params.slug);

    const body = {
      name: params.name,
      slug: params.slug,
      adapter: 'openclaw-gateway',
      adapter_config: {
        openclaw_agent_id: params.openclawAgentId,
        website_url: params.websiteUrl ?? undefined,
      },
      status: 'active',
    };

    if (existing) {
      // Update
      const res = await this.request(
        `/api/v1/companies/${params.companyId}/agents/${existing.id}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      if (!res.ok) return null;
      return (await res.json()) as PaperclipAgent;
    }

    // Create
    const res = await this.request(
      `/api/v1/companies/${params.companyId}/agents`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (!res.ok) return null;
    return (await res.json()) as PaperclipAgent;
  }

  /**
   * Find an agent by slug within a company.
   */
  async findAgentBySlug(companyId: string, slug: string): Promise<PaperclipAgent | null> {
    if (!this.enabled) return null;
    const res = await this.request(`/api/v1/companies/${companyId}/agents?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { agents?: PaperclipAgent[] };
    return data.agents?.[0] ?? null;
  }

  /**
   * Delete an agent from Paperclip.
   */
  async deleteAgent(companyId: string, agentId: string): Promise<boolean> {
    if (!this.enabled) return false;
    const res = await this.request(
      `/api/v1/companies/${companyId}/agents/${agentId}`,
      { method: 'DELETE' },
    );
    return res.ok;
  }

  /**
   * Configure the openclaw-gateway adapter for a company.
   */
  async configureAdapter(params: {
    companyId: string;
    gatewayUrl: string;
    gatewayToken?: string;
  }): Promise<boolean> {
    if (!this.enabled) return false;
    const res = await this.request(
      `/api/v1/companies/${params.companyId}/adapters/openclaw-gateway`,
      {
        method: 'PUT',
        body: JSON.stringify({
          gateway_url: params.gatewayUrl,
          gateway_token: params.gatewayToken,
        }),
      },
    );
    return res.ok;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...init?.headers,
      },
      signal: init?.signal ?? AbortSignal.timeout(10_000),
    });
  }
}
