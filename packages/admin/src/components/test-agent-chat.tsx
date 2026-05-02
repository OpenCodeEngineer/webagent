"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Bot, SendHorizontal, RotateCcw } from "lucide-react";
import { renderMarkdownToReactNodes } from "@/lib/markdown";
import { cn } from "@/lib/utils";

const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface TestAgentChatProps {
  agentToken: string;
  widgetBaseUrl?: string;
  className?: string;
}

export function TestAgentChat({ agentToken, widgetBaseUrl, className }: TestAgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const mountedRef = useRef(true);
  const shouldReconnectRef = useRef(true);
  const streamingIdRef = useRef<string | null>(null);
  const userIdRef = useRef(`test-${crypto.randomUUID().slice(0, 8)}`);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-resize textarea
  const adjustTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  // --- WebSocket lifecycle ---
  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;
      shouldReconnectRef.current = true;

      const host = widgetBaseUrl
        ? widgetBaseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")
        : window.location.host;
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${wsProtocol}//${host}/ws`;

      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.addEventListener("open", () => {
        if (!mountedRef.current) { ws.close(); return; }
        reconnectAttempt.current = 0;
        // Authenticate as widget user (not admin)
        ws.send(JSON.stringify({
          type: "auth",
          token: agentToken,
          userId: userIdRef.current,
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
          setIsAuthed(true);
          return;
        }

        if (data.type === "history") {
          const rawMessages = Array.isArray(data.messages) ? data.messages : [];
          const parsed: ChatMessage[] = rawMessages
            .map((m) => {
              if (!m || typeof m !== "object") return null;
              const val = m as { role?: unknown; content?: unknown };
              if ((val.role !== "user" && val.role !== "assistant") || typeof val.content !== "string") return null;
              return { role: val.role, content: val.content } as ChatMessage;
            })
            .filter((m): m is ChatMessage => !!m);
          setMessages(parsed);
          return;
        }

        if (data.type === "auth_error") {
          const reason = typeof data.reason === "string" ? data.reason : "Authentication failed";
          shouldReconnectRef.current = false;
          setIsAuthed(false);
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Unable to connect: ${reason}` },
          ]);
          ws.close();
          return;
        }

        if (data.type === "error") {
          const errMsg = typeof data.message === "string" ? data.message : "An error occurred";
          setMessages((prev) => [...prev, { role: "assistant", content: errMsg }]);
          streamingIdRef.current = null;
          setLoading(false);
          return;
        }

        if (data.type === "message" && typeof data.done === "boolean") {
          const content = typeof data.content === "string" ? data.content : "";
          if (!data.done) {
            if (!streamingIdRef.current) {
              streamingIdRef.current = `s-${Date.now()}`;
              setMessages((prev) => [...prev, { role: "assistant", content }]);
            } else {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return [...prev.slice(0, -1), { ...last, content: last.content + content }];
                }
                return prev;
              });
            }
          } else {
            if (streamingIdRef.current) {
              streamingIdRef.current = null;
              if (content) {
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant") {
                    return [...prev.slice(0, -1), { ...last, content: last.content + content }];
                  }
                  return [...prev, { role: "assistant", content }];
                });
              }
            } else if (content) {
              setMessages((prev) => [...prev, { role: "assistant", content }]);
            }
            setLoading(false);
            textareaRef.current?.focus();
          }
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

      ws.addEventListener("error", () => { /* close fires after */ });
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
  }, [agentToken, widgetBaseUrl]);

  // --- Send handler ---
  const onSend = useCallback(() => {
    const text = input.trim();
    if (!text || loading || !isAuthed || !socketRef.current) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    socketRef.current.send(JSON.stringify({ type: "message", content: text }));
  }, [input, loading, isAuthed]);

  // --- Reset conversation ---
  const onReset = useCallback(() => {
    // Generate new user ID to get a fresh session
    userIdRef.current = `test-${crypto.randomUUID().slice(0, 8)}`;
    setMessages([]);
    setLoading(false);
    streamingIdRef.current = null;
    // Reconnect with new userId
    if (socketRef.current) {
      socketRef.current.close();
    }
  }, []);

  const hasMessages = messages.length > 0 || loading;

  return (
    <div className={cn("flex h-full flex-col bg-[#171717]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700">
            <Bot className="h-3.5 w-3.5 text-zinc-300" />
          </div>
          <span className="text-sm font-medium text-zinc-300">Test conversation</span>
          {isAuthed && (
            <span className="h-2 w-2 rounded-full bg-emerald-500" title="Connected" />
          )}
        </div>
        {hasMessages && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title="Reset conversation"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            New chat
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="relative flex-1 overflow-y-auto">
        {!hasMessages && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800">
                <Bot className="h-7 w-7 text-zinc-400" />
              </div>
              <h2 className="text-xl font-semibold text-zinc-200">Test your agent</h2>
              <p className="text-sm text-zinc-500 max-w-md">
                Send a message to see how your agent responds to visitors.
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
                  <div className="max-w-[85%] space-y-2 rounded-2xl bg-zinc-800 px-4 py-3 text-sm text-zinc-100">
                    {renderMarkdownToReactNodes(message.content)}
                  </div>
                </div>
              ) : (
                <div key={`${message.role}-${index}`} className="flex gap-3 py-6">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700 mt-0.5">
                    <Bot className="h-4 w-4 text-zinc-400" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3 text-base leading-relaxed text-zinc-200">
                    {renderMarkdownToReactNodes(message.content)}
                  </div>
                </div>
              );
            })}

            {loading && !streamingIdRef.current && (
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

            <div ref={bottomRef} />
          </div>
        )}

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#171717] to-transparent" />
      </div>

      {/* Input area */}
      <div>
        <div className="mx-auto max-w-3xl px-4 pb-6 pt-2">
          <div className="flex items-end gap-3 rounded-2xl border border-zinc-700 bg-zinc-800 px-4 py-3 focus-within:border-zinc-500 transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                adjustTextarea();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder="Send a message..."
              className="flex-1 resize-none bg-transparent text-sm text-zinc-200 placeholder:text-zinc-500 outline-none min-h-[24px] max-h-[160px]"
              disabled={loading || !isAuthed}
              rows={1}
            />
            <button
              type="button"
              onClick={onSend}
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
