"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Bot, User, SendHorizontal, Copy, Check } from "lucide-react";
import { createAgentViaMetaAgent, type MetaAgentMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CreateAgentChat({ customerId }: { customerId?: string }) {
  const [messages, setMessages] = useState<MetaAgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [embedCode, setEmbedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [initError, setInitError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // On mount: request meta-agent greeting
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
        setInitError("");
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to connect to agent builder";
        setInitError(msg);
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
      // Send only the latest user message — OpenClaw maintains session state
      const result = await createAgentViaMetaAgent(
        [userMessage],
        sessionId,
        customerId,
      );

      const assistantReply = result.response ?? result.message ?? "";
      const nextSessionId = result.sessionId ?? result.session?.id ?? sessionId;
      const nextEmbedCode = result.embedCode ?? result.agent?.embedCode ?? "";

      // Also detect embed snippet in reply text (matches data-agent-token attribute)
      const embedInReply = assistantReply.match(/<script[^>]*data-agent-token[^>]*><\/script>/)?.[0];

      if (assistantReply) {
        setMessages((prev) => [...prev, { role: "assistant", content: assistantReply }]);
      }

      if (nextEmbedCode) {
        setEmbedCode(nextEmbedCode);
      } else if (embedInReply) {
        setEmbedCode(embedInReply);
      }

      setSessionId(nextSessionId);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "Something went wrong. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId, customerId]);

  const onCopyEmbedCode = async () => {
    if (!embedCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col rounded-xl border border-border bg-card overflow-hidden">
      {/* Message list */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4 pb-2">
          {messages.map((message, index) => {
            const isUser = message.role === "user";
            return (
              <div
                key={`${message.role}-${index}`}
                className={cn("flex items-start gap-3", isUser && "flex-row-reverse")}
              >
                {/* Avatar */}
                <div className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                  {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                </div>
                {/* Bubble */}
                <div
                  className={cn(
                    "max-w-[80%] rounded-lg px-4 py-3 text-sm",
                    isUser
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 border border-border text-foreground"
                  )}
                >
                  {message.content}
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce" style={{ animationDelay: "0ms" }}>·</span>
                  <span className="animate-bounce" style={{ animationDelay: "150ms" }}>·</span>
                  <span className="animate-bounce" style={{ animationDelay: "300ms" }}>·</span>
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Embed code result */}
      {embedCode && (
        <div className="px-4 pb-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Embed Snippet</CardTitle>
                <Button variant="outline" size="sm" onClick={onCopyEmbedCode}>
                  {copied ? (
                    <>
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg bg-zinc-900 p-3">
                <code className="text-emerald-400 font-mono text-xs whitespace-pre">{embedCode}</code>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Input area */}
      <Separator />
      <div className="flex items-end gap-2 p-4">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          placeholder="Type your message…"
          className="min-h-[44px] max-h-[120px] flex-1 resize-none rounded-lg"
          disabled={loading}
          rows={1}
        />
        <Button
          type="button"
          onClick={() => void onSend()}
          disabled={loading || input.trim().length === 0}
          size="icon"
          className="h-11 w-11 shrink-0"
        >
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
