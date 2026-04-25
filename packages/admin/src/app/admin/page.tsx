import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

// Server-side fetch for admin data
async function getAdminData(endpoint: string) {
  const token = process.env.PROXY_CUSTOMER_API_TOKEN ?? process.env.PROXY_API_TOKEN ?? process.env.OPENCLAW_GATEWAY_TOKEN;
  const proxyUrl = process.env.PROXY_URL ?? `http://127.0.0.1:${process.env.PROXY_PORT ?? "3001"}`;
  const res = await fetch(`${proxyUrl}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [stats, users, recentAgents, auditLog] = await Promise.all([
    getAdminData("/api/admin/stats"),
    getAdminData("/api/admin/users"),
    getAdminData("/api/admin/agents"),
    getAdminData("/api/admin/audit-log"),
  ]);

  return (
    <div className="space-y-8">
      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Users", value: (stats as any)?.totalUsers ?? 0 },
          { label: "Total Agents", value: (stats as any)?.totalAgents ?? 0 },
          { label: "Active Agents", value: (stats as any)?.activeAgents ?? 0 },
          { label: "Total Sessions", value: (stats as any)?.totalSessions ?? 0 },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Users table */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Users</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Agents</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {((users as any)?.data ?? []).map((user: any) => (
                <tr key={user.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 text-foreground">{user.email}</td>
                  <td className="px-4 py-3 text-muted-foreground">{user.name ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-foreground">{user.agentCount ?? 0}</td>
                  <td className="px-4 py-3 text-muted-foreground">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {(!(users as any)?.data || (users as any).data.length === 0) && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No users yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Agents table */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-foreground">All Agents</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Sessions</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {((recentAgents as any)?.data ?? []).map((agent: any) => (
                <tr key={agent.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 text-foreground">{agent.name}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{agent.customerEmail ?? agent.customerId?.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      agent.status === "active" ? "bg-green-900/30 text-green-400" : 
                      agent.status === "deleted" ? "bg-red-900/30 text-red-400" : 
                      "bg-yellow-900/30 text-yellow-400"
                    }`}>{agent.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{agent.sessionCount ?? 0}</td>
                  <td className="px-4 py-3 text-muted-foreground">{agent.createdAt ? new Date(agent.createdAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {(!(recentAgents as any)?.data || (recentAgents as any).data.length === 0) && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No agents yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Audit Log */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Audit Log</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Time</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Action</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {((auditLog as any)?.data ?? []).map((entry: any, i: number) => (
                <tr key={entry.id ?? i} className="hover:bg-muted/30">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}</td>
                  <td className="px-4 py-3 text-foreground font-mono text-xs">{entry.action}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{entry.customerId?.slice(0, 8) ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs max-w-xs truncate">{entry.details ? JSON.stringify(entry.details) : "—"}</td>
                </tr>
              ))}
              {(!(auditLog as any)?.data || (auditLog as any).data.length === 0) && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No audit entries yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
