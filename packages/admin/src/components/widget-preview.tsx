"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Bot, SendHorizontal, Wifi, WifiOff } from "lucide-react";

type WsMessage = {
  type: string;
  content?: string;
  sessionId?: string;
  agentId?: string;
  done?: boolean;
  error?: string;
};

export function WidgetPreview({ agentToken }: { agentToken: string }) {
  const [messages, setMessages] = useState<{ role: "user" | "bot"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const partialRef = useRef("");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setConnecting(true);

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "auth",
        agentToken,
        userId: `preview-${Date.now()}`,
      }));
    };

    ws.onmessage = (ev) => {
      const msg: WsMessage = JSON.parse(ev.data);

      if (msg.type === "auth_ok") {
        setConnected(true);
        setConnecting(false);
        return;
      }

      if (msg.type === "error") {
        setMessages((prev) => [...prev, { role: "bot", content: `⚠️ ${msg.error ?? msg.content ?? "Error"}` }]);
        setStreaming(false);
        return;
      }

      if (msg.type === "message") {
        if (msg.done) {
          const final = msg.content || partialRef.current;
          partialRef.current = "";
          setStreaming(false);
          if (final) {
            setMessages((prev) => {
              const filtered = prev.filter((m) => m.content !== "__streaming__");
              return [...filtered, { role: "bot", content: final }];
            });
          }
        } else if (msg.content) {
          partialRef.current += msg.content;
          setStreaming(true);
        }
      }
    };

    ws.onerror = () => {
      setConnecting(false);
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
      setConnecting(false);
      wsRef.current = null;
    };

    return () => {
      ws.close();
    };
  }, [agentToken]);

  useEffect(() => {
    const cleanup = connect();
    return cleanup;
  }, [connect]);

  const send = () => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || streaming) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setStreaming(true);
    wsRef.current.send(JSON.stringify({ type: "message", content: text }));
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col rounded-xl border border-zinc-700 bg-[#1a1a1a] overflow-hidden" style={{ height: 420 }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-300">Widget Preview</span>
        </div>
        <div className="flex items-center gap-1.5">
          {connected ? (
            <Wifi className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-zinc-500" />
          )}
          <span className="text-xs text-zinc-500">
            {connected ? "Connected" : connecting ? "Connecting…" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-500">
              {connected ? "Send a message to test your agent" : "Connecting to agent…"}
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                msg.role === "user"
                  ? "max-w-[80%] rounded-2xl bg-zinc-700 px-3 py-2 text-sm text-zinc-100"
                  : "max-w-[80%] rounded-2xl bg-zinc-800 px-3 py-2 text-sm text-zinc-200"
              }
            >
              {msg.content}
            </div>
          </div>
        ))}

        {streaming && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-zinc-800 px-3 py-2 text-sm text-zinc-400">
              {partialRef.current || (
                <span className="inline-flex gap-0.5">
                  <span className="animate-bounce" style={{ animationDelay: "0ms" }}>·</span>
                  <span className="animate-bounce" style={{ animationDelay: "150ms" }}>·</span>
                  <span className="animate-bounce" style={{ animationDelay: "300ms" }}>·</span>
                </span>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-xl bg-zinc-800 px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            placeholder={connected ? "Type a message…" : "Connecting…"}
            disabled={!connected || streaming}
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-500 outline-none"
          />
          <button
            onClick={send}
            disabled={!connected || streaming || !input.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-600 text-zinc-300 transition-colors hover:bg-zinc-500 disabled:opacity-40"
          >
            <SendHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
