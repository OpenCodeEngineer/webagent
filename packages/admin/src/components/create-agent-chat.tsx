"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Bot, SendHorizontal, Copy, Check } from "lucide-react";
import { createAgentViaMetaAgent, type MetaAgentMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export function CreateAgentChat({ customerId }: { customerId?: string }) {
  const [messages, setMessages] = useState<MetaAgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [embedCode, setEmbedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const initSession = async () => {
      setLoading(true);
      try {
        const result = await createAgentViaMetaAgent([], undefined, customerId);
        const greeting = result.response ?? result.message ?? "";
        const nextSessionId = result.sessionId ?? result.session?.id;
        if (greeting) {
          setMessages([{ role: "assistant", content: greeting }]);
        }
        setSessionId(nextSessionId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to connect";
        setMessages([{ role: "assistant", content: `⚠️ ${msg}. Please refresh to try again.` }]);
      } finally {
        setLoading(false);
      }
    };

    void initSession();
  }, [customerId]);

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setCopied(false);
    const userMessage: MetaAgentMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const result = await createAgentViaMetaAgent([userMessage], sessionId, customerId);
      const assistantReply = result.response ?? result.message ?? "";
      const nextSessionId = result.sessionId ?? result.session?.id ?? sessionId;
      const nextEmbedCode = result.embedCode ?? result.agent?.embedCode ?? "";
      const embedInReply = assistantReply.match(/<script[^>]*data-agent-token[^>]*><\/script>/)?.[0];

      if (assistantReply) {
        setMessages((prev) => [...prev, { role: "assistant", content: assistantReply }]);
      }
      if (nextEmbedCode) setEmbedCode(nextEmbedCode);
      else if (embedInReply) setEmbedCode(embedInReply);
      setSessionId(nextSessionId);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: error instanceof Error ? error.message : "Something went wrong." },
      ]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [input, loading, sessionId, customerId]);

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
              disabled={loading}
              rows={1}
            />
            <button
              type="button"
              onClick={() => void onSend()}
              disabled={loading || input.trim().length === 0}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors",
                loading || input.trim().length === 0
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
