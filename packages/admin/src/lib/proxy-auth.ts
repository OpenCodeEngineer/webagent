"server-only";

import { createHmac } from "node:crypto";

const getSecret = (): string =>
  process.env.PROXY_INTERNAL_SECRET?.trim() ||
  process.env.PROXY_API_TOKEN?.trim() ||
  process.env.PROXY_CUSTOMER_API_TOKEN?.trim() ||
  "";

const sign = (value: string): string => createHmac("sha256", getSecret()).update(value).digest("hex");

export function signRequest(customerId: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = sign(`${customerId}:${timestamp}`);

  return {
    "X-Customer-Id": customerId,
    "X-Customer-Sig": `${signature}:${timestamp}`,
  };
}

export function createWsTicket(customerId: string): string {
  const payload = {
    customerId,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(b64);
  return `${b64}.${sig}`;
}
