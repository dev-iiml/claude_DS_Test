import { and, count, eq, inArray, like, or } from "drizzle-orm";

import { brandWorkRecords, creatorPointsLedger } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { earnPoints, lockPointsAccount, reversePoints } from "@/modules/rewards/ledger-service";
import {
  BRAND_PAYMENT_MILESTONES,
  BRAND_WORK_MILESTONES,
  brandPaymentMilestoneRules,
  brandWorkMilestoneRules,
  type EarnRule,
} from "@/modules/rewards/rules";

const BRAND_RULES: EarnRule[] = [
  ...BRAND_WORK_MILESTONES.map((m) => `brand_work_verified_${m}` as EarnRule),
  ...BRAND_PAYMENT_MILESTONES.map((m) => `brand_payment_confirmed_${m}` as EarnRule),
];

/** Set only when an approved reversal removed one verified record. */
export type BrandWorkReversalContext = { reason: string; wasPaymentConfirmed: boolean };

/**
 * Brings brand-work milestone points in line with the creator's verified and
 * payment-confirmed record COUNTS — never an amount, and the payment
 * milestones don't know how a payment was confirmed. Grants milestones newly
 * reached. Points are only ever taken back for an APPROVED reversal, and then
 * only the milestone that record's removal un-reached (one per family): a
 * count that drops for any other reason (consent withdrawal, a payment-match
 * reset) never reverses points. A reversed milestone can be earned again later
 * under a new key. Idempotent.
 */
export async function syncBrandWorkPoints(
  tx: DbExecutor,
  creatorId: string,
  now: Date,
  reversal?: BrandWorkReversalContext,
) {
  await lockPointsAccount(tx, creatorId);
  const [verified] = await tx
    .select({ n: count() })
    .from(brandWorkRecords)
    .where(and(eq(brandWorkRecords.creatorId, creatorId), eq(brandWorkRecords.verificationStatus, "verified")));
  const [confirmed] = await tx
    .select({ n: count() })
    .from(brandWorkRecords)
    .where(
      and(
        eq(brandWorkRecords.creatorId, creatorId),
        eq(brandWorkRecords.verificationStatus, "verified"),
        eq(brandWorkRecords.paymentStatus, "confirmed"),
      ),
    );
  const verifiedCount = Number(verified?.n ?? 0);
  const confirmedCount = Number(confirmed?.n ?? 0);
  const reached = new Set<EarnRule>([
    ...brandWorkMilestoneRules(verifiedCount),
    ...brandPaymentMilestoneRules(confirmedCount),
  ]);
  // The milestones an approved reversal takes back: exactly the threshold the removed record was counted in.
  const toReverse = new Set<EarnRule>();
  if (reversal) {
    const w = BRAND_WORK_MILESTONES.find((m) => m === verifiedCount + 1);
    if (w) toReverse.add(`brand_work_verified_${w}` as EarnRule);
    const p = reversal.wasPaymentConfirmed && BRAND_PAYMENT_MILESTONES.find((m) => m === confirmedCount + 1);
    if (p) toReverse.add(`brand_payment_confirmed_${p}` as EarnRule);
  }

  const entries = await tx
    .select({ type: creatorPointsLedger.entryType, rule: creatorPointsLedger.rule, key: creatorPointsLedger.earnKey })
    .from(creatorPointsLedger)
    .where(
      and(
        eq(creatorPointsLedger.creatorId, creatorId),
        inArray(creatorPointsLedger.rule, BRAND_RULES),
        or(eq(creatorPointsLedger.entryType, "earn"), like(creatorPointsLedger.earnKey, "reverse:%")),
      ),
    );
  const reversed = new Set(entries.filter((e) => e.type === "reverse").map((e) => e.key!.slice("reverse:".length)));
  let granted = 0;
  let reversedCount = 0;
  for (const rule of BRAND_RULES) {
    const earns = entries.filter((e) => e.type === "earn" && e.rule === rule).map((e) => e.key!);
    const active = earns.find((k) => !reversed.has(k));
    if (reached.has(rule) && !active) {
      if (await earnPoints(tx, { creatorId, rule, ref: earns.length, now })) granted += 1;
    } else if (toReverse.has(rule) && !reached.has(rule) && active) {
      const r = await reversePoints(tx, { creatorId, earnKey: active, reason: reversal!.reason, now });
      if (r.reversed > 0 || r.flooredBy > 0) reversedCount += 1;
    }
  }
  return { granted, reversed: reversedCount };
}
