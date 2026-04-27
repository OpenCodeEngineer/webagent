import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth();
  const user = session?.user;
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const proxyUrl = process.env.PROXY_URL || "http://localhost:3001";
  const token = process.env.PROXY_API_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ error: "SSO proxy token is not configured" }, { status: 503 });
  }
  const body = {
    email: user.email,
    ...(user.id ? { userId: user.id } : {}),
    ...(user.name ? { name: user.name } : {}),
  };

  try {
    const response = await fetch(`${proxyUrl}/sso/librechat/code`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!response.ok) {
      const status = response.status >= 500 ? 503 : 502;
      return NextResponse.json({ error: "LibreChat SSO proxy failed" }, { status });
    }

    const payload = (await response.json()) as { code?: unknown };
    if (typeof payload.code !== "string" || !payload.code) {
      return NextResponse.json({ error: "Invalid SSO response from proxy" }, { status: 502 });
    }
    const { code } = payload;
    return NextResponse.json({ code });
  } catch {
    return NextResponse.json({ error: "LibreChat SSO proxy unavailable" }, { status: 503 });
  }
}
