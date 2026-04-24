"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { Bot, User, SendHorizontal, Copy, Check } from "lucide-react";
import { createAgentViaMetaAgent, type MetaAgentMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STAGE_PROMPTS = [
  "Great — tell me about your website and product.",
  "Nice. What API endpoints, auth, or data sources should the agent use?",
  "Got it. What personality and tone should the assistant have?",
  "Perfect. Reply with any final tweaks, or type 'create' to build your agent.",
] as const;

const systemPrompt: MetaAgentMessage = {
  role: "system",
  content:
    "You are helping create a website chat agent. Progress through website/product, API context, personality, then confirm/create. Keep responses short and actionable.",
};

export function CreateAgentChat({ customerId }: { customerId?: string }) {
  const [messages, setMessages] = useState<MetaAgentMessage[]>([
    systemPrompt,
    { role: "assistant", content: STAGE_PROMPTS[0] },
  ]);
  const [stage, setStage] = useState(0);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [embedCode, setEmbedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages, loading]);

  const onSend = async () => {
    const text = input.trim();
    if (!text || loading) {
      return;
    }

    setCopied(false);

    const userMessage: MetaAgentMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const result = await createAgentViaMetaAgent(nextMessages, sessionId, customerId);
      const assistantReply = result.response ?? result.message;
      const nextSessionId = result.sessionId ?? result.session?.id ?? sessionId;
      const nextEmbedCode = result.embedCode ?? result.agent?.embedCode ?? "";

      const updatedMessages = [...nextMessages];

      if (assistantReply) {
        updatedMessages.push({ role: "assistant", content: assistantReply });
      }

      if (nextEmbedCode) {
        setEmbedCode(nextEmbedCode);
      } else if (stage < STAGE_PROMPTS.length - 1) {
        const nextStage = stage + 1;
        const nextPrompt = STAGE_PROMPTS[nextStage];
        setStage(nextStage);
        if (nextPrompt) {
          updatedMessages.push({ role: "assistant", content: nextPrompt });
        }
      }

      setSessionId(nextSessionId);
      setMessages(updatedMessages);
    } catch (error) {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "Failed to create agent.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

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
          {visibleMessages.map((message, index) => {
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
