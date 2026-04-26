import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normalizeCustomerIdToUuid } from "@/lib/customer-id";
import { createWsTicket } from "@/lib/proxy-auth";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const customerId = normalizeCustomerIdToUuid(session.user.id, session.user.email);
  if (!customerId) {
    return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  }

  const ticket = createWsTicket(customerId);
  return NextResponse.json({ ticket, customerId });
}
