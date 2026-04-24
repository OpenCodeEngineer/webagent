import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { AgentCards } from "@/components/agent-cards";
import { auth } from "@/lib/auth";
import { getAgents } from "@/lib/api";
import { normalizeCustomerIdToUuid } from "@/lib/customer-id";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const customerId = normalizeCustomerIdToUuid(session.user.id, session.user.email);
  const agents = customerId ? await getAgents(customerId) : [];
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage and launch your web agents.</p>
        </div>
        <Link href="/create" className={cn(buttonVariants())}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Create New Agent
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Your Agents</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentCards agents={agents} customerId={customerId} />
        </CardContent>
      </Card>
    </div>
  );
}
