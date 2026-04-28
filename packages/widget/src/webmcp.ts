/**
 * WebMCP integration for WebAgent widget.
 *
 * Provides two capabilities:
 * 1. Consumer – discover tools registered on the host page via navigator.modelContext
 * 2. Provider – register the widget itself as a WebMCP tool so external AI agents
 *    (e.g. Chrome Gemini sidebar) can ask questions through the widget.
 */

export interface DiscoveredTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

/** Returns true when the browser exposes the WebMCP navigator.modelContext API. */
export function isWebMcpAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'modelContext' in navigator;
}

/**
 * Discover WebMCP tools registered by the host page.
 * Returns an empty array when WebMCP is unavailable or no tools are registered.
 */
export function discoverHostWebMcpTools(): DiscoveredTool[] {
  if (!isWebMcpAvailable()) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mc = (navigator as any).modelContext;
  if (typeof mc?.getTools !== 'function') return [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] = mc.getTools();
    if (!Array.isArray(tools)) return [];
    return tools.map((t) => ({
      name: typeof t.name === 'string' ? t.name : 'unknown',
      description: typeof t.description === 'string' ? t.description : '',
      inputSchema: t.inputSchema ?? undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Register the widget as a WebMCP tool provider so external AI agents can invoke it.
 * The single tool "ask_support_agent" lets external agents send a query through the widget.
 *
 * @param sendMessage  Callback that delivers a message string to the agent (same as user typing).
 * @param signal       AbortSignal; tool will be unregistered when aborted.
 */
export function registerWidgetAsWebMcpProvider(
  sendMessage: (content: string) => void,
  signal: AbortSignal,
): void {
  if (!isWebMcpAvailable()) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mc = (navigator as any).modelContext;
  if (typeof mc?.registerTool !== 'function') return;

  try {
    mc.registerTool(
      {
        name: 'ask_support_agent',
        title: 'Ask Support Agent',
        description:
          'Send a question or request to the embedded website support agent and receive a response.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The question or request to send to the support agent.',
            },
          },
          required: ['query'],
        },
        annotations: { readOnlyHint: false },
        execute: async (input: Record<string, unknown>) => {
          const query = typeof input['query'] === 'string' ? input['query'] : String(input['query'] ?? '');
          sendMessage(query);
          return { queued: true, query };
        },
      },
      { signal },
    );
  } catch {
    // WebMCP provider registration is best-effort
  }
}

/**
 * Format discovered host tools into a brief context string to prepend to the first user message.
 * This lets the backend agent know which additional tools are available on the host page.
 */
export function formatToolsAsContext(tools: DiscoveredTool[]): string {
  if (tools.length === 0) return '';
  const lines = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
  return `[Host page exposes the following WebMCP tools:\n${lines}]`;
}
