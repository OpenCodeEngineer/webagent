(() => {
  interface LamoomWebSocket {
    readyState: number;
    onopen: (() => void) | null;
    onmessage: ((event: { data?: unknown }) => void) | null;
    onclose: (() => void) | null;
    onerror: (() => void) | null;
    send: (data: string) => void;
    close: () => void;
  }

  const win = globalThis as Record<string, unknown> & {
    document?: unknown;
    localStorage?: {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
    };
    crypto?: { randomUUID?: () => string };
    WebSocket?: new (url: string) => LamoomWebSocket;
    setTimeout?: (handler: () => void, timeout?: number) => unknown;
    clearTimeout?: (id: unknown) => void;
    __lamoomWidgetLoaded?: boolean;
  };

  const doc = win.document as
    | {
        body?: { appendChild: (node: unknown) => void };
        currentScript?: unknown;
        createElement: (tag: string) => any;
        querySelector: (selector: string) => unknown;
      }
    | undefined;
  if (!doc?.body || win.__lamoomWidgetLoaded) return;
  win.__lamoomWidgetLoaded = true;

  const activeScript = (doc.currentScript ?? doc.querySelector('script[data-agent-token]')) as
    | { getAttribute: (name: string) => string | null; src?: string }
    | undefined;
  const agentToken = activeScript?.getAttribute('data-agent-token')?.trim();
  if (!agentToken) return;

  const userId = (() => {
    const existing = win.localStorage?.getItem('lamoom_uid')?.trim();
    if (existing) return existing;
    const generated =
      win.crypto?.randomUUID?.() ??
      `uid-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    win.localStorage?.setItem('lamoom_uid', generated);
    return generated;
  })();

  const host = doc.createElement('div');
  host.className = 'lamoom-root-host';
  if (host.style) host.style.cssText = 'all: initial;';
  doc.body.appendChild(host);

  const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  const wrapper = doc.createElement('div');
  wrapper.innerHTML = `
    <style>
      .lamoom-shell { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; font-family: Inter,system-ui,-apple-system,Segoe UI,sans-serif; color: #e5e7eb; }
      .lamoom-bubble { position: fixed; right: 60px; bottom: 60px; width: 60px; height: 60px; border: 0; border-radius: 999px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; box-shadow: 0 12px 32px rgba(37,99,235,.45); cursor: pointer; pointer-events: auto; display: flex; align-items: center; justify-content: center; transform: scale(0); animation: lamoom-scale-in .28s ease-out forwards; }
      .lamoom-panel { position: fixed; right: 24px; bottom: 132px; width: 380px; height: 520px; background: #1a1a2e; border: 1px solid #1e293b; border-radius: 16px; box-shadow: 0 24px 64px rgba(2,6,23,.65); pointer-events: auto; display: flex; flex-direction: column; overflow: hidden; }
      .lamoom-hidden { display: none; }
      .lamoom-header { height: 56px; background: #111827; border-bottom: 1px solid #1f2937; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; }
      .lamoom-title { font-size: 14px; font-weight: 600; color: #f9fafb; }
      .lamoom-close { border: 0; background: transparent; color: #94a3b8; font-size: 20px; line-height: 1; cursor: pointer; }
      .lamoom-messages { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; background: #020617; }
      .lamoom-message { max-width: 82%; padding: 10px 12px; border-radius: 14px; font-size: 14px; line-height: 1.35; word-wrap: break-word; }
      .lamoom-assistant { align-self: flex-start; background: #1f2937; color: #e5e7eb; border-bottom-left-radius: 4px; }
      .lamoom-assistant a { color: #60a5fa; text-decoration: underline; }
      .lamoom-assistant a:hover { color: #93c5fd; }
      .lamoom-inline-code { background: #374151; padding: 1px 5px; border-radius: 4px; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 0.9em; }
      .lamoom-code-block { background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 10px 12px; overflow-x: auto; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 0.85em; margin: 6px 0; white-space: pre-wrap; }
      .lamoom-code-block code { background: none; padding: 0; }
      .lamoom-assistant ul, .lamoom-assistant ol { margin: 4px 0; padding-left: 20px; }
      .lamoom-assistant li { margin: 2px 0; }
      .lamoom-assistant strong { color: #f9fafb; }
      .lamoom-heading { display: block; margin: 8px 0 4px; font-size: 1.05em; }
      .lamoom-assistant p { margin: 4px 0; }
      .lamoom-user { align-self: flex-end; background: #2563eb; color: #fff; border-bottom-right-radius: 4px; }
      .lamoom-error { background: #7f1d1d; color: #fee2e2; }
      .lamoom-input { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #1f2937; background: #1a1a2e; }
      .lamoom-textarea { flex: 1; min-height: 40px; max-height: 94px; resize: none; border: 1px solid #334155; border-radius: 10px; padding: 10px 11px; font: inherit; color: #f8fafc; background: #111827; outline: none; }
      .lamoom-textarea:focus { border-color: #3b82f6; }
      .lamoom-send { min-width: 68px; border: 0; border-radius: 10px; background: #2563eb; color: #fff; font-weight: 600; cursor: pointer; }
      .lamoom-send:disabled { opacity: .65; cursor: not-allowed; }
      .lamoom-typing { align-self: flex-start; padding: 8px 12px; background: #1f2937; border-radius: 14px; border-bottom-left-radius: 4px; display: inline-flex; gap: 6px; }
      .lamoom-dot { width: 6px; height: 6px; border-radius: 999px; background: #cbd5e1; animation: lamoom-bounce 1s infinite ease-in-out; }
      .lamoom-dot:nth-child(2) { animation-delay: .12s; }
      .lamoom-dot:nth-child(3) { animation-delay: .24s; }
      @keyframes lamoom-bounce { 0%,80%,100% { transform: translateY(0); opacity: .5; } 40% { transform: translateY(-4px); opacity: 1; } }
      @keyframes lamoom-scale-in { from { transform: scale(0); } to { transform: scale(1); } }
      @media (max-width: 480px) {
        .lamoom-bubble { right: 16px; bottom: 16px; }
        .lamoom-panel { right: 8px; left: 8px; bottom: 8px; width: auto; height: calc(100vh - 16px); border-radius: 14px; }
      }
    </style>
    <div class="lamoom-shell">
      <button class="lamoom-bubble" aria-label="Open chat">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 7.2C6 5.43 7.43 4 9.2 4h5.6C16.57 4 18 5.43 18 7.2v4.6c0 1.77-1.43 3.2-3.2 3.2H12l-3.4 3.2V15H9.2C7.43 15 6 13.57 6 11.8V7.2Z" fill="currentColor"/>
        </svg>
      </button>
      <section class="lamoom-panel lamoom-hidden" aria-live="polite">
        <header class="lamoom-header">
          <div class="lamoom-title">Chat with us</div>
          <button class="lamoom-close" aria-label="Close chat">×</button>
        </header>
        <div class="lamoom-messages"></div>
        <div class="lamoom-input">
          <textarea class="lamoom-textarea" rows="1" placeholder="Type a message..."></textarea>
          <button class="lamoom-send" type="button">Send</button>
        </div>
      </section>
    </div>
  `;
  root.appendChild(wrapper);

  const find = <T>(selector: string): T => wrapper.querySelector(selector) as T;
  const bubble = find<{ addEventListener: (e: string, cb: () => void) => void }>('.lamoom-bubble');
  const panel = find<{ classList: { add: (c: string) => void; remove: (c: string) => void } }>('.lamoom-panel');
  const closeBtn = find<{ addEventListener: (e: string, cb: () => void) => void }>('.lamoom-close');
  const messages = find<{ appendChild: (n: unknown) => void; scrollTop: number; scrollHeight: number }>('.lamoom-messages');
  const textarea = find<{
    value: string;
    addEventListener: (e: string, cb: (event: { key?: string; shiftKey?: boolean; preventDefault: () => void }) => void) => void;
  }>('.lamoom-textarea');
  const sendButton = find<{
    addEventListener: (e: string, cb: () => void) => void;
    disabled: boolean;
  }>('.lamoom-send');

  let socket: LamoomWebSocket | null = null;
  let socketAuthenticated = false;
  let retryCount = 0;
  let retryTimer: unknown = null;
  let panelOpen = false;
  let manualClose = false;
  let typingNode: { remove: () => void } | null = null;
  type MessageNode = { textContent: string | null; innerHTML: string };
  let streamingAssistantNode: MessageNode | null = null;
  let streamingRawText = '';
  const pendingMessages: string[] = [];

  const scrollToBottom = (): void => {
    messages.scrollTop = messages.scrollHeight;
  };

  const renderMarkdown = (raw: string): string => {
    const escapeHtml = (input: string): string =>
      input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const applyTokens = (input: string, replacements: Array<{ token: string; html: string }>): string =>
      replacements.reduce((output, replacement) => output.split(replacement.token).join(replacement.html), input);

    let escaped = escapeHtml(raw);
    const codeBlocks: Array<{ token: string; html: string }> = [];
    escaped = escaped.replace(/```([\s\S]*?)(?:```|$)/g, (_match, code: string) => {
      const token = `@@LAMOOM_CODE_BLOCK_${codeBlocks.length}@@`;
      codeBlocks.push({
        token,
        html: `<pre class="lamoom-code-block"><code>${code}</code></pre>`,
      });
      return token;
    });

    const inlineCodes: Array<{ token: string; html: string }> = [];
    escaped = escaped.replace(/`([^`\n]+?)`/g, (_match, code: string) => {
      const token = `@@LAMOOM_INLINE_CODE_${inlineCodes.length}@@`;
      inlineCodes.push({
        token,
        html: `<code class="lamoom-inline-code">${code}</code>`,
      });
      return token;
    });

    escaped = escaped.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, text: string, url: string) => {
      if (!/^(https?:\/\/|mailto:)/i.test(url)) return text;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });
    escaped = escaped.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
    escaped = escaped.replace(/(\*|_)(?=\S)([\s\S]*?\S)\1/g, '<em>$2</em>');

    const paragraphHtml = escaped
      .split(/\n{2,}/)
      .map((paragraph) => {
        const lines = paragraph.split('\n');
        const parts: string[] = [];
        const textLines: string[] = [];
        let listType: 'ul' | 'ol' | null = null;
        let listItems: string[] = [];
        const flushText = (): void => {
          if (textLines.length === 0) return;
          parts.push(`<p>${textLines.join('<br>')}</p>`);
          textLines.length = 0;
        };
        const flushList = (): void => {
          if (!listType || listItems.length === 0) return;
          parts.push(`<${listType}>${listItems.map((item) => `<li>${item}</li>`).join('')}</${listType}>`);
          listType = null;
          listItems = [];
        };

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            flushText();
            flushList();
            continue;
          }
          if (/^@@LAMOOM_CODE_BLOCK_\d+@@$/.test(trimmed)) {
            flushText();
            flushList();
            parts.push(trimmed);
            continue;
          }
          const headingMatch = trimmed.match(/^###\s+(.+)$/);
          if (headingMatch) {
            flushText();
            flushList();
            parts.push(`<strong class="lamoom-heading">${headingMatch[1]}</strong>`);
            continue;
          }
          const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
          if (unorderedMatch) {
            flushText();
            if (listType === 'ol') flushList();
            listType = 'ul';
            listItems.push(unorderedMatch[1] ?? '');
            continue;
          }
          const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
          if (orderedMatch) {
            flushText();
            if (listType === 'ul') flushList();
            listType = 'ol';
            listItems.push(orderedMatch[1] ?? '');
            continue;
          }
          flushList();
          textLines.push(line);
        }
        flushText();
        flushList();
        return parts.join('');
      })
      .join('');

    return applyTokens(applyTokens(paragraphHtml, inlineCodes), codeBlocks);
  };

  const createMessage = (
    text: string,
    role: 'assistant' | 'user',
    isError = false,
  ): MessageNode => {
    const node = doc.createElement('div');
    node.className = `lamoom-message ${role === 'user' ? 'lamoom-user' : 'lamoom-assistant'}${
      isError ? ' lamoom-error' : ''
    }`;
    if (role === 'assistant') {
      node.innerHTML = renderMarkdown(text);
    } else {
      node.textContent = text;
    }
    messages.appendChild(node);
    scrollToBottom();
    return node as MessageNode;
  };

  const appendAssistantStream = (delta: string): void => {
    if (!delta) return;
    if (!streamingAssistantNode) {
      streamingAssistantNode = createMessage('', 'assistant');
    }
    streamingRawText += delta;
    streamingAssistantNode.innerHTML = renderMarkdown(streamingRawText);
    scrollToBottom();
  };

  const finishAssistantStream = (finalText: string): void => {
    const normalizedFinal = finalText.trim();
    if (streamingAssistantNode) {
      const resolvedText = normalizedFinal ? finalText : streamingRawText;
      if (resolvedText) streamingAssistantNode.innerHTML = renderMarkdown(resolvedText);
      streamingAssistantNode = null;
      streamingRawText = '';
      return;
    }
    if (normalizedFinal) {
      createMessage(finalText, 'assistant');
    }
    streamingRawText = '';
  };

  const resetAssistantStream = (): void => {
    if (streamingAssistantNode) {
      streamingAssistantNode.innerHTML = '';
    }
    streamingAssistantNode = null;
    streamingRawText = '';
  };

  const flushPendingMessages = (): void => {
    if (!socketAuthenticated || !socket || socket.readyState !== 1) return;
    while (pendingMessages.length > 0) {
      const nextMessage = pendingMessages.shift();
      if (!nextMessage) continue;
      socket.send(JSON.stringify({ type: 'message', content: nextMessage }));
    }
  };

  const showTyping = (): void => {
    if (typingNode) return;
    const node = doc.createElement('div');
    node.className = 'lamoom-typing';
    node.innerHTML =
      '<span class="lamoom-dot"></span><span class="lamoom-dot"></span><span class="lamoom-dot"></span>';
    messages.appendChild(node);
    typingNode = node as unknown as { remove: () => void };
    scrollToBottom();
  };

  const hideTyping = (): void => {
    if (!typingNode) return;
    typingNode.remove();
    typingNode = null;
  };

  const openSocket = (): void => {
    if (!panelOpen || !win.WebSocket) return;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;

    manualClose = false;
    socketAuthenticated = false;
    const hostName = (() => {
      try {
        return new URL(activeScript?.src ?? '').host;
      } catch {
        return '';
      }
    })();
    if (!hostName) {
      createMessage('Widget host URL is invalid.', 'assistant', true);
      return;
    }

    socket = new win.WebSocket(
      `wss://${hostName}/ws?token=${encodeURIComponent(agentToken)}&userId=${encodeURIComponent(userId)}`,
    );

    socket.onopen = () => {
      retryCount = 0;
      sendButton.disabled = false;
      socket?.send(
        JSON.stringify({
          type: 'auth',
          agentToken,
          userId,
        }),
      );
    };

    socket.onmessage = (event: { data?: unknown }) => {
      hideTyping();
      let message:
        | {
            type?: string;
            content?: string;
            message?: string;
            reason?: string;
            done?: boolean;
          }
        | null = null;
      try {
        message = JSON.parse(String(event.data ?? ''));
      } catch {
        message = null;
      }
      if (!message) return;
      if (message.type === 'auth_ok') {
        socketAuthenticated = true;
        flushPendingMessages();
        return;
      }
      if (message.type === 'message') {
        const text = message.content ?? message.message ?? '';
        if (message.done === true) {
          finishAssistantStream(text);
        } else if (text) {
          appendAssistantStream(text);
        }
      }
      if (message.type === 'error') {
        resetAssistantStream();
        const errorText = message.content ?? message.message;
        if (errorText) createMessage(errorText, 'assistant', true);
      }
      if (message.type === 'auth_error') {
        socketAuthenticated = false;
        pendingMessages.length = 0;
        resetAssistantStream();
        createMessage(
          `⚠️ Connection failed: ${message.message || message.reason || 'Authentication error'}`,
          'assistant',
          true,
        );
        manualClose = true;
        socket?.close();
        return;
      }
    };

    socket.onerror = () => undefined;

    socket.onclose = () => {
      socket = null;
      socketAuthenticated = false;
      sendButton.disabled = false;
      if (manualClose || !panelOpen) return;
      if (retryCount >= 3) {
        pendingMessages.length = 0;
        hideTyping();
        resetAssistantStream();
        createMessage('Connection lost. Please try again.', 'assistant', true);
        return;
      }
      const delay = 500 * 2 ** retryCount;
      retryCount += 1;
      retryTimer = win.setTimeout?.(() => {
        retryTimer = null;
        openSocket();
      }, delay);
    };
  };

  const sendMessage = (): void => {
    const text = textarea.value.trim();
    if (!text) return;
    createMessage(text, 'user');
    textarea.value = '';
    showTyping();

    const payload = JSON.stringify({ type: 'message', content: text });
    if (socket?.readyState === 1 && socketAuthenticated) {
      socket.send(payload);
      return;
    }

    pendingMessages.push(text);
    openSocket();
  };

  const closePanel = (): void => {
    panelOpen = false;
    panel.classList.add('lamoom-hidden');
    hideTyping();
    resetAssistantStream();
    if (retryTimer && win.clearTimeout) {
      win.clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (socket) {
      manualClose = true;
      socket.close();
      socket = null;
    }
    socketAuthenticated = false;
    pendingMessages.length = 0;
  };

  bubble.addEventListener('click', () => {
    if (panelOpen) {
      closePanel();
      return;
    }
    panelOpen = true;
    panel.classList.remove('lamoom-hidden');
    openSocket();
  });

  closeBtn.addEventListener('click', closePanel);

  sendButton.addEventListener('click', sendMessage);
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
})();
