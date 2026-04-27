"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { CreateAgentChat } from "@/components/create-agent-chat";

interface LibreChatIframeProps {
  customerId?: string;
}

export function LibreChatIframe({ customerId }: LibreChatIframeProps) {
  const [mode, setMode] = useState<"iframe" | "legacy">("iframe");
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSso = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/librechat/sso", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = (await response.json()) as { code?: string };
      if (!body.code) {
        throw new Error("Missing SSO code");
      }
      setIframeSrc(`/sso/librechat?code=${encodeURIComponent(body.code)}`);
    } catch {
      setIframeSrc(null);
      setError("Unable to open AI Chat. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSso();
  }, [loadSso]);

  return (
    <div className="h-full bg-[#171717] text-zinc-100">
      <div className="flex h-10 items-center justify-between border-b border-zinc-800 px-4">
        <h1 className="text-sm font-medium text-zinc-100">Create Agent</h1>
        <button
          type="button"
          onClick={() => setMode((prev) => (prev === "iframe" ? "legacy" : "iframe"))}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {mode === "iframe" ? "Legacy chat" : "AI Chat"}
        </button>
      </div>

      {mode === "legacy" ? (
        <div className="h-[calc(100vh-40px)]">
          <CreateAgentChat customerId={customerId} />
        </div>
      ) : (
        <div className="h-[calc(100vh-40px)]">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <span className="inline-flex gap-1 text-zinc-500">
                <span className="animate-bounce text-lg" style={{ animationDelay: "0ms" }}>·</span>
                <span className="animate-bounce text-lg" style={{ animationDelay: "150ms" }}>·</span>
                <span className="animate-bounce text-lg" style={{ animationDelay: "300ms" }}>·</span>
              </span>
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <p className="text-sm text-zinc-400">{error}</p>
              <button
                type="button"
                onClick={() => void loadSso()}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
              >
                Retry
              </button>
            </div>
          ) : (
            iframeSrc && (
              <iframe
                src={iframeSrc}
                className="w-full h-full border-0"
                allow="clipboard-write"
                title="LibreChat"
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

export default LibreChatIframe;
