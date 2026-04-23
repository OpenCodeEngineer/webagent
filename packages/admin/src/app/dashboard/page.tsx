import Link from "next/link";
import { AgentCards } from "@/components/agent-cards";
import { auth } from "@/lib/auth";
import { getAgents } from "@/lib/api";
import { normalizeCustomerIdToUuid } from "@/lib/customer-id";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const customerId = normalizeCustomerIdToUuid(session.user.id, session.user.email);
  const agents = customerId ? await getAgents(customerId) : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-600">Manage and launch your web agents.</p>
        </div>
        <Link
          href="/create"
          className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          Create New Agent
        </Link>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Your Agents</h2>
        <AgentCards agents={agents} />
      </section>
    </div>
  );
}
