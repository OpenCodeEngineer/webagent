"use server";

import type { Agent } from "@/lib/api";
import { deleteAgent, getAgent, getAgents, regenerateToken, updateAgent } from "@/lib/api";
import { auth } from "@/lib/auth";
import { normalizeCustomerIdToUuid } from "@/lib/customer-id";
import { signRequest } from "@/lib/proxy-auth";

async function requireCustomerId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return normalizeCustomerIdToUuid(userId, session.user.email) ?? userId;
}

export async function serverGetAgents() {
  const customerId = await requireCustomerId();
  return getAgents(signRequest(customerId));
}

export async function serverGetAgent(id: string) {
  const customerId = await requireCustomerId();
  return getAgent(id, signRequest(customerId));
}

export async function serverUpdateAgent(id: string, data: Record<string, unknown>) {
  const customerId = await requireCustomerId();
  return updateAgent(id, data as Partial<Agent>, signRequest(customerId));
}

export async function serverDeleteAgent(id: string) {
  const customerId = await requireCustomerId();
  return deleteAgent(id, signRequest(customerId));
}

export async function serverRegenerateToken(id: string) {
  const customerId = await requireCustomerId();
  return regenerateToken(id, signRequest(customerId));
}
