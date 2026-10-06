import { isSensitiveKey } from "@/lib/sensitive-keys";

/**
 * Audit metadata guard. Audit events describe *what happened*, never the
 * sensitive data involved. Only small scalar values are accepted, and keys
 * that look like personal, financial or secret data are rejected outright so
 * mistakes fail loudly in development and tests.
 */
export type AuditMetadata = Record<string, string | number | boolean | null>;

const MAX_KEYS = 20;
const MAX_STRING_LENGTH = 200;

export class AuditMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditMetadataError";
  }
}

export function sanitiseAuditMetadata(input: Record<string, unknown> = {}): AuditMetadata {
  const entries = Object.entries(input);
  if (entries.length > MAX_KEYS) throw new AuditMetadataError(`audit metadata exceeds ${MAX_KEYS} keys`);

  const out: AuditMetadata = {};
  for (const [key, value] of entries) {
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) throw new AuditMetadataError(`invalid audit metadata key "${key}"`);
    if (isSensitiveKey(key)) throw new AuditMetadataError(`audit metadata key "${key}" is not permitted`);
    if (value === null || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new AuditMetadataError(`audit metadata "${key}" must be finite`);
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value;
    } else {
      throw new AuditMetadataError(`audit metadata "${key}" must be a scalar`);
    }
  }
  return out;
}
