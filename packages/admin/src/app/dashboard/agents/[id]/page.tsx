import { auth } from "@/lib/auth";
import { serverGetAgent } from "@/lib/actions";
import { redirect } from "next/navigation";
import { AgentDetailActions } from "@/components/agent-detail-actions";
import { AgentEditForm } from "@/components/agent-edit-form";
import { WidgetPreview } from "@/components/widget-preview";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const WIDGET_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || "https://dev.lamoom.com";

function buildEmbedCode(token: string): string {
  const domain = WIDGET_BASE_URL.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return `<script src="https://${domain}/widget.js" data-agent-token="${token}" async></script>`;
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AgentDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const agent = await serverGetAgent(id);

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
    (agent.embedToken ? buildEmbedCode(agent.embedToken) : "");

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <AgentEditForm agent={agent} />
            </div>
            <Badge
              variant={agent.status === "active" ? "default" : agent.status === "deleted" ? "destructive" : "secondary"}
              className={cn("capitalize shrink-0", agent.status === "active" && "bg-green-600 hover:bg-green-700 text-white")}
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
          <AgentDetailActions agentId={agent.id} embedCode={embedCode} />
        </CardContent>
      </Card>

      {/* Live widget preview */}
      {agent.embedToken && (
        <Card>
          <CardHeader>
            <CardTitle>Test Your Widget</CardTitle>
            <CardDescription>Try chatting with your agent below. This is exactly what your visitors will see.</CardDescription>
          </CardHeader>
          <CardContent>
            <WidgetPreview agentToken={agent.embedToken} />
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
