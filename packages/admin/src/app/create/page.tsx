import { CreateAgentChat } from "@/components/create-agent-chat";
import { auth } from "@/lib/auth";
import { normalizeCustomerIdToUuid } from "@/lib/customer-id";
import { redirect } from "next/navigation";

export default async function CreatePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const customerId = normalizeCustomerIdToUuid(session.user.id, session.user.email);
  const wsToken =
    process.env.PROXY_CUSTOMER_API_TOKEN ??
    process.env.PROXY_API_TOKEN ??
    process.env.OPENCLAW_GATEWAY_TOKEN ??
    "";
  return (
    <div className="h-screen bg-[#171717] overflow-hidden">
      <CreateAgentChat customerId={customerId} wsToken={wsToken} />
    </div>
  );
}
