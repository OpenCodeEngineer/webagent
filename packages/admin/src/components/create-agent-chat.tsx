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
    <div className="flex h-full flex-col">
      {/* Messages area — scrollable, centered like ChatGPT */}
      <div className="flex-1 overflow-y-auto">
        {!hasMessages && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-medium text-foreground">Lamoom Agent Builder</h2>
              <p className="text-sm text-muted-foreground max-w-md">
                Describe your website and API — I&apos;ll create a custom AI chat agent and give you embed code.
              </p>
            </div>
          </div>
        )}

        {hasMessages && (
          <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
            {messages.map((message, index) => {
              const isUser = message.role === "user";
              return (
                <div key={`${message.role}-${index}`} className={cn("flex gap-4", isUser && "justify-end")}>
                  {!isUser && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div className={cn(
                    "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                    isUser
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}>
                    {message.content}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="rounded-2xl bg-muted px-4 py-3">
                  <span className="inline-flex gap-1 text-muted-foreground">
                    <span className="animate-bounce text-lg" style={{ animationDelay: "0ms" }}>·</span>
                    <span className="animate-bounce text-lg" style={{ animationDelay: "150ms" }}>·</span>
                    <span className="animate-bounce text-lg" style={{ animationDelay: "300ms" }}>·</span>
                  </span>
                </div>
              </div>
            )}

            {/* Embed code card */}
            {embedCode && (
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Your embed code</span>
                  <button
                    onClick={onCopyEmbedCode}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
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
      </div>

      {/* Input area — fixed at bottom, centered */}
      <div className="border-t border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <div className="flex items-end gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
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
              placeholder="Describe your website and API…"
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-h-[24px] max-h-[120px]"
              disabled={loading}
              rows={1}
            />
            <button
              type="button"
              onClick={() => void onSend()}
              disabled={loading || input.trim().length === 0}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
