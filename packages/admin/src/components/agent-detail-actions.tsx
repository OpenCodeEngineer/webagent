"use client";

import { useState } from "react";
import { regenerateToken } from "@/lib/api";
import { useToast } from "@/components/toast";

interface AgentDetailActionsProps {
  agentId: string;
  embedCode: string;
  customerId?: string;
}

export function AgentDetailActions({ agentId, embedCode: initialEmbedCode, customerId }: AgentDetailActionsProps) {
  const [embedCode, setEmbedCode] = useState(initialEmbedCode);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ message: "Copied to clipboard!", type: "success" });
    } catch {
      toast({ message: "Failed to copy.", type: "error" });
    }
  };

  const handleRegenerate = async () => {
    if (!window.confirm("Regenerate embed token? The old token will stop working.")) return;
    setRegenerating(true);
    try {
      const updated = await regenerateToken(agentId, customerId);
      if (updated?.embedCode) {
        setEmbedCode(updated.embedCode);
        toast({ message: "Token regenerated.", type: "success" });
      } else if (updated?.embedToken) {
        const newCode = `<script src="https://cdn.webagent.ai/widget.js" data-token="${updated.embedToken}"></script>`;
        setEmbedCode(newCode);
        toast({ message: "Token regenerated.", type: "success" });
      }
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Failed to regenerate token.", type: "error" });
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs text-green-400">
        <code>{embedCode || "No embed code available."}</code>
      </pre>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleCopy}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {copied ? "Copied!" : "Copy Code"}
        </button>
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {regenerating ? "Regenerating…" : "Regenerate Token"}
        </button>
      </div>
    </div>
  );
}
