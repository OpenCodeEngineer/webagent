import { type NextRequest, NextResponse } from "next/server";

const PROXY_URL =
  process.env.PROXY_URL ??
  `http://127.0.0.1:${process.env.PROXY_PORT ?? "3001"}`;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();

  const headers = new Headers();
  headers.set("Content-Type", "application/json");

  const xCustomerId = request.headers.get("x-customer-id");
  const xCustomerSig = request.headers.get("x-customer-sig");
  if (xCustomerId) headers.set("x-customer-id", xCustomerId);
  if (xCustomerSig) headers.set("x-customer-sig", xCustomerSig);

  let response: Response;
  try {
    response = await fetch(`${PROXY_URL}/api/agents/create-via-meta`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(300_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy unreachable";
    return NextResponse.json({ error: { code: "proxy_error", message } }, { status: 502 });
  }

  const responseBody = await response.text();
  return new NextResponse(responseBody, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}
