"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Bot, SendHorizontal, Copy, Check } from "lucide-react";
import { type MetaAgentMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const EMBED_CODE_RE = /<script[^>]*data-agent-token[^>]*><\/script>/;
const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

interface CreateAgentChatProps {
  customerId?: string;
  wsToken: string;
}

export function CreateAgentChat({ customerId, wsToken }: CreateAgentChatProps) {
  const [messages, setMessages] = useState<MetaAgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [embedCode, setEmbedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const mountedRef = useRef(true);
  const shouldReconnectRef = useRef(true);
  const authFailureNotifiedRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // --- WebSocket lifecycle ---
  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;

      shouldReconnectRef.current = true;
      const token = wsToken;
      if (!token) {
        shouldReconnectRef.current = false;
        authFailureNotifiedRef.current = true;
        setMessages([{
          role: "assistant",
          content: "⚠️ Missing authentication token. Please check your environment configuration and refresh.",
        }]);
        return;
      }

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.addEventListener("open", () => {
        if (!mountedRef.current) { ws.close(); return; }
        reconnectAttempt.current = 0;
        ws.send(JSON.stringify({
          type: "auth",
          token,
          userId: customerId || "unknown",
          mode: "admin",
        }));
      });

      ws.addEventListener("message", (event) => {
        if (!mountedRef.current) return;

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(event.data as string) as Record<string, unknown>;
        } catch {
          return;
        }

        if (data.type === "auth_ok") {
          authFailureNotifiedRef.current = false;
          setIsAuthed(true);
          return;
        }

        if (data.type === "auth_error") {
          const reason = typeof data.reason === "string" && data.reason.trim().length > 0
            ? data.reason
            : "Authentication failed";
          const fatalAuthError = /(invalid|missing)(?:\s+\w+)?\s+token|token\s+(invalid|missing)/i.test(reason);
          if (fatalAuthError) shouldReconnectRef.current = false;
          setIsAuthed(false);
          if (!authFailureNotifiedRef.current) {
            authFailureNotifiedRef.current = true;
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: `⚠️ ${reason}. Please check your credentials and refresh.` },
            ]);
          }
          ws.close();
          return;
        }

        if (data.type === "error") {
          const errMsg = typeof data.message === "string" ? data.message : "An error occurred";
          setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${errMsg}` }]);
          setLoading(false);
          return;
        }

        if (data.type === "message" && data.done === true) {
          const content = typeof data.content === "string" ? data.content : "";
          if (content) {
            setMessages((prev) => [...prev, { role: "assistant", content }]);
            const embedMatch = content.match(EMBED_CODE_RE)?.[0];
            if (embedMatch) setEmbedCode(embedMatch);
          }
          setLoading(false);
          textareaRef.current?.focus();
        }
      });

      ws.addEventListener("close", () => {
        if (!mountedRef.current) return;
        socketRef.current = null;
        setIsAuthed(false);
        setLoading(false);
        if (shouldReconnectRef.current) {
          scheduleReconnect();
        }
      });

      ws.addEventListener("error", () => {
        // The close event fires after error; reconnect handled there.
      });
    }

    function scheduleReconnect() {
      if (!mountedRef.current) return;
      const delay = Math.min(
        BASE_RECONNECT_MS * Math.pow(2, reconnectAttempt.current),
        MAX_RECONNECT_MS,
      );
      reconnectAttempt.current += 1;
      reconnectTimer.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [customerId, wsToken]);

  // --- Send handler ---
  const onSend = useCallback(() => {
    const text = input.trim();
    if (!text || loading || !isAuthed || !socketRef.current) return;

    setCopied(false);
    const userMessage: MetaAgentMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    socketRef.current.send(JSON.stringify({ type: "message", content: text }));
  }, [input, loading, isAuthed]);

  const onCopyEmbedCode = async () => {
    if (!embedCode) return;
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const hasMessages = messages.length > 0 || loading;

  return (
    <div className="flex h-full flex-col bg-[#171717]">
      {/* Messages area */}
      <div className="relative flex-1 overflow-y-auto">
        {!hasMessages && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800">
                <Bot className="h-7 w-7 text-zinc-400" />
              </div>
              <h2 className="text-xl font-semibold text-zinc-200">How can I help you build your agent?</h2>
              <p className="text-sm text-zinc-500 max-w-md">
                Describe your website and API — I&apos;ll create a custom AI chat agent and give you embed code.
              </p>
            </div>
          </div>
        )}

        {hasMessages && (
          <div className="mx-auto max-w-3xl px-4 py-8 space-y-2">
            {messages.map((message, index) => {
              const isUser = message.role === "user";
              return isUser ? (
                <div key={`${message.role}-${index}`} className="flex justify-end py-2">
                  <div className="max-w-[85%] rounded-2xl bg-zinc-800 px-4 py-3 text-sm text-zinc-100">
                    {message.content}
                  </div>
                </div>
              ) : (
                <div key={`${message.role}-${index}`} className="flex gap-3 py-6">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700 mt-0.5">
                    <Bot className="h-4 w-4 text-zinc-400" />
                  </div>
                  <div className="min-w-0 flex-1 text-base leading-relaxed text-zinc-200 whitespace-pre-wrap">
                    {message.content}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-3 py-6">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700 mt-0.5">
                  <Bot className="h-4 w-4 text-zinc-400" />
                </div>
                <div className="pt-1">
                  <span className="inline-flex gap-1 text-zinc-500">
                    <span className="animate-bounce text-lg" style={{ animationDelay: "0ms" }}>·</span>
                    <span className="animate-bounce text-lg" style={{ animationDelay: "150ms" }}>·</span>
                    <span className="animate-bounce text-lg" style={{ animationDelay: "300ms" }}>·</span>
                  </span>
                </div>
              </div>
            )}

            {embedCode && (
              <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">Embed code</span>
                  <button
                    onClick={onCopyEmbedCode}
                    className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition-colors text-xs"
                  >
                    {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                  </button>
                </div>
                <div className="overflow-x-auto rounded-lg bg-zinc-950 p-3">
                  <code className="text-emerald-400 font-mono text-xs">{embedCode}</code>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}

        {/* Bottom gradient fade */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#171717] to-transparent" />
      </div>

      {/* Input area */}
      <div>
        <div className="mx-auto max-w-3xl px-4 pb-6 pt-2">
          <div className="flex items-end gap-3 rounded-2xl border border-zinc-700 bg-zinc-800 px-4 py-3 focus-within:border-zinc-500 transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
              placeholder="Describe your website..."
              className="flex-1 resize-none bg-transparent text-sm text-zinc-200 placeholder:text-zinc-500 outline-none min-h-[24px] max-h-[120px]"
              disabled={loading || !isAuthed}
              rows={1}
            />
            <button
              type="button"
              onClick={() => void onSend()}
              disabled={loading || !isAuthed || input.trim().length === 0}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors",
                loading || !isAuthed || input.trim().length === 0
                  ? "bg-zinc-600 text-zinc-400"
                  : "bg-white text-black hover:bg-zinc-200"
              )}
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
