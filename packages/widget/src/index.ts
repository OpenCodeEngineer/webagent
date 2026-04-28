import { renderMarkdownToSafeHtml } from './markdown.js';
import {
  discoverHostWebMcpTools,
  registerWidgetAsWebMcpProvider,
  formatToolsAsContext,
  type DiscoveredTool,
} from './webmcp.js';

interface WidgetConfig {
  agentToken: string;
  userId: string;
  serverUrl?: string;
  title?: string;
}

type ClientMessage =
  | { type: 'auth'; token: string; userId: string }
  | { type: 'message'; content: string }
  | { type: 'ping' };

type ServerMessage =
  | { type: 'auth_ok'; sessionId?: string; agentId?: string }
  | { type: 'auth_error'; reason?: string }
  | { type: 'message'; content?: string; done?: boolean }
  | { type: 'error'; code?: string; message?: string }
  | { type: 'pong' };

type BannerKind = 'info' | 'warning' | 'error';
type RetryPayload = { type: 'message'; content: string };

interface ChatMessage {
  id: string;
  role: 'visitor' | 'agent';
  content: string;
  failed?: boolean;
  retryPayload?: RetryPayload;
}

class WebAgentWidget {
  private readonly config: Required<Pick<WidgetConfig, 'agentToken' | 'userId' | 'serverUrl' | 'title'>>;
  private readonly reconnectDelays = [1, 2, 4, 8, 16, 30];

  private host: HTMLDivElement | null = null;
  private shadowRootNode: ShadowRoot | null = null;
  private ws: WebSocket | null = null;

  private isMounted = false;
  private isOpen = false;
  private isAuthenticated = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private hasFatalAuthError = false;
  private activeAgentMessageId: string | null = null;
  private waitingForAgent = false;
  private unreadCount = 0;

  private readonly messages: ChatMessage[] = [];

  // WebMCP
  private webMcpAbortController: AbortController | null = null;
  private hostWebMcpTools: DiscoveredTool[] = [];
  private webMcpContextSent = false;

  // Escalation modal
  private isEscalationOpen = false;
  private escalationModal: HTMLElement | null = null;
  private escalationEmailInput: HTMLInputElement | null = null;
  private escalationNameInput: HTMLInputElement | null = null;
  private escalationContextInput: HTMLTextAreaElement | null = null;
  private escalationSubmitButton: HTMLButtonElement | null = null;

