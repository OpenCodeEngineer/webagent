import { auth } from "@/lib/auth";
import { getAgent } from "@/lib/api";
import { redirect } from "next/navigation";
import { AgentDetailActions } from "@/components/agent-detail-actions";

interface Props {
  params: Promise<{ id: string }>;
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  deleted: "bg-red-100 text-red-800",
};

export default async function AgentDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const agent = await getAgent(id);

  if (!agent) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-gray-500">Agent not found.</p>
      </div>
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
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{agent.name ?? "Unnamed Agent"}</h1>
            {agent.websiteUrl && (
              <a
                href={agent.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 text-sm text-indigo-600 hover:underline"
              >
                {agent.websiteUrl}
              </a>
            )}
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${
              statusColors[agent.status ?? ""] ?? "bg-gray-100 text-gray-600"
            }`}
          >
            {agent.status ?? "unknown"}
          </span>
        </div>
        {agent.createdAt && (
          <p className="mt-2 text-xs text-gray-400">
            Created: {new Date(agent.createdAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* Embed code */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Embed Code</h2>
        <p className="mt-1 text-sm text-gray-500">Add this snippet to your website.</p>
        <AgentDetailActions agentId={agent.id} embedCode={embedCode} />
      </div>

      {/* Widget preview */}
      {agent.widgetPreviewUrl && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Widget Preview</h2>
          <iframe
            src={agent.widgetPreviewUrl}
            className="mt-4 h-96 w-full rounded-lg border border-gray-200"
            title="Widget Preview"
          />
        </div>
      )}

      {/* Recent sessions */}
      {agent.recentSessions && agent.recentSessions.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Recent Sessions</h2>
          <div className="mt-4 divide-y divide-gray-100">
            {agent.recentSessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between py-3">
                <span className="text-sm text-gray-700">{session.visitorId ?? session.id}</span>
                {session.lastActive && (
                  <span className="text-xs text-gray-400">
                    {new Date(session.lastActive).toLocaleString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
