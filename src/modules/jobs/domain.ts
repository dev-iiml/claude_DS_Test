import { redactLogText } from "@/lib/log-redaction";

/**
 * Background job vocabulary and pure policy. Jobs carry identifiers and
 * counts only — never personal or financial payloads.
 */
export const JOB_TYPES = [
  "expire_stale_applications",
  "process_deferred_erasures",
  "provider_health_check",
  "purge_expired_fi_data",
  "process_lender_proposals",
  "deliver_partner_webhooks",
  "expire_access_requests",
  "analytics_maintenance",
  "rate_limit_purge",
  "purge_auth_records",
  "grant_membership_milestones",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** A failed attempt goes back to `queued` with a later `run_after`; after the last attempt it is `dead`. */
export const JOB_STATUSES = ["queued", "running", "succeeded", "dead"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const DEFAULT_MAX_ATTEMPTS = 5;
/** A running job whose worker vanished (serverless timeout) is re-queued after this. */
export const STALE_LOCK_MS = 15 * 60_000;

export interface JobSchedule {
  type: JobType;
  label: string;
  description: string;
  everyMinutes: number;
}

export const JOB_SCHEDULES: readonly JobSchedule[] = [
  {
    type: "expire_stale_applications",
    label: "Expire stale eligibility checks",
    description: "Closes checks not sent to a lender within 90 days and erases their inputs.",
    everyMinutes: 60,
  },
  {
    type: "process_deferred_erasures",
    label: "Complete deferred erasures",
    description: "Erases data whose retention hold has ended.",
    everyMinutes: 60,
  },
  {
    type: "purge_expired_fi_data",
    label: "Purge expired bank line items",
    description: "Deletes Account Aggregator line items and vendor analytics whose consent data-life has ended.",
    everyMinutes: 60,
  },
  {
    type: "process_lender_proposals",
    label: "Send credit proposals",
    description:
      "Sends queued proposals to partner lenders (with retries), collects pending decisions, and prepares proposals for confirmed checks shared through the consent API.",
    everyMinutes: 5,
  },
  {
    type: "deliver_partner_webhooks",
    label: "Deliver partner webhooks",
    description:
      "Sends signed, thin event webhooks to partner lenders (ids only), retrying with backoff; partners can also read the event feed.",
    everyMinutes: 1,
  },
  {
    type: "expire_access_requests",
    label: "Expire Access requests",
    description: "Closes pending Access requests whose opportunity has closed and returns their Creator Points.",
    everyMinutes: 60,
  },
  {
    type: "analytics_maintenance",
    label: "Analytics rollups and retention",
    description:
      "Rolls up daily event counts (no identifiers) and deletes raw analytics events older than 24 months once their day is rolled up.",
    everyMinutes: 60,
  },
  {
    type: "rate_limit_purge",
    label: "Purge rate-limit counters",
    description: "Deletes rate-limit counters (hashed network/account keys, counts only) older than 48 hours.",
    everyMinutes: 60,
  },
  {
    type: "purge_auth_records",
    label: "Purge expired security records",
    description:
      "Deletes sign-in attempts and ended sessions after 180 days, and mobile verification codes after 30 days.",
    everyMinutes: 60,
  },
  {
    type: "grant_membership_milestones",
    label: "Grant membership milestones",
    description:
      "Grants Creator Points for membership anniversaries and any milestone a hook missed (idempotent; never for consents or credit).",
    everyMinutes: 1_440,
  },
  {
    type: "provider_health_check",
    label: "Provider health checks",
    description: "Checks every enabled provider configuration.",
    everyMinutes: 5,
  },
];

/** Exponential backoff: 30s, 1m, 2m, 4m … capped at 1h. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);
}

/** Dedupe key for a schedule's current window, so overlapping ticks enqueue once. */
export function scheduleWindowKey(schedule: JobSchedule, now: Date): string {
  const windowMs = schedule.everyMinutes * 60_000;
  const start = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  return `${schedule.type}:${start.toISOString()}`;
}

/**
 * Error text kept on a job: class and a short message, never a payload. Query
 * errors are reduced to the database's own message (their text carries
 * parameters).
 */
export function describeJobError(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown error";
  const root = error.message.startsWith("Failed query") && error.cause instanceof Error ? error.cause : error;
  const message = root.message.split(/\bparams:/)[0] ?? "";
  return redactLogText(`${root.name}: ${message}`).replace(/\s+/g, " ").trim().slice(0, 300);
}
