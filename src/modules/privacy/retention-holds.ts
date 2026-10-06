import type { DbExecutor } from "@/db/types";
import type { ErasureScope } from "@/modules/consent/domain";
import { closedLenderCheckIds, lenderRetentionHold } from "@/modules/lending/offer-service";

/**
 * Retention holds defer erasure (never processing stops). Reason codes only —
 * no details of the credit relationship leave the lending domain.
 */
export const RETENTION_HOLD_REASONS = [
  "credit_application_in_progress",
  "credit_facility_active",
  "regulatory_record_retention",
] as const;
export type RetentionHoldReason = (typeof RETENTION_HOLD_REASONS)[number];

export interface RetentionHoldChecker {
  holdsFor(db: DbExecutor, input: { userId: string; scope: ErasureScope; now?: Date }): Promise<RetentionHoldReason[]>;
  /** Checks sent to a lender that are no longer held (relationship closed): erasable after all. */
  releasedApplications?(db: DbExecutor, input: { userId: string; scope: ErasureScope; now?: Date }): Promise<string[]>;
}

/** Holds nothing (tests and tools). */
export const noRetentionHolds: RetentionHoldChecker = {
  async holdsFor() {
    return [];
  },
};

/**
 * Default checker: financial inputs of a check with a partner lender are held
 * while the lender relationship may need them — awaiting a decision, an open
 * offer or an accepted one (the lender's retention rules apply). Declined and
 * expired offers hold nothing (Stage 13). Creator-professional
 * data is not a lender record — underwriting snapshots its features into the
 * financial domain (Stage 10). Which records a lender actually needs, and for
 * how long, is for the partner and counsel to confirm.
 */
export const lendingRetentionHolds: RetentionHoldChecker = {
  async holdsFor(db, { userId, scope, now }) {
    if (scope !== "financial_inputs") return [];
    return (await lenderRetentionHold(db, userId, now)) ? ["credit_application_in_progress"] : [];
  },
  async releasedApplications(db, { userId, scope, now }) {
    if (scope !== "financial_inputs") return [];
    return closedLenderCheckIds(db, userId, now);
  },
};
