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

  // Read optional user-token-key: tells the widget which localStorage key holds the API token.
  // The embedding page sets  data-user-token-key="oc_access_token"  (or any key name).
  const userTokenKey = activeScript?.getAttribute('data-user-token-key')?.trim();
  const userToken = userTokenKey ? (win.localStorage?.getItem(userTokenKey)?.trim() ?? '') : '';

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
      .lamoom-shell { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; font-family: Inter,system-ui,-apple-system,Segoe UI,sans-serif; color: #ececec; }
      .lamoom-bubble { position: fixed; right: 60px; bottom: 60px; width: 52px; height: 52px; border: 0; border-radius: 999px; background: #ececec; color: #0d0d0d; box-shadow: 0 4px 16px rgba(0,0,0,.4); cursor: pointer; pointer-events: auto; display: flex; align-items: center; justify-content: center; transform: scale(0); animation: lamoom-scale-in .28s ease-out forwards; transition: background .15s; }
      .lamoom-bubble:hover { background: #fff; }
      .lamoom-panel { position: fixed; right: 24px; bottom: 124px; width: 380px; height: 520px; background: #0d0d0d; border: 1px solid #2f2f2f; border-radius: 16px; box-shadow: 0 24px 64px rgba(0,0,0,.7); pointer-events: auto; display: flex; flex-direction: column; overflow: hidden; }
      .lamoom-hidden { display: none; }
      .lamoom-header { height: 52px; background: #171717; border-bottom: 1px solid #2f2f2f; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; }
      .lamoom-title { font-size: 14px; font-weight: 600; color: #ececec; }
      .lamoom-close { border: 0; background: transparent; color: #595959; font-size: 20px; line-height: 1; cursor: pointer; transition: color .15s; }
      .lamoom-close:hover { color: #cdcdcd; }
      .lamoom-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; background: #0d0d0d; }
      .lamoom-message { max-width: 85%; padding: 10px 14px; border-radius: 18px; font-size: 14px; line-height: 1.5; word-wrap: break-word; }
      .lamoom-assistant { align-self: flex-start; background: #212121; color: #d1d5db; border-bottom-left-radius: 4px; }
      .lamoom-assistant a { color: #fff; text-decoration: underline; font-weight: 500; }
      .lamoom-assistant a:hover { color: #cdcdcd; }
      .lamoom-inline-code { background: #424242; padding: 2px 6px; border-radius: 5px; font-family: 'Roboto Mono','SF Mono',Monaco,Consolas,monospace; font-size: 0.875em; font-weight: 600; color: #fff; }
      .lamoom-code-block { background: #171717; border: 1px solid #2f2f2f; border-radius: 12px; padding: 12px 14px; overflow-x: auto; font-family: 'Roboto Mono','SF Mono',Monaco,Consolas,monospace; font-size: 0.85em; margin: 8px 0; white-space: pre-wrap; color: #ececec; }
      .lamoom-code-block code { background: none; padding: 0; }
      .lamoom-assistant ul, .lamoom-assistant ol { margin: 6px 0; padding-left: 20px; }
      .lamoom-assistant li { margin: 3px 0; }
      .lamoom-assistant li::marker { color: #4b5563; }
      .lamoom-assistant strong { color: #fff; }
      .lamoom-heading { display: block; margin: 10px 0 4px; font-size: 1.05em; color: #fff; }
      .lamoom-assistant p { margin: 4px 0; }
      .lamoom-user { align-self: flex-end; background: #2f2f2f; color: #ececec; border-bottom-right-radius: 4px; }
      .lamoom-error { background: #371717; color: #fca5a5; border: 1px solid #4b1c1c; }
      .lamoom-input { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #2f2f2f; background: #171717; align-items: flex-end; }
      .lamoom-textarea { flex: 1; min-height: 40px; max-height: 94px; resize: none; border: 1px solid #2f2f2f; border-radius: 24px; padding: 10px 14px; font: inherit; font-size: 14px; color: #ececec; background: #0d0d0d; outline: none; transition: border-color .15s; }
      .lamoom-textarea::placeholder { color: rgba(255,255,255,.35); }
      .lamoom-textarea:focus { border-color: #424242; }
      .lamoom-send { width: 36px; height: 36px; min-width: 36px; border: 0; border-radius: 999px; background: #ececec; color: #0d0d0d; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .15s; padding: 0; }
      .lamoom-send:hover { background: #fff; }
      .lamoom-send:disabled { opacity: .1; cursor: not-allowed; }
      .lamoom-typing { align-self: flex-start; padding: 8px 14px; background: #212121; border-radius: 18px; border-bottom-left-radius: 4px; display: inline-flex; gap: 6px; }
      .lamoom-dot { width: 6px; height: 6px; border-radius: 999px; background: #595959; animation: lamoom-bounce 1s infinite ease-in-out; }
      .lamoom-dot:nth-child(2) { animation-delay: .12s; }
      .lamoom-dot:nth-child(3) { animation-delay: .24s; }
      @keyframes lamoom-bounce { 0%,80%,100% { transform: translateY(0); opacity: .5; } 40% { transform: translateY(-4px); opacity: 1; } }
      .lamoom-h1 { font-size: 1.2em; margin: 12px 0 4px; }
      .lamoom-h2 { font-size: 1.1em; margin: 10px 0 4px; }
      .lamoom-blockquote { border-left: 3px solid #424242; margin: 6px 0; padding: 4px 10px; color: #a0a0a0; font-style: italic; }
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
          <button class="lamoom-send" type="button" aria-label="Send">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
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

    // --- Code blocks (extract first so nothing inside gets processed) ---
    const codeBlocks: Array<{ token: string; html: string }> = [];
    // Strip optional language label (e.g. ```json) from the code content
    escaped = escaped.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)(?:```|$)/g, (_match, _lang: string, code: string) => {
      const token = `@@LAMBLK${codeBlocks.length}@@`;
      codeBlocks.push({
        token,
        html: `<pre class="lamoom-code-block"><code>${code.replace(/\n$/, '')}</code></pre>`,
      });
      return token;
    });

    // --- Inline code ---
    const inlineCodes: Array<{ token: string; html: string }> = [];
    escaped = escaped.replace(/`([^`\n]+?)`/g, (_match, code: string) => {
      const token = `@@LAMINC${inlineCodes.length}@@`;
      inlineCodes.push({
        token,
        html: `<code class="lamoom-inline-code">${code}</code>`,
      });
      return token;
    });

    // --- Links ---
    escaped = escaped.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, text: string, url: string) => {
      if (!/^(https?:\/\/|mailto:)/i.test(url)) return text;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

    // --- Bold / italic — restricted to single line to avoid streaming artefacts ---
    escaped = escaped.replace(/(\*\*|__)([^\n*_]+?)\1/g, '<strong>$2</strong>');
    escaped = escaped.replace(/(\*|_)([^\n*_]+?)\1/g, '<em>$2</em>');

    // --- Block-level rendering ---
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

          // Code block token (pass through)
          if (/^@@LAMBLK\d+@@$/.test(trimmed)) {
            flushText();
            flushList();
            parts.push(trimmed);
            continue;
          }

          // Headings: # through ######
          const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
          if (headingMatch) {
            flushText();
            flushList();
            const level = headingMatch[1]!.length;
            const text = headingMatch[2]!;
            const cls =
              level === 1 ? 'lamoom-heading lamoom-h1' :
              level === 2 ? 'lamoom-heading lamoom-h2' :
              'lamoom-heading';
            parts.push(`<strong class="${cls}">${text}</strong>`);
            continue;
          }

          // Blockquote
          const bqMatch = trimmed.match(/^>\s*(.*)/);
          if (bqMatch) {
            flushText();
            flushList();
            parts.push(`<div class="lamoom-blockquote">${bqMatch[1]}</div>`);
            continue;
          }

          // Unordered list
          const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)$/);
          if (unorderedMatch) {
            flushText();
            if (listType === 'ol') flushList();
            listType = 'ul';
            listItems.push(unorderedMatch[1] ?? '');
            continue;
          }

          // Ordered list
          const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
          if (orderedMatch) {
            flushText();
            if (listType === 'ul') flushList();
            listType = 'ol';
            listItems.push(orderedMatch[1] ?? '');
            continue;
          }

          // Horizontal rule
          if (/^([-*_]){3,}$/.test(trimmed)) {
            flushText();
            flushList();
            parts.push('<hr style="border:none;border-top:1px solid #2f2f2f;margin:8px 0;">');
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
      const authMsg: Record<string, unknown> = { type: 'auth', agentToken, userId };
      if (userToken) {
        authMsg['context'] = { token: userToken };
      }
      socket?.send(JSON.stringify(authMsg));
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
