"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import type { Agent } from "@/lib/api";

interface AgentListProps {
  agents: Agent[];
}

export function AgentList({ agents }: AgentListProps) {
  const [query, setQuery] = useState("");

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return agents;
    }

    return agents.filter((agent) => {
      const name = (agent.name ?? "").toLowerCase();
      const website = (agent.websiteUrl ?? "").toLowerCase();
      return name.includes(normalizedQuery) || website.includes(normalizedQuery);
    });
  }, [agents, query]);

  return (
    <div className="mt-4 space-y-4">
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search agents"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />

      {filteredAgents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
          No agents yet. Create your first agent to get started!
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAgents.map((agent) => (
            <li key={agent.id} className="rounded-lg border border-gray-200 p-4 transition hover:border-indigo-300 hover:shadow-sm">
              <div>
                <h3 className="truncate text-base font-semibold text-gray-900">
                  {agent.name ?? "Untitled Agent"}
                </h3>
                <p className="mt-1 truncate text-sm text-gray-600">
                  {agent.websiteUrl ?? "No website configured"}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/create?agentId=${encodeURIComponent(agent.id)}`}
                  className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  Configure
                </Link>
                {agent.websiteUrl ? (
                  <a
                    href={agent.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Visit Site
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
