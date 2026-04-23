class WebAgentWidget {
  private config: { agentToken: string; userId: string; serverUrl: string };

  constructor(config: { agentToken: string; userId: string; serverUrl?: string }) {
    this.config = {
      ...config,
      serverUrl: config.serverUrl || window.location.origin,
    };
    console.log('[WebAgent] Widget initialized', { agentToken: config.agentToken });
  }

  mount(container?: HTMLElement) {
    const target = container || document.body;
    const el = document.createElement('div');
    el.id = 'webagent-widget';
    el.innerHTML = '<div style="position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;background:#4F46E5;cursor:pointer;display:flex;align-items:center;justify-content:center;color:white;font-size:24px;box-shadow:0 4px 12px rgba(0,0,0,0.15);">💬</div>';
    target.appendChild(el);
  }

  destroy() {
    document.getElementById('webagent-widget')?.remove();
  }
}

// Auto-init from script tag
if (typeof document !== 'undefined') {
  const script = document.currentScript as HTMLScriptElement | null;
  if (script) {
    const agentToken = script.getAttribute('data-agent-token');
    const userId = script.getAttribute('data-user-id');
    if (agentToken && userId) {
      const widget = new WebAgentWidget({ agentToken, userId });
      widget.mount();
    }
  }
}

export { WebAgentWidget };
