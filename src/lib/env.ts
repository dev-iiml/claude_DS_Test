import "server-only";

import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("true")
  .transform((v) => v === "true");

const serverEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  DATABASE_PREPARE: booleanString,
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24 * 7),
  /** Bearer secret for the scheduled job tick (`/api/internal/cron/tick`). Unset → the endpoint is disabled. */
  CRON_SECRET: z.string().min(32, "CRON_SECRET must be at least 32 characters").optional(),
  /** Key for PAN fingerprints (duplicate-identity checks). Required outside development/test. */
  PAN_FINGERPRINT_SECRET: z.string().min(32, "PAN_FINGERPRINT_SECRET must be at least 32 characters").optional(),
  /** AES-256-GCM key (32 bytes, base64) for Account Aggregator line items. Required outside development/test. */
  FI_DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "FI_DATA_ENCRYPTION_KEY must be 32 bytes, base64")
    .optional(),
  /** Store LIVE AA line items (mock/sandbox are always stored). Off until counsel and the partner RE sign off. */
  FI_LIVE_LINE_ITEM_RETENTION: z.enum(["true", "false"]).default("false"),
  /** Root key from which partner webhook signing secrets are derived (none are stored). Required outside dev/test. */
  PARTNER_WEBHOOK_ROOT_KEY: z.string().min(32, "PARTNER_WEBHOOK_ROOT_KEY must be at least 32 characters").optional(),
  /** Key for pseudonymous analytics subject ids (keyed hash of the user id). Required outside dev/test. */
  ANALYTICS_PSEUDONYM_KEY: z.string().min(32, "ANALYTICS_PSEUDONYM_KEY must be at least 32 characters").optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Secrets that must exist once real data is involved (staging/production). */
function requiredOutsideDev(env: ServerEnv): string[] {
  if (env.APP_ENV === "development" || env.APP_ENV === "test") return [];
  return (
    ["PAN_FINGERPRINT_SECRET", "FI_DATA_ENCRYPTION_KEY", "PARTNER_WEBHOOK_ROOT_KEY", "ANALYTICS_PSEUDONYM_KEY"] as const
  ).filter((k) => !env[k]);
}

let cached: ServerEnv | undefined;

/** Validated server environment. Throws with field names (never values) when invalid. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server environment: ${fields}`);
  }
  const missing = requiredOutsideDev(parsed.data);
  if (missing.length)
    throw new Error(`Invalid server environment: ${missing.join(", ")} required in ${parsed.data.APP_ENV}`);
  cached = parsed.data;
  return cached;
}

/** Secure cookies everywhere except local development and test. */
export function isSecureCookieEnv(env: ServerEnv = getServerEnv()): boolean {
  return env.APP_ENV !== "development" && env.APP_ENV !== "test";
}

/** Staging and production: real partners, real data — production-grade guards apply (Stage 12b). */
export function isProductionLike(env: ServerEnv = getServerEnv()): boolean {
  return env.APP_ENV === "staging" || env.APP_ENV === "production";
}
