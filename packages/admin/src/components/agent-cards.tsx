"use client";

import { useState } from "react";
import Link from "next/link";
import type { Agent } from "@/lib/api";
import { updateAgent, deleteAgent } from "@/lib/api";
import { useToast } from "@/components/toast";

interface AgentCardsProps {
  agents: Agent[];
  customerId?: string;
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  deleted: "bg-red-100 text-red-800",
};

export function AgentCards({ agents: initialAgents, customerId }: AgentCardsProps) {
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { toast } = useToast();

  if (agents.length === 0) {
    return (
      <p className="mt-4 text-sm text-gray-500">
        No agents yet. Create your first agent to get started!
      </p>
    );
  }

  const handleTogglePause = async (agent: Agent) => {
    const newStatus = agent.status === "paused" ? "active" : "paused";
    setLoadingId(`pause-${agent.id}`);
    try {
      const updated = await updateAgent(agent.id, { status: newStatus }, customerId);
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
      await deleteAgent(agent.id, customerId);
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
      toast({ message: "Agent deleted.", type: "success" });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Failed to delete agent.", type: "error" });
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent) => (
        <div key={agent.id} className="flex flex-col rounded-xl border border-gray-200 bg-gray-50 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{agent.name ?? "Unnamed Agent"}</h3>
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                statusColors[agent.status ?? ""] ?? "bg-gray-100 text-gray-600"
              }`}
            >
              {agent.status ?? "unknown"}
            </span>
          </div>
          {agent.websiteUrl && (
            <p className="mt-1 truncate text-xs text-gray-500">{agent.websiteUrl}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Sessions: {agent.sessionCount ?? 0}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/dashboard/agents/${agent.id}`}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            >
              View Embed Code
            </Link>
            <button
              onClick={() => handleTogglePause(agent)}
              disabled={loadingId === `pause-${agent.id}` || agent.status === "deleted"}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {loadingId === `pause-${agent.id}` ? "…" : agent.status === "paused" ? "Resume" : "Pause"}
            </button>
            <button
              onClick={() => handleDelete(agent)}
              disabled={loadingId === `delete-${agent.id}`}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {loadingId === `delete-${agent.id}` ? "…" : "Delete"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
