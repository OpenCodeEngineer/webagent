"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, Check, Loader2 } from "lucide-react";
import { serverUpdateAgent } from "@/lib/actions";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { Agent } from "@/lib/api";

interface AgentEditFormProps {
  agent: Agent;
}

export function AgentEditForm({ agent }: AgentEditFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(agent.name ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(agent.websiteUrl ?? "");
  const [description, setDescription] = useState(
    (agent.description as string | undefined) ?? ""
  );

  const handleCancel = () => {
    setName(agent.name ?? "");
    setWebsiteUrl(agent.websiteUrl ?? "");
    setDescription((agent.description as string | undefined) ?? "");
    setIsEditing(false);
  };

  const handleSave = () => {
    startTransition(async () => {
      try {
        await serverUpdateAgent(agent.id, {
          name: name.trim() || undefined,
          websiteUrl: websiteUrl.trim() || undefined,
          description: description.trim() || undefined,
        });
        toast({ message: "Agent updated successfully.", type: "success" });
        setIsEditing(false);
        router.refresh();
      } catch (err) {
        toast({
          message: err instanceof Error ? err.message : "Failed to update agent.",
          type: "error",
        });
      }
    });
  };

  if (!isEditing) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {agent.name ?? "Unnamed Agent"}
          </h1>
          {agent.websiteUrl && (
            <a
              href={agent.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-sm text-primary hover:underline"
            >
              {agent.websiteUrl}
            </a>
          )}
          {(agent.description as string | undefined) && (
            <p className="mt-2 text-sm text-muted-foreground">
              {agent.description as string}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsEditing(true)}
          className="shrink-0"
        >
          <Pencil className="mr-2 h-4 w-4" />
          Edit
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Agent name"
            disabled={isPending}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none transition-colors focus:border-zinc-500 disabled:opacity-50"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            Website URL
          </label>
          <input
            type="text"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://example.com"
            disabled={isPending}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none transition-colors focus:border-zinc-500 disabled:opacity-50"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of what this agent does…"
            rows={3}
            disabled={isPending}
            className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none transition-colors focus:border-zinc-500 disabled:opacity-50"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={isPending}>
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          {isPending ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" size="sm" onClick={handleCancel} disabled={isPending}>
          <X className="mr-2 h-4 w-4" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
