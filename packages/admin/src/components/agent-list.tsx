"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Bot } from "lucide-react";
import type { Agent } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search agents"
          className="pl-9"
        />
      </div>

      {filteredAgents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <Bot className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No agents found</p>
          <p className="mt-1 text-xs text-muted-foreground">Try a different search term or create a new agent.</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAgents.map((agent) => (
            <li key={agent.id}>
              <Card className="transition hover:border-primary/50">
                <CardContent className="p-4">
                  <div>
                    <h3 className="truncate text-base font-semibold text-foreground">
                      {agent.name ?? "Untitled Agent"}
                    </h3>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {agent.websiteUrl ?? "No website configured"}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href={`/create?agentId=${encodeURIComponent(agent.id)}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Configure</Link>
                    {agent.websiteUrl ? (
                      <a href={agent.websiteUrl} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Visit Site</a>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
