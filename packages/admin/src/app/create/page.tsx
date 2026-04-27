import LibreChatIframe from "@/components/librechat-iframe";
import { auth } from "@/lib/auth";
import { normalizeCustomerIdToUuid } from "@/lib/customer-id";
import { redirect } from "next/navigation";

export default async function CreatePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const customerId = normalizeCustomerIdToUuid(session.user.id, session.user.email);
  return (
    <div className="h-screen bg-[#171717] overflow-hidden">
      <LibreChatIframe customerId={customerId} />
    </div>
  );
}