  private bubbleButton: HTMLButtonElement | null = null;
  private panel: HTMLElement | null = null;
  private badge: HTMLElement | null = null;
  private banner: HTMLElement | null = null;
  private messagesList: HTMLElement | null = null;
  private typingIndicator: HTMLElement | null = null;
  private input: HTMLTextAreaElement | null = null;
  private sendButton: HTMLButtonElement | null = null;
  private liveRegion: HTMLElement | null = null;

  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.isOpen) {
      this.closePanel();
    }
  };

  constructor(config: WidgetConfig) {
    this.config = {
      agentToken: config.agentToken,
      userId: config.userId,
      title: config.title ?? 'Chat Assistant',
      serverUrl: config.serverUrl ?? WebAgentWidget.deriveWsUrl(),
    };
  }

  mount(container: HTMLElement = document.body): void {
    if (this.isMounted) {
      return;
    }

    this.host = document.createElement('div');
    this.host.setAttribute('data-webagent-widget', 'true');
    this.shadowRootNode = this.host.attachShadow({ mode: 'open' });
    this.shadowRootNode.innerHTML = this.template();
    container.appendChild(this.host);

    this.bindElements();
    this.bindEvents();
    this.renderMessages();
    this.renderUnreadBadge();
    this.updateInputState();
    this.connect();

    this.isMounted = true;
  }

  destroy(): void {
    this.isMounted = false;
    this.stopPing();
    this.clearReconnectTimer();
    this.webMcpAbortController?.abort();
    this.webMcpAbortController = null;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }

    document.removeEventListener('keydown', this.onDocumentKeydown);
    this.host?.remove();

    this.host = null;
    this.shadowRootNode = null;
  }

  static resolveScriptTag(): HTMLScriptElement | null {
    if (document.currentScript instanceof HTMLScriptElement) {
      return document.currentScript;
    }

    const candidates = document.querySelectorAll<HTMLScriptElement>('script[data-agent-token][data-user-id]');
    return candidates.length > 0 ? candidates[candidates.length - 1] ?? null : null;
  }

  static deriveWsUrl(script: HTMLScriptElement | null = WebAgentWidget.resolveScriptTag()): string {
    const pageUrl = new URL(window.location.href);
    const fallbackScheme = pageUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const fallbackHost = pageUrl.host;

    if (script?.src) {
      try {
        const scriptUrl = new URL(script.src, pageUrl);
        const scheme = scriptUrl.protocol === 'https:' ? 'wss:' : scriptUrl.protocol === 'http:' ? 'ws:' : fallbackScheme;
        const host = scriptUrl.host || fallbackHost;
        return `${scheme}//${host}/ws`;
      } catch {
        return `${fallbackScheme}//${fallbackHost}/ws`;
      }
    }

    return `${fallbackScheme}//${fallbackHost}/ws`;
  }

  private bindElements(): void {
    if (!this.shadowRootNode) {
      throw new Error('Widget root not initialized');
    }

    const query = <T extends Element>(selector: string): T => {
      const element = this.shadowRootNode?.querySelector(selector);
      if (!element) {
        throw new Error(`Widget element missing: ${selector}`);
      }
      return element as T;
    };

    this.bubbleButton = query<HTMLButtonElement>('.wa-bubble');
    this.panel = query<HTMLElement>('.wa-panel');
    this.badge = query<HTMLElement>('.wa-badge');
    this.banner = query<HTMLElement>('.wa-banner');
    this.messagesList = query<HTMLElement>('.wa-messages');
    this.typingIndicator = query<HTMLElement>('.wa-typing');
    this.input = query<HTMLTextAreaElement>('.wa-input');
    this.sendButton = query<HTMLButtonElement>('.wa-send');
    this.liveRegion = query<HTMLElement>('.wa-live-region');
    this.escalationModal = this.shadowRootNode?.querySelector<HTMLElement>('.wa-esc-modal') ?? null;
    this.escalationEmailInput = this.shadowRootNode?.querySelector<HTMLInputElement>('.wa-esc-email') ?? null;
    this.escalationNameInput = this.shadowRootNode?.querySelector<HTMLInputElement>('.wa-esc-name') ?? null;
    this.escalationContextInput = this.shadowRootNode?.querySelector<HTMLTextAreaElement>('.wa-esc-context') ?? null;
    this.escalationSubmitButton = this.shadowRootNode?.querySelector<HTMLButtonElement>('.wa-esc-submit') ?? null;
  }

  private bindEvents(): void {
    this.bubbleButton?.addEventListener('click', () => {
      if (this.isOpen) {
        this.closePanel();
      } else {
        this.openPanel();
      }
    });

    this.shadowRootNode?.querySelector('.wa-close')?.addEventListener('click', () => this.closePanel());

    this.shadowRootNode?.querySelector('.wa-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.sendCurrentInput();
    });

    this.input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.sendCurrentInput();
      }
    });

    this.messagesList?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const retryButton = target.closest<HTMLButtonElement>('button[data-retry-id]');
      if (!retryButton) {
        return;
      }
      const retryId = retryButton.getAttribute('data-retry-id');
      if (retryId) {
        this.retryMessage(retryId);
      }
    });

    document.addEventListener('keydown', this.onDocumentKeydown);

    // Escalation modal bindings
    this.shadowRootNode?.querySelector('.wa-esc-open')?.addEventListener('click', () => this.openEscalation());
    this.shadowRootNode?.querySelector('.wa-esc-close')?.addEventListener('click', () => this.closeEscalation());
    this.shadowRootNode?.querySelector('.wa-esc-overlay')?.addEventListener('click', () => this.closeEscalation());
    this.shadowRootNode?.querySelector('.wa-esc-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submitEscalation();
    });
  }

  private openPanel(): void {
    this.isOpen = true;
    this.unreadCount = 0;
    this.renderUnreadBadge();
    this.panel?.setAttribute('data-open', 'true');
    this.bubbleButton?.setAttribute('aria-expanded', 'true');
    this.input?.focus();
  }

  private closePanel(): void {
    this.isOpen = false;
    this.panel?.setAttribute('data-open', 'false');
    this.bubbleButton?.setAttribute('aria-expanded', 'false');
    this.bubbleButton?.focus();
  }

  private connect(): void {
    if (this.hasFatalAuthError) {
      this.isAuthenticated = false;
      this.stopPing();
      this.clearReconnectTimer();
      this.updateInputState();
      this.setBanner('Invalid configuration. Contact site owner.', 'error');
      return;
    }

    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setBanner('', 'info');

    try {
      this.ws = new WebSocket(this.config.serverUrl);
    } catch {
      this.handleConnectionFailure();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.sendAuth();
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      this.handleServerMessage(event.data);
    };

    this.ws.onclose = () => {
      this.isAuthenticated = false;
      this.updateInputState();
      this.stopPing();
      if (this.isMounted) {
        this.handleConnectionFailure();
      }
    };

    this.ws.onerror = () => {
      // onclose handles retries and UI state
    };
  }

  private handleConnectionFailure(): void {
    if (this.hasFatalAuthError) {
      this.setBanner('Invalid configuration. Contact site owner.', 'error');
      return;
    }

    this.setBanner('Unable to connect. Retrying...', 'warning');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.hasFatalAuthError) {
      return;
    }

    this.setBanner('Reconnecting...', 'info');

    const delaySeconds = this.reconnectDelays[Math.min(this.reconnectAttempt, this.reconnectDelays.length - 1)] ?? 30;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt += 1;
      this.connect();
    }, delaySeconds * 1000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private sendAuth(): void {
    this.isAuthenticated = false;
    this.updateInputState();

    const payload: ClientMessage = {
      type: 'auth',
      token: this.config.agentToken,
      userId: this.config.userId,
    };

    if (!this.sendPayload(payload)) {
      this.handleConnectionFailure();
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.sendPayload({ type: 'ping' });
    }, 25_000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private sendCurrentInput(): void {
    if (!this.isAuthenticated || !this.input) {
      return;
    }

    const content = this.input.value.trim();
    if (!content) {
      return;
    }

    // On the first message after auth, prepend WebMCP host tool context if available
    let wireContent = content;
    if (!this.webMcpContextSent && this.hostWebMcpTools.length > 0) {
      const ctx = formatToolsAsContext(this.hostWebMcpTools);
      if (ctx) {
        wireContent = `${ctx}\n\n${content}`;
      }
      this.webMcpContextSent = true;
    }

    const outgoing: RetryPayload = { type: 'message', content: wireContent };
    const messageId = this.pushVisitorMessage(content, { type: 'message', content });
    this.input.value = '';

    if (this.sendPayload(outgoing)) {
      this.waitingForAgent = true;
      this.activeAgentMessageId = null;
      this.renderTyping();
      return;
    }

    this.markMessageFailed(messageId);
  }

  private retryMessage(messageId: string): void {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message?.failed || !message.retryPayload) {
      return;
    }

    if (!this.isAuthenticated) {
      this.setBanner('Reconnecting...', 'info');
      return;
    }

    if (!this.sendPayload(message.retryPayload)) {
      this.setBanner('Unable to connect. Retrying...', 'warning');
      this.scheduleReconnect();
      return;
    }

    message.failed = false;
    this.waitingForAgent = true;
    this.activeAgentMessageId = null;
    this.renderMessages();
    this.renderTyping();
  }

  private sendPayload(payload: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  private handleServerMessage(raw: unknown): void {
    let parsed: ServerMessage | null = null;

    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }
    }

    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
      return;
    }

    switch (parsed.type) {
      case 'auth_ok': {
        this.hasFatalAuthError = false;
        this.isAuthenticated = true;
        this.setBanner('', 'info');
        this.updateInputState();
        this.setupWebMcp();
        break;
      }
      case 'auth_error': {
        this.isAuthenticated = false;
        this.updateInputState();
        const reason = (parsed.reason ?? '').toLowerCase();
        const isTransientAuthError = reason.includes('not authenticated') || reason.includes('unauth');
        const isFatalAuthError = reason.includes('invalid') || reason.includes('token') || reason.includes('config');

        if (isTransientAuthError) {
          this.hasFatalAuthError = false;
          this.setBanner('Reconnecting...', 'info');
        } else {
          this.hasFatalAuthError = isFatalAuthError;
          if (this.hasFatalAuthError) {
            this.clearReconnectTimer();
            this.stopPing();
            if (this.ws) {
              this.ws.close();
              this.ws = null;
            }
          }
          this.setBanner('Invalid configuration. Contact site owner.', 'error');
        }
        break;
      }
      case 'message': {
        this.handleIncomingMessage(parsed.content ?? '', Boolean(parsed.done));
        break;
      }
      case 'error': {
        this.resetPendingAgentResponse();
        this.setBanner(parsed.message ?? 'Something went wrong. Please try again.', 'error');
        break;
      }
      case 'pong': {
        break;
      }
    }
  }

  private handleIncomingMessage(content: string, done: boolean): void {
    this.waitingForAgent = !done;

    if (!this.activeAgentMessageId) {
      const message: ChatMessage = {
        id: this.nextId(),
        role: 'agent',
        content: '',
      };
      this.messages.push(message);
      this.activeAgentMessageId = message.id;
    }

    const message = this.messages.find((item) => item.id === this.activeAgentMessageId);
    if (!message) {
      return;
    }

    message.content += content;

    if (done) {
      this.activeAgentMessageId = null;
      this.waitingForAgent = false;
      if (!this.isOpen) {
        this.unreadCount += 1;
        this.renderUnreadBadge();
      }
      this.announce(message.content);
    }

    this.renderMessages();
    this.renderTyping();
  }

  private pushVisitorMessage(content: string, retryPayload: RetryPayload): string {
    const message: ChatMessage = {
      id: this.nextId(),
      role: 'visitor',
      content,
      retryPayload,
    };
    this.messages.push(message);
    this.renderMessages();
    return message.id;
  }

  private markMessageFailed(messageId: string): void {
    const target = this.messages.find((item) => item.id === messageId);
    if (!target) {
      return;
    }

    target.failed = true;
    this.renderMessages();
    this.setBanner('Unable to connect. Retrying...', 'warning');
    this.scheduleReconnect();
  }

  private resetPendingAgentResponse(): void {
    this.waitingForAgent = false;
    this.activeAgentMessageId = null;
    this.renderTyping();
  }

  private announce(message: string): void {
    if (!this.liveRegion) {
      return;
    }

    this.liveRegion.textContent = '';
    window.setTimeout(() => {
      if (this.liveRegion) {
        this.liveRegion.textContent = `Agent: ${message}`;
      }
    }, 30);
  }

  private renderUnreadBadge(): void {
    if (!this.badge) {
      return;
    }

    this.badge.textContent = this.unreadCount > 99 ? '99+' : String(this.unreadCount);
    this.badge.setAttribute('data-visible', this.unreadCount > 0 && !this.isOpen ? 'true' : 'false');
  }

  private setBanner(message: string, kind: BannerKind): void {
    if (!this.banner) {
      return;
    }

    this.banner.textContent = message;
    this.banner.setAttribute('data-kind', kind);
    this.banner.setAttribute('data-visible', message ? 'true' : 'false');
  }

  private updateInputState(): void {
    const disabled = !this.isAuthenticated;
    if (this.input) {
      this.input.disabled = disabled;
      this.input.setAttribute('aria-disabled', String(disabled));
      this.input.placeholder = disabled ? 'Waiting for connection...' : 'Type your message';
    }
    if (this.sendButton) {
      this.sendButton.disabled = disabled;
      this.sendButton.setAttribute('aria-disabled', String(disabled));
    }
  }

  private renderTyping(): void {
    if (!this.typingIndicator) {
      return;
    }

    this.typingIndicator.setAttribute('data-visible', this.waitingForAgent ? 'true' : 'false');
  }

  private renderMessages(): void {
    if (!this.messagesList) {
      return;
    }

    this.messagesList.innerHTML = this.messages
      .map((message) => {
        const rendered = renderMarkdownToSafeHtml(message.content);

        if (message.role === 'visitor' && message.failed) {
          return `<div class="wa-message wa-visitor"><button type="button" class="wa-msg wa-failed" data-retry-id="${message.id}" aria-label="Retry sending message">${rendered}<span class="wa-failed-note">Failed to send. Click to retry.</span></button></div>`;
        }

        return `<div class="wa-message ${message.role === 'visitor' ? 'wa-visitor' : 'wa-agent'}"><div class="wa-msg">${rendered}</div></div>`;
      })
      .join('');

    this.messagesList.scrollTop = this.messagesList.scrollHeight;
  }

  // ─── WebMCP ───────────────────────────────────────────────────────────────

  private setupWebMcp(): void {
    // Abort any previous registration
    this.webMcpAbortController?.abort();
    this.webMcpAbortController = new AbortController();
    this.webMcpContextSent = false;

    // Discover tools the host page exposes
    this.hostWebMcpTools = discoverHostWebMcpTools();

    // Register this widget so external AI agents can send queries through it
    registerWidgetAsWebMcpProvider(
      (content) => {
        if (!this.isAuthenticated) return;
        const outgoing: RetryPayload = { type: 'message', content };
        const messageId = this.pushVisitorMessage(content, outgoing);
        if (this.sendPayload(outgoing)) {
          this.waitingForAgent = true;
          this.activeAgentMessageId = null;
          this.renderTyping();
        } else {
          this.markMessageFailed(messageId);
        }
      },
      this.webMcpAbortController.signal,
    );
  }

  // ─── Escalation ───────────────────────────────────────────────────────────

  private openEscalation(): void {
    this.isEscalationOpen = true;
    this.escalationModal?.setAttribute('data-open', 'true');
    this.escalationEmailInput?.focus();
  }

  private closeEscalation(): void {
    this.isEscalationOpen = false;
    this.escalationModal?.setAttribute('data-open', 'false');
    if (this.escalationEmailInput) this.escalationEmailInput.value = '';
    if (this.escalationNameInput) this.escalationNameInput.value = '';
    if (this.escalationContextInput) this.escalationContextInput.value = '';
  }

  private async submitEscalation(): Promise<void> {
    const email = this.escalationEmailInput?.value.trim() ?? '';
    if (!email) return;
    const name = this.escalationNameInput?.value.trim() ?? '';
    const context = this.escalationContextInput?.value.trim() ?? '';

    if (this.escalationSubmitButton) {
      this.escalationSubmitButton.disabled = true;
      this.escalationSubmitButton.textContent = 'Sending…';
    }

    // Derive HTTP base URL from the WS server URL
    const wsUrl = this.config.serverUrl;
    const httpBase = wsUrl.replace(/^wss?:\/\//, (m) => (m.startsWith('wss') ? 'https://' : 'http://'));
    const apiBase = httpBase.replace(/\/ws$/, '');

    const transcript = this.messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      await fetch(`${apiBase}/api/escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: this.config.agentToken,
          userId: this.config.userId,
          email,
          name,
          context,
          transcript,
        }),
      });
    } catch {
      // best-effort; don't block the user
    }

    if (this.escalationSubmitButton) {
      this.escalationSubmitButton.disabled = false;
      this.escalationSubmitButton.textContent = 'Send to Support';
    }

    this.closeEscalation();
    this.setBanner('Your request has been sent to support.', 'info');
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private nextId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private template(): string {
    const inputId = `wa-input-${Math.random().toString(36).slice(2, 8)}`;

    return `
      <style>
        :host {
          all: initial;
          font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color-scheme: light dark;
        }

        .wa-root {
          position: fixed;
          right: 20px;
          bottom: 20px;
          z-index: 2147483647;
        }

        .wa-bubble {
          width: 56px;
          height: 56px;
          border: 0;
          border-radius: 999px;
          background: linear-gradient(135deg, #3b82f6, #4f46e5);
          color: #fff;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          box-shadow: 0 12px 30px rgba(59, 130, 246, 0.35);
        }

        .wa-bubble:focus-visible,
        .wa-close:focus-visible,
        .wa-send:focus-visible,
        .wa-failed:focus-visible {
          outline: 2px solid #2563eb;
          outline-offset: 2px;
        }

        .wa-badge {
          position: absolute;
          top: -4px;
          right: -2px;
          min-width: 18px;
          height: 18px;
          border-radius: 999px;
          background: #ef4444;
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          padding: 0 5px;
          display: none;
          align-items: center;
          justify-content: center;
        }

        .wa-badge[data-visible='true'] {
          display: inline-flex;
        }

        .wa-panel {
          width: 380px;
          height: 520px;
          position: absolute;
          right: 0;
          bottom: 72px;
          border-radius: 16px;
          border: 1px solid rgba(148, 163, 184, 0.4);
          background: #fff;
          color: #0f172a;
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.28);
          display: grid;
          grid-template-rows: auto auto 1fr auto auto;
          overflow: hidden;
          transform: translateY(12px) scale(0.98);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s ease, transform 0.2s ease;
        }

        .wa-panel[data-open='true'] {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: auto;
        }

        .wa-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 14px 10px;
          background: #f8fafc;
          border-bottom: 1px solid rgba(148, 163, 184, 0.25);
        }

        .wa-title {
          margin: 0;
          font-size: 14px;
          font-weight: 650;
        }

        .wa-close {
          width: 30px;
          height: 30px;
          border: 0;
          border-radius: 8px;
          cursor: pointer;
          background: transparent;
          color: inherit;
          font-size: 16px;
        }

        .wa-banner {
          display: none;
          font-size: 12px;
          padding: 8px 12px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.25);
          background: #f8fafc;
        }

        .wa-banner[data-visible='true'] {
          display: block;
        }

        .wa-banner[data-kind='warning'] {
          color: #92400e;
          background: #fef3c7;
        }
2m+
        .wa-banner[data-kind='error'] {
          color: #991b1b;
          background: #fee2e2;
        }

        .wa-messages {
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          background: #fff;
          scrollbar-width: thin;
        }

        .wa-message {
          display: flex;
        }

        .wa-agent {
          justify-content: flex-start;
        }

        .wa-visitor {
          justify-content: flex-end;
        }

        .wa-msg {
          max-width: 82%;
          border-radius: 14px;
          padding: 10px 12px;
          font-size: 14px;
          line-height: 1.4;
          word-break: break-word;
          background: #f1f5f9;
          color: #0f172a;
        }

        .wa-msg p {
          margin: 0;
        }

        .wa-msg p + p,
        .wa-msg ul,
        .wa-msg ol,
        .wa-msg pre {
          margin-top: 8px;
        }

        .wa-msg ul,
        .wa-msg ol {
          padding-left: 18px;
        }

        .wa-msg pre {
          overflow-x: auto;
          border-radius: 10px;
          padding: 8px 10px;
          background: rgba(15, 23, 42, 0.08);
        }

        .wa-msg code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
          font-size: 12px;
          background: rgba(15, 23, 42, 0.08);
          padding: 1px 4px;
          border-radius: 5px;
        }

        .wa-msg pre code {
          padding: 0;
          background: transparent;
        }

        .wa-msg a {
          color: inherit;
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        .wa-visitor .wa-msg {
          background: #2563eb;
          color: #fff;
        }

        .wa-failed {
          border: 1px solid rgba(248, 113, 113, 0.7);
          background: #fee2e2;
          color: #991b1b;
          cursor: pointer;
          text-align: left;
        }

        .wa-failed-note {
          display: block;
          margin-top: 6px;
          font-size: 11px;
          font-weight: 600;
        }

        .wa-typing {
          display: none;
          align-items: center;
          gap: 5px;
          padding: 0 12px 10px;
        }

        .wa-typing[data-visible='true'] {
          display: flex;
        }

        .wa-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #64748b;
          animation: wa-bounce 1s infinite ease-in-out;
        }

        .wa-dot:nth-child(2) {
          animation-delay: 0.15s;
        }

        .wa-dot:nth-child(3) {
          animation-delay: 0.3s;
        }

        @keyframes wa-bounce {
          0%, 80%, 100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          40% {
            transform: translateY(-3px);
            opacity: 1;
          }
        }

        .wa-form {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          padding: 10px 12px;
          border-top: 1px solid rgba(148, 163, 184, 0.25);
          background: #fff;
        }

        .wa-input {
          resize: none;
          min-height: 40px;
          max-height: 110px;
          border-radius: 10px;
          border: 1px solid rgba(148, 163, 184, 0.7);
          padding: 9px 10px;
          font: inherit;
          color: inherit;
          background: #fff;
        }

        .wa-input:focus-visible {
          outline: 2px solid #2563eb;
          outline-offset: 1px;
        }

        .wa-send {
          border: 0;
          border-radius: 10px;
          background: #2563eb;
          color: #fff;
          cursor: pointer;
          font-weight: 600;
          width: 72px;
        }

        .wa-send[disabled],
        .wa-input[disabled] {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .wa-footer {
          display: flex;
          justify-content: center;
          align-items: center;
          font-size: 11px;
          padding: 8px;
          border-top: 1px solid rgba(148, 163, 184, 0.2);
          background: #f8fafc;
        }

        .wa-footer a {
          color: #334155;
          text-decoration: none;
        }

        .wa-footer a:hover {
          text-decoration: underline;
        }

        .wa-live-region,
        .wa-sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          border: 0;
          padding: 0;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
        }

        @media (max-width: 479px) {
          .wa-root {
            right: 0;
            bottom: 0;
          }

          .wa-panel {
            width: 100vw;
            height: 100vh;
            right: 0;
            bottom: 0;
            border-radius: 0;
          }

          .wa-bubble {
            margin: 12px;
          }
        }

        @media (prefers-color-scheme: dark) {
          .wa-panel,
          .wa-messages,
          .wa-form,
          .wa-input {
            background: #0f172a;
            color: #e2e8f0;
            border-color: rgba(100, 116, 139, 0.45);
          }

          .wa-header,
          .wa-footer {
            background: #111827;
            color: #e2e8f0;
            border-color: rgba(100, 116, 139, 0.35);
          }

          .wa-msg {
            background: #1e293b;
            color: #e2e8f0;
          }

          .wa-msg code {
            background: rgba(148, 163, 184, 0.22);
          }

          .wa-msg pre {
            background: rgba(15, 23, 42, 0.65);
          }

          .wa-visitor .wa-msg {
            background: #2563eb;
            color: #fff;
          }

          .wa-footer a {
            color: #cbd5e1;
          }

          .wa-banner[data-kind='warning'] {
            color: #fcd34d;
            background: #422006;
          }

          .wa-banner[data-kind='error'] {
            color: #fecaca;
            background: #450a0a;
          }

          .wa-esc-modal {
            background: #1e293b;
            border-color: rgba(100, 116, 139, 0.45);
          }

          .wa-esc-field {
            background: #0f172a;
            color: #e2e8f0;
            border-color: rgba(100, 116, 139, 0.5);
          }
        }

        /* ─── Escalation modal ──────────────────────────────── */

        .wa-esc-open {
          background: none;
          border: 0;
          cursor: pointer;
          font-size: 11px;
          color: #64748b;
          padding: 0 4px;
          margin-left: 8px;
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        .wa-esc-open:hover {
          color: #2563eb;
        }

        .wa-esc-overlay {
          display: none;
          position: absolute;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          z-index: 10;
          border-radius: 16px;
        }

        .wa-esc-modal {
          display: none;
          position: absolute;
          inset: 12px;
          background: #fff;
          border-radius: 12px;
          border: 1px solid rgba(148, 163, 184, 0.4);
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
          z-index: 11;
          flex-direction: column;
          overflow: hidden;
        }

        .wa-esc-overlay[data-open='true'],
        .wa-esc-modal[data-open='true'] {
          display: flex;
        }

        .wa-esc-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.25);
          background: #f8fafc;
          font-size: 14px;
          font-weight: 650;
        }

        .wa-esc-close {
          background: none;
          border: 0;
          cursor: pointer;
          font-size: 15px;
          color: inherit;
          width: 28px;
          height: 28px;
          border-radius: 6px;
        }

        .wa-esc-close:focus-visible {
          outline: 2px solid #2563eb;
        }

        .wa-esc-body {
          padding: 12px 14px;
          overflow-y: auto;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 10px;
          font-size: 13px;
        }

        .wa-esc-desc {
          margin: 0;
          color: #64748b;
          font-size: 12px;
        }

        .wa-esc-label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          font-weight: 600;
        }

        .wa-esc-field {
          border-radius: 8px;
          border: 1px solid rgba(148, 163, 184, 0.7);
          padding: 7px 9px;
          font: inherit;
          color: inherit;
          background: #fff;
          font-size: 13px;
        }

        .wa-esc-field:focus-visible {
          outline: 2px solid #2563eb;
          outline-offset: 1px;
        }

        .wa-esc-transcript {
          font-size: 11px;
          color: #64748b;
          border: 1px solid rgba(148, 163, 184, 0.35);
          border-radius: 8px;
          padding: 6px 8px;
          max-height: 80px;
          overflow-y: auto;
        }

        .wa-esc-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 10px 14px;
          border-top: 1px solid rgba(148, 163, 184, 0.25);
          background: #f8fafc;
        }

        .wa-esc-btn {
          border: 0;
          border-radius: 8px;
          padding: 7px 14px;
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        .wa-esc-btn-cancel {
          background: #e2e8f0;
          color: #334155;
        }

        .wa-esc-btn-submit {
          background: #2563eb;
          color: #fff;
        }

        .wa-esc-btn[disabled] {
          opacity: 0.6;
          cursor: not-allowed;
        }
      </style>

      <div class="wa-root">
        <button class="wa-bubble" type="button" aria-label="Toggle chat" aria-expanded="false">
          <span aria-hidden="true">💬</span>
          <span class="wa-badge" data-visible="false" aria-label="Unread messages">0</span>
        </button>

        <section class="wa-panel" data-open="false" role="dialog" aria-label="Website chat assistant" aria-modal="false">
          <header class="wa-header">
            <h2 class="wa-title">${this.escapeHtml(this.config.title)}</h2>
            <button class="wa-close" type="button" aria-label="Close chat">✕</button>
          </header>
          <div class="wa-banner" data-visible="false" data-kind="info" role="status" aria-live="polite"></div>
          <div class="wa-messages" aria-label="Conversation messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
          <div class="wa-typing" data-visible="false" aria-label="Agent is typing" aria-live="polite">
            <span class="wa-dot"></span>
            <span class="wa-dot"></span>
            <span class="wa-dot"></span>
          </div>
          <form class="wa-form">
            <label for="${inputId}" class="wa-sr-only">Message input</label>
            <textarea id="${inputId}" class="wa-input" rows="2" aria-label="Type message"></textarea>
            <button class="wa-send" type="submit" aria-label="Send message">Send</button>
          </form>
          <div class="wa-footer">
            <a href="https://github.com/OpenCodeEngineer/webagent" target="_blank" rel="noopener noreferrer">Powered by WebAgent</a>
            <button type="button" class="wa-esc-open" aria-label="Contact support">Contact support</button>
          </div>
          <div class="wa-live-region" aria-live="polite" aria-atomic="true"></div>

          <!-- Escalation modal (rendered inside shadow DOM) -->
          <div class="wa-esc-overlay" data-open="false" aria-hidden="true"></div>
          <div class="wa-esc-modal" data-open="false" role="dialog" aria-modal="true" aria-label="Contact support">
            <div class="wa-esc-header">
              <span>Contact Support</span>
              <button type="button" class="wa-esc-close" aria-label="Close contact support">✕</button>
            </div>
            <form class="wa-esc-form">
              <div class="wa-esc-body">
                <p class="wa-esc-desc">We'll send your chat transcript to our support team who will follow up via email.</p>
                <label class="wa-esc-label">
                  Email *
                  <input type="email" class="wa-esc-field wa-esc-email" required placeholder="your@email.com" />
                </label>
                <label class="wa-esc-label">
                  Name
                  <input type="text" class="wa-esc-field wa-esc-name" placeholder="Your name" />
                </label>
                <label class="wa-esc-label">
                  Additional context
                  <textarea class="wa-esc-field wa-esc-context" rows="2" placeholder="Anything else we should know?"></textarea>
                </label>
              </div>
              <div class="wa-esc-footer">
                <button type="button" class="wa-esc-btn wa-esc-btn-cancel wa-esc-close">Cancel</button>
                <button type="submit" class="wa-esc-btn wa-esc-btn-submit wa-esc-submit">Send to Support</button>
              </div>
            </form>
          </div>
        </section>
      </div>
    `;
  }
}

let autoInstance: WebAgentWidget | null = null;

function autoInitFromScript(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const script = WebAgentWidget.resolveScriptTag();
  const agentToken = script?.getAttribute('data-agent-token')?.trim() ?? '';
  const userId = script?.getAttribute('data-user-id')?.trim() ?? '';

  if (!agentToken || !userId || autoInstance) {
    return;
  }

  autoInstance = new WebAgentWidget({
    agentToken,
    userId,
    serverUrl: WebAgentWidget.deriveWsUrl(script),
  });
  autoInstance.mount();
}

autoInitFromScript();

export { WebAgentWidget };
