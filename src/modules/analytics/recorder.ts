import { and, eq, inArray, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { analyticsEvents, consentReceipts, users } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { isDevOrTest } from "@/lib/app-env";
import { describeError, logger } from "@/lib/logger";
import { CONSENT_KEYS, findValidReceipt, hasValidConsent } from "@/modules/consent";

import {
  ANALYTICS_EVENTS,
  FINANCIAL_FUNNEL_EVENTS,
  parseEventProps,
  type AnalyticsEvent,
  type EventProps,
} from "./events";
import { analyticsSubject, analyticsSubjects } from "./pseudonym";

/**
 * Records one analytics event, first-party (Stage 15). Server-side only; call
 * it inside the transaction that makes the change, so an event exists only if
 * the action committed. It never breaks the action: everything after property
 * validation runs in its own savepoint, and any failure there is logged (event
 * name and error name only) and dropped.
 *
 * - `essential` events: every member (pseudonymous service measurement);
 * - `optional` events: only with the "Product analytics" consent — the receipt
 *   is locked while recording, so a concurrent withdrawal either sees the event
 *   (and erases it) or the event sees the withdrawal (and isn't recorded);
 * - staff accounts are never recorded; test accounts are flagged `internal`;
 * - `once` events are unique per subject (DB-enforced).
 *
 * Analytics never reads the `fin` schema; events carry no personal or financial
 * data (strict per-event schemas + FORBIDDEN_PROP_KEYS) and no timestamp.
 */
export type RecordOutcome = "recorded" | "no_consent" | "staff" | "duplicate" | "failed";

export interface RecordEventInput<E extends AnalyticsEvent> {
  event: E;
  /** Required for `user` events; must be absent for `anonymous` ones. */
  userId?: string | null;
  props?: EventProps<E>;
  now?: Date;
}

/** India-time calendar day (YYYY-MM-DD) — the only time an event records. */
export function analyticsDay(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function internalSuffixes(): string[] {
  return (process.env.ANALYTICS_INTERNAL_EMAIL_SUFFIXES ?? ".test")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const strict = () => isDevOrTest();

class Skip extends Error {
  constructor(readonly outcome: RecordOutcome) {
    super(outcome);
  }
}

export async function recordEvent<E extends AnalyticsEvent>(
  db: DbExecutor,
  input: RecordEventInput<E>,
): Promise<RecordOutcome> {
  const def = ANALYTICS_EVENTS[input.event];
  const now = input.now ?? new Date();
  let props: Record<string, string | boolean | null>;
  try {
    if (def.subject === "user" && !input.userId) throw new Error(`analytics: ${input.event} needs a user`);
    if (def.subject === "anonymous" && input.userId) throw new Error(`analytics: ${input.event} is anonymous`);
    props = parseEventProps(input.event, input.props ?? {});
  } catch (error) {
    // A malformed event is a programming error: loud in development and tests, dropped in production.
    if (strict()) throw error;
    logger.error("analytics.invalid_event", { event: input.event });
    return "failed";
  }

  try {
    // Its own savepoint (or transaction): nothing here can abort the caller's transaction.
    return await (db as Database).transaction(async (sp) => {
      let subject: string | null = null;
      let internal = false;
      if (def.subject === "user") {
        const [user] = await sp
          .select({ role: users.role, email: users.email })
          .from(users)
          .where(eq(users.id, input.userId!));
        if (!user || user.role !== "creator") throw new Skip("staff");
        const email = user.email.toLowerCase();
        internal = internalSuffixes().some((s) => email.endsWith(s));
        if (def.tier === "optional") {
          const receipt = await findValidReceipt(sp, input.userId!, CONSENT_KEYS.productAnalytics, now);
          const [held] = receipt
            ? await sp
                .select({ id: consentReceipts.id })
                .from(consentReceipts)
                .where(and(eq(consentReceipts.id, receipt.id), eq(consentReceipts.status, "granted")))
                .for("share")
            : [];
          if (!held) throw new Skip("no_consent");
        }
        // Eligibility/offer steps exist only while the financial-eligibility consent does (they're erased with it).
        if (
          (FINANCIAL_FUNNEL_EVENTS as readonly string[]).includes(input.event) &&
          !(await hasValidConsent(sp, input.userId!, CONSENT_KEYS.financialEligibility, now))
        )
          throw new Skip("no_consent");
        subject = analyticsSubject(input.userId!);
      }
      const rows = await sp
        .insert(analyticsEvents)
        .values({
          event: input.event,
          eventVersion: def.version,
          tier: def.tier,
          subject,
          props,
          internal,
          day: analyticsDay(now),
        })
        .onConflictDoNothing()
        .returning({ id: analyticsEvents.id });
      return rows.length ? "recorded" : "duplicate";
    });
  } catch (error) {
    if (error instanceof Skip) return error.outcome;
    // Error name only: a database message can echo the row's values.
    logger.error("analytics.record_failed", { event: input.event, error: describeError(error).name });
    return "failed";
  }
}

async function eraseEvents(
  tx: DbExecutor,
  input: { userId: string; before?: Date },
  filter: ReturnType<typeof and>,
): Promise<number> {
  await tx.execute(sql`set local creatorco.erasure = 'on'`);
  const rows = await tx
    .delete(analyticsEvents)
    .where(
      and(
        inArray(analyticsEvents.subject, analyticsSubjects(input.userId)),
        filter,
        input.before ? lte(analyticsEvents.day, analyticsDay(input.before)) : undefined,
      ),
    )
    .returning({ id: analyticsEvents.id });
  await tx.execute(sql`set local creatorco.erasure = 'off'`);
  return rows.length;
}

/**
 * Erases a creator's OPTIONAL (consent-based) events — the `product_analytics`
 * withdrawal — under every pseudonym key. Must run inside a transaction.
 */
export async function eraseOptionalEvents(tx: DbExecutor, input: { userId: string; before?: Date }) {
  return { analytics_events: await eraseEvents(tx, input, eq(analyticsEvents.tier, "optional")) };
}

/**
 * Erases a creator's eligibility and offer funnel events — part of the
 * `financial_eligibility` withdrawal. Must run inside a transaction.
 */
export async function eraseFinancialFunnelEvents(tx: DbExecutor, input: { userId: string; before?: Date }) {
  return {
    analytics_events: await eraseEvents(tx, input, inArray(analyticsEvents.event, [...FINANCIAL_FUNNEL_EVENTS])),
  };
}
