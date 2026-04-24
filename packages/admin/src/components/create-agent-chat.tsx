"use client";

import { useMemo, useState } from "react";

import { createAgentViaMetaAgent, type MetaAgentMessage } from "@/lib/api";

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

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );

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
    <div className="mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="max-h-[460px] space-y-3 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-4">
        {visibleMessages.map((message, index) => {
          const isUser = message.role === "user";

          return (
            <div key={`${message.role}-${index}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  isUser ? "bg-indigo-600 text-white" : "border border-gray-200 bg-white text-gray-800"
                }`}
              >
                {message.content}
              </div>
            </div>
          );
        })}

        {loading ? (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
              Thinking...
            </div>
          </div>
        ) : null}
      </div>

      {embedCode ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-emerald-900">Embed Snippet</p>
            <button
              type="button"
              onClick={onCopyEmbedCode}
              className="rounded-md border border-emerald-300 bg-white px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-md bg-gray-900 p-3 text-xs text-emerald-100">
            <code>{embedCode}</code>
          </pre>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void onSend();
            }
          }}
          placeholder="Type your message..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          disabled={loading}
        />
        <button
          type="button"
          onClick={() => {
            void onSend();
          }}
          disabled={loading || input.trim().length === 0}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          Send
        </button>
      </div>
    </div>
  );
}
