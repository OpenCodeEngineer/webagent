"use client";

import { useState } from "react";
import { Copy, Check, RefreshCw } from "lucide-react";
import { regenerateToken } from "@/lib/api";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";

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
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg bg-zinc-900 p-4">
        <code className="text-emerald-400 font-mono text-sm whitespace-pre">
          {embedCode || "No embed code available."}
        </code>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="default" size="sm" onClick={handleCopy}>
          {copied ? (
            <>
              <Check className="mr-2 h-4 w-4" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="mr-2 h-4 w-4" />
              Copy Code
            </>
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={regenerating}>
          <RefreshCw className={`mr-2 h-4 w-4 ${regenerating ? "animate-spin" : ""}`} />
          {regenerating ? "Regenerating…" : "Regenerate Token"}
        </Button>
      </div>
    </div>
  );
}
