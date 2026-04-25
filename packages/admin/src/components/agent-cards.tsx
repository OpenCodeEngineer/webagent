"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe, Users, Bot } from "lucide-react";
import type { Agent } from "@/lib/api";
import { serverDeleteAgent, serverUpdateAgent } from "@/lib/actions";
import { useToast } from "@/components/toast";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AgentCardsProps {
  agents: Agent[];
}

export function AgentCards({ agents: initialAgents }: AgentCardsProps) {
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { toast } = useToast();

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
        <Bot className="mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No agents yet</p>
        <p className="mt-1 text-xs text-muted-foreground">Create your first agent to get started!</p>
      </div>
    );
  }

  const handleTogglePause = async (agent: Agent) => {
    const newStatus = agent.status === "paused" ? "active" : "paused";
    setLoadingId(`pause-${agent.id}`);
    try {
      const updated = await serverUpdateAgent(agent.id, { status: newStatus });
      if (updated) {
        setAgents((prev) => prev.map((a) => (a.id === agent.id ? updated : a)));
        toast({ message: `Agent ${newStatus === "active" ? "resumed" : "paused"}.`, type: "success" });
      }
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Failed to update agent.", type: "error" });
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (agent: Agent) => {
    if (!window.confirm(`Delete agent "${agent.name ?? agent.id}"? This cannot be undone.`)) return;
    setLoadingId(`delete-${agent.id}`);
    try {
      await serverDeleteAgent(agent.id);
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
      toast({ message: "Agent deleted.", type: "success" });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Failed to delete agent.", type: "error" });
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent) => (
        <Card key={agent.id} className="flex flex-col">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-foreground truncate">{agent.name ?? "Unnamed Agent"}</h3>
              <Badge
                variant={agent.status === "active" ? "default" : agent.status === "deleted" ? "destructive" : "secondary"}
                className={cn(agent.status === "active" && "bg-green-600 hover:bg-green-700 text-white")}
              >
                {agent.status ?? "unknown"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex-1 space-y-1">
            {agent.websiteUrl && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Globe className="h-3 w-3 shrink-0" />
                <span className="truncate">{agent.websiteUrl}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3 w-3 shrink-0" />
              <span>Sessions: {agent.sessionCount ?? 0}</span>
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2 pt-2">
            <Link href={`/dashboard/agents/${agent.id}`} className={cn(buttonVariants({ variant: "default", size: "sm" }))}>View</Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleTogglePause(agent)}
              disabled={loadingId === `pause-${agent.id}` || agent.status === "deleted"}
            >
              {loadingId === `pause-${agent.id}` ? "…" : agent.status === "paused" ? "Resume" : "Pause"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDelete(agent)}
              disabled={loadingId === `delete-${agent.id}`}
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              {loadingId === `delete-${agent.id}` ? "…" : "Delete"}
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
