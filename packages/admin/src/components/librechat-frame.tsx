"use client";

import { useEffect, useState } from "react";

export function LibreChatFrame() {
  const [ssoUrl, setSsoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initSso() {
      try {
        const res = await fetch("/api/librechat/sso", { method: "POST" });
        if (!res.ok) {
          setError("Failed to initialize chat session");
          return;
        }
        const data = (await res.json()) as { code?: string };
        if (!cancelled && data.code) {
          setSsoUrl(`/sso/librechat?code=${encodeURIComponent(data.code)}`);
        }
      } catch {
        if (!cancelled) setError("Chat service unavailable");
      }
    }

    initSso();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        <div className="text-center">
          <p className="text-lg">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-[#2f2f2f] rounded hover:bg-[#424242] transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!ssoUrl) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-[#999]">
          <div className="flex gap-1 justify-center mb-2">
            <span className="w-2 h-2 rounded-full bg-[#555] animate-pulse" />
            <span
              className="w-2 h-2 rounded-full bg-[#555] animate-pulse"
              style={{ animationDelay: "0.2s" }}
            />
            <span
              className="w-2 h-2 rounded-full bg-[#555] animate-pulse"
              style={{ animationDelay: "0.4s" }}
            />
          </div>
          <p>Loading agent builder...</p>
        </div>
      </div>
    );
  }

  return (
    <iframe
      src={ssoUrl}
      className="w-full h-full border-0"
      allow="microphone; clipboard-write"
      title="Agent Builder Chat"
    />
  );
}
