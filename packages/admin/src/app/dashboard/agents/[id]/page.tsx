import { auth } from "@/lib/auth";
import { getAgent } from "@/lib/api";
import { normalizeCustomerIdToUuid } from "@/lib/customer-id";
import { redirect } from "next/navigation";
import { AgentDetailActions } from "@/components/agent-detail-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AgentDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const customerId = normalizeCustomerIdToUuid(session.user.id, session.user.email);
  const agent = await getAgent(id, customerId);

  if (!agent) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">Agent not found.</p>
        </CardContent>
      </Card>
    );
  }

  const embedCode =
    agent.embedCode ??
    (agent.embedToken
      ? `<script src="https://cdn.webagent.ai/widget.js" data-token="${agent.embedToken}"></script>`
      : "");

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">{agent.name ?? "Unnamed Agent"}</CardTitle>
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
            </div>
            <Badge
              variant={agent.status === "active" ? "default" : agent.status === "deleted" ? "destructive" : "secondary"}
              className={cn("capitalize", agent.status === "active" && "bg-green-600 hover:bg-green-700 text-white")}
            >
              {agent.status ?? "unknown"}
            </Badge>
          </div>
          {agent.createdAt && (
            <CardDescription>
              Created: {new Date(agent.createdAt).toLocaleString()}
            </CardDescription>
          )}
        </CardHeader>
      </Card>

      {/* Embed code */}
      <Card>
        <CardHeader>
          <CardTitle>Embed Code</CardTitle>
          <CardDescription>Add this snippet to your website.</CardDescription>
        </CardHeader>
        <CardContent>
          <AgentDetailActions agentId={agent.id} embedCode={embedCode} customerId={customerId} />
        </CardContent>
      </Card>

      {/* Widget preview */}
      {agent.widgetPreviewUrl && (
        <Card>
          <CardHeader>
            <CardTitle>Widget Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <iframe
              src={agent.widgetPreviewUrl}
              className="h-96 w-full rounded-lg border border-border"
              title="Widget Preview"
            />
          </CardContent>
        </Card>
      )}

      {/* Recent sessions */}
      {agent.recentSessions && agent.recentSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {agent.recentSessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-3">
                  <span className="text-sm text-foreground">{s.visitorId ?? s.id}</span>
                  {s.lastActive && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(s.lastActive).toLocaleString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
