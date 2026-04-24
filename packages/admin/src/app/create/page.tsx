import { CreateAgentChat } from "@/components/create-agent-chat";
import { auth } from "@/lib/auth";
import { normalizeCustomerIdToUuid } from "@/lib/customer-id";
import { redirect } from "next/navigation";

export default async function CreatePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const customerId = normalizeCustomerIdToUuid(session.user.id, session.user.email);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-gray-900">Create Agent</h1>
        <p className="mt-2 text-sm text-gray-600">
          Follow each stage to configure your agent and get embed code.
        </p>
      </div>
      <CreateAgentChat customerId={customerId} />
    </main>
  );
}
