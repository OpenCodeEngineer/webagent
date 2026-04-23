import "server-only";
import { createHash } from "node:crypto";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalize = (value?: string | null): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toDeterministicUuid = (value: string): string => {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

export function normalizeCustomerIdToUuid(
  userId?: string | null,
  email?: string | null,
): string | undefined {
  const normalizedUserId = normalize(userId);
  if (normalizedUserId) {
    if (UUID_RE.test(normalizedUserId)) {
      return normalizedUserId;
    }

    return toDeterministicUuid(normalizedUserId);
  }

  const normalizedEmail = normalize(email);
  if (normalizedEmail) {
    return toDeterministicUuid(normalizedEmail);
  }

  return undefined;
}
