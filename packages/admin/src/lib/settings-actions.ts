"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { users, accounts } from "@/lib/auth-schema";
import { normalizeCustomerIdToUuid } from "@/lib/customer-id";

async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session;
}

// ── Account ──────────────────────────────────────────────────────────────────

export async function updateDisplayName(formData: FormData): Promise<{ error?: string }> {
  const session = await requireSession();
  const name = (formData.get("name") as string | null)?.trim();
  if (!name) return { error: "Name cannot be empty." };

  await getDb().update(users).set({ name }).where(eq(users.id, session.user.id));
  return {};
}

// ── Security ─────────────────────────────────────────────────────────────────

export async function changePassword(formData: FormData): Promise<{ error?: string }> {
  const session = await requireSession();
  const currentPassword = formData.get("currentPassword") as string | null;
  const newPassword = formData.get("newPassword") as string | null;
  const confirmPassword = formData.get("confirmPassword") as string | null;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: "All fields are required." };
  }
  if (newPassword !== confirmPassword) {
    return { error: "New passwords do not match." };
  }
  if (newPassword.length < 6) {
    return { error: "New password must be at least 6 characters." };
  }

  const db = getDb();
  const userRows = await db
    .select({ hashedPassword: users.hashedPassword })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const user = userRows[0];
  if (!user?.hashedPassword) {
    return { error: "No password account found. Use a social login." };
  }

  const isValid = await bcrypt.compare(currentPassword, user.hashedPassword);
  if (!isValid) {
    return { error: "Current password is incorrect." };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await db
    .update(users)
    .set({ hashedPassword })
    .where(eq(users.id, session.user.id));

  return {};
}

// ── Embed API ─────────────────────────────────────────────────────────────────

export async function getEmbedApiCredentials(): Promise<{
  customerId: string | null;
  hmacSecret: string | null;
  hasCredentials: boolean;
}> {
  const session = await requireSession();
  const customerId =
    normalizeCustomerIdToUuid(session.user.id, session.user.email) ?? null;
  const hmacSecret =
    process.env.PROXY_INTERNAL_SECRET?.trim() ||
    process.env.PROXY_API_TOKEN?.trim() ||
    null;

  return {
    customerId,
    hmacSecret,
    hasCredentials: Boolean(customerId && hmacSecret),
  };
}

export async function getOrCreateApiToken(): Promise<{ apiToken: string }> {
  const session = await requireSession();
  const db = getDb();
  const rows = await db
    .select({ apiToken: users.apiToken })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (rows[0]?.apiToken) return { apiToken: rows[0].apiToken };
  const newToken = `lm_${crypto.randomUUID().replace(/-/g, "")}`;
  await db.update(users).set({ apiToken: newToken }).where(eq(users.id, session.user.id));
  return { apiToken: newToken };
}

export async function rotateApiToken(): Promise<{ apiToken: string }> {
  const session = await requireSession();
  const newToken = `lm_${crypto.randomUUID().replace(/-/g, "")}`;
  await getDb().update(users).set({ apiToken: newToken }).where(eq(users.id, session.user.id));
  return { apiToken: newToken };
}

// ── Account detection ─────────────────────────────────────────────────────────

export async function getAccountProviders(): Promise<{
  hasCredentials: boolean;
  providers: string[];
}> {
  const session = await requireSession();
  const db = getDb();

  // Check both accounts table (legacy) and users.hashedPassword (new)
  const [accountRows, userRows] = await Promise.all([
    db
      .select({ provider: accounts.provider })
      .from(accounts)
      .where(eq(accounts.userId, session.user.id)),
    db
      .select({ hashedPassword: users.hashedPassword })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1),
  ]);

  const providers = accountRows.map((a) => a.provider);
  const hasHashedPassword = Boolean(userRows[0]?.hashedPassword);
  const hasCredentials = providers.includes("credentials") || hasHashedPassword;

  return {
    hasCredentials,
    providers,
  };
}

// ── Delete account ────────────────────────────────────────────────────────────

export async function deleteAccount(): Promise<{ error?: string }> {
  const session = await requireSession();
  await getDb().delete(users).where(eq(users.id, session.user.id));
  return {};
}
