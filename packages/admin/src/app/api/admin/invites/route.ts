import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { inviteCodes } from "@/lib/auth-schema";
import { desc } from "drizzle-orm";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const codes = await getDb()
    .select()
    .from(inviteCodes)
    .orderBy(desc(inviteCodes.createdAt));

  return NextResponse.json(codes);
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() || null : null;
  const expiresAt = typeof body.expiresAt === "number" ? new Date(body.expiresAt) : null;

  const id = crypto.randomUUID();
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();

  const [created] = await getDb()
    .insert(inviteCodes)
    .values({
      id,
      code,
      createdBy: session.user.id,
      email,
      expiresAt,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
