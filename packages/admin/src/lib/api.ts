const getApiBaseUrl = (): string => {
  if (process.env.NEXT_PUBLIC_PROXY_URL) return process.env.NEXT_PUBLIC_PROXY_URL;
  // Server-side: use localhost proxy
  if (typeof window === "undefined") {
    const port = process.env.PROXY_PORT ?? "3001";
    return `http://127.0.0.1:${port}`;
  }
  return "";
};

type JsonObject = Record<string, unknown>;

export type AgentStatus = "active" | "paused" | "deleted";

export interface AgentSessionSummary {
  id: string;
  visitorId?: string;
  lastActive?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface Agent {
  id: string;
  name?: string;
  websiteUrl?: string;
  status?: AgentStatus | string;
  sessionCount?: number;
  embedCode?: string;
  embedToken?: string;
  createdAt?: string;
  updatedAt?: string;
  recentSessions?: AgentSessionSummary[];
  widgetPreviewUrl?: string;
  [key: string]: unknown;
}

export interface MetaAgentMessage {
  role: "system" | "user" | "assistant";
  content: string;
  [key: string]: unknown;
}

export interface CreateViaMetaAgentRequest {
  messages: MetaAgentMessage[];
  sessionId?: string;
}

export interface CreateViaMetaAgentResponse {
  sessionId?: string;
  session?: {
    id?: string;
    [key: string]: unknown;
  };
  agent?: Agent;
  response?: string;
  message?: string;
  embedCode?: string;
  [key: string]: unknown;
}

interface ApiEnvelope<T> {
  data?: T;
  item?: T;
  payload?: T;
  items?: T[];
  message?: string;
  error?: string;
  [key: string]: unknown;
}

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))
      ? Number(value)
      : undefined;

const withApiPath = (path: string): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const fullPath = normalizedPath.startsWith("/api")
    ? normalizedPath
    : `/api${normalizedPath}`;

  return `${getApiBaseUrl()}${fullPath}`;
};

const parseSessionSummary = (value: unknown): AgentSessionSummary | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = asString(value.id) ?? asString(value.sessionId);
  if (!id) {
    return undefined;
  }

  return {
    ...value,
    id,
    visitorId: asString(value.visitorId) ?? asString(value.externalUserId),
    lastActive: asString(value.lastActive) ?? asString(value.updatedAt),
    createdAt: asString(value.createdAt),
  };
};

const parseAgent = (value: unknown): Agent | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = asString(value.id);
  if (!id) {
    return undefined;
  }

  const recentSessionsRaw =
    Array.isArray(value.recentSessions)
      ? value.recentSessions
      : Array.isArray(value.sessions)
        ? value.sessions
        : [];

  return {
    ...value,
    id,
    name: asString(value.name),
    websiteUrl: asString(value.websiteUrl) ?? asString(value.website_url),
    status: asString(value.status),
    sessionCount:
      asNumber(value.sessionCount) ??
      asNumber(value.visitorCount) ??
      asNumber(value.session_count),
    embedCode: asString(value.embedCode) ?? asString(value.embed_code) ?? asString(value.scriptTag),
    embedToken: asString(value.embedToken) ?? asString(value.embed_token),
    createdAt: asString(value.createdAt) ?? asString(value.created_at),
    updatedAt: asString(value.updatedAt) ?? asString(value.updated_at),
    widgetPreviewUrl:
      asString(value.widgetPreviewUrl) ?? asString(value.previewUrl) ?? asString(value.widget_preview_url),
    recentSessions: recentSessionsRaw
      .map(parseSessionSummary)
      .filter((session): session is AgentSessionSummary => !!session),
  };
};

const parseCreateViaMetaAgentResponse = (value: unknown): CreateViaMetaAgentResponse => {
  if (!isRecord(value)) {
    return {};
  }

  const session = isRecord(value.session) ? value.session : undefined;

  return {
    ...value,
    session,
    sessionId:
      asString(value.sessionId) ??
      asString(value.session_id) ??
      (session ? asString(session.id) : undefined),
    response: asString(value.response) ?? asString(value.reply),
    message: asString(value.message),
    embedCode: asString(value.embedCode) ?? asString(value.embed_code),
    agent: parseAgent(value.agent),
  };
};

const safeJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const getApiToken = (): string | undefined =>
  process.env.PROXY_CUSTOMER_API_TOKEN ??
  process.env.PROXY_API_TOKEN ??
  process.env.OPENCLAW_GATEWAY_TOKEN;

const extractErrorMessage = (payload: unknown, statusText: string): string => {
  if (isRecord(payload)) {
    if (typeof payload.error === "string") {
      return payload.error;
    }

    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
  }

  return statusText;
};

const request = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T | undefined> => {
  const token = getApiToken();
  const headers = new Headers(init?.headers);
  if (init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(withApiPath(path), {
    cache: "no-store",
    ...init,
    headers,
  });

  const payload = await safeJson(response);

  if (!response.ok) {
    const message = extractErrorMessage(payload, response.statusText);
    throw new Error(message || `Request failed with ${response.status}`);
  }

  return payload as T | undefined;
};

const unwrapOne = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }

  if ("data" in value) {
    return value.data;
  }

  if ("item" in value) {
    return value.item;
  }

  if ("payload" in value && !Array.isArray(value.payload)) {
    return value.payload;
  }

  return value;
};

export async function getAgents(customerId?: string): Promise<Agent[]> {
  const query = customerId ? `?customerId=${encodeURIComponent(customerId)}` : "";
  const payload = await request<ApiEnvelope<unknown> | unknown[]>(`/api/agents${query}`);

  const list = Array.isArray(payload)
    ? payload
    : isRecord(payload)
      ? Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload.items)
          ? payload.items
          : isRecord(payload.payload) && Array.isArray(payload.payload.agents)
            ? payload.payload.agents
            : Array.isArray(payload.payload)
              ? payload.payload
              : []
      : [];

  return list.map(parseAgent).filter((agent): agent is Agent => !!agent);
}

const withCustomerId = (path: string, customerId?: string): string =>
  customerId ? `${path}?customerId=${encodeURIComponent(customerId)}` : path;

export async function getAgent(id: string, customerId?: string): Promise<Agent | undefined> {
  const payload = await request<ApiEnvelope<unknown> | unknown>(
    withCustomerId(`/api/agents/${encodeURIComponent(id)}`, customerId),
  );

  return parseAgent(unwrapOne(payload));
}

export async function createAgentViaMetaAgent(
  messages: MetaAgentMessage[],
  sessionId?: string,
  customerId?: string,
): Promise<CreateViaMetaAgentResponse> {
  const payload = await request<ApiEnvelope<unknown> | unknown>(
    withCustomerId("/api/agents/create-via-meta", customerId),
    {
      method: "POST",
      body: JSON.stringify({ messages, sessionId } satisfies CreateViaMetaAgentRequest),
    },
  );

  return parseCreateViaMetaAgentResponse(unwrapOne(payload));
}

export async function updateAgent(
  id: string,
  data: Partial<Agent>,
  customerId?: string,
): Promise<Agent | undefined> {
  const payload = await request<ApiEnvelope<unknown> | unknown>(
    withCustomerId(`/api/agents/${encodeURIComponent(id)}`, customerId),
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );

  return parseAgent(unwrapOne(payload));
}

export async function deleteAgent(id: string, customerId?: string): Promise<boolean> {
  await request(withCustomerId(`/api/agents/${encodeURIComponent(id)}`, customerId), {
    method: "DELETE",
  });

  return true;
}

export async function regenerateToken(id: string, customerId?: string): Promise<Agent | undefined> {
  const payload = await request<ApiEnvelope<unknown> | unknown>(
    withCustomerId(`/api/agents/${encodeURIComponent(id)}/embed-token`, customerId),
    {
      method: "POST",
    },
  );

  return parseAgent(unwrapOne(payload));
}
