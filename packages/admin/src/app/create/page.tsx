import { CreateAgentChat } from "@/components/create-agent-chat";
import { auth } from "@/lib/auth";
import { normalizeCustomerIdToUuid } from "@/lib/customer-id";
import { redirect } from "next/navigation";

export default async function CreatePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const customerId = normalizeCustomerIdToUuid(session.user.id, session.user.email);
  return (
    <div className="flex h-full min-h-screen flex-col bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 pt-8">
        <h1 className="text-2xl font-semibold text-foreground">Create Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">Follow each stage to configure your agent and get embed code.</p>
      </div>
      <div className="mx-auto mt-6 flex w-full max-w-3xl flex-1 flex-col px-4 pb-8">
        <CreateAgentChat customerId={customerId} />
      </div>
    </div>
  );
}
