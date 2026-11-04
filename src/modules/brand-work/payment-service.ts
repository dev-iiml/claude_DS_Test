import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { brandWorkRecords } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordEvent } from "@/modules/analytics";
import { recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, grantConsent, hasValidConsent } from "@/modules/consent";
import type { ConsentSource } from "@/modules/consent/domain";
// The ONE function brand-work may call in the financial domain: it returns an enum and a month, nothing else.
import { matchBrandPayment } from "@/modules/financial-eligibility/brand-payment-match";
import type { BrandPaymentMatchResult } from "@/modules/financial-eligibility/payment-match-types";
import { isFeatureEnabled } from "@/modules/integrations/change-service";

import type { ConfirmationMethod } from "./domain";
import { BrandWorkError } from "./errors";
import { syncBrandWorkPoints } from "./points";

/**
 * How a creator asks for a payment to be confirmed. All three options carry
 * equal weight and earn the same points; the bank-data check is offered only
 * when the /ops switch is on, and needs its own optional consent.
 */
export async function bankMatchAvailable(db: DbExecutor) {
  return isFeatureEnabled(db, "brand_payment_match");
}

export async function chooseConfirmation(
  db: Database,
  input: {
    userId: string;
    recordId: string;
    method: ConfirmationMethod;
    /** For `aa_match`: the brand_payment_match consent text the creator agreed to here, if not yet given. */
    consentDefinitionId?: string | null;
    source: ConsentSource;
    now?: Date;
  },
): Promise<{ method: ConfirmationMethod; match?: BrandPaymentMatchResult }> {
  const now = input.now ?? new Date();
  const [r] = await db
    .select()
    .from(brandWorkRecords)
    .where(and(eq(brandWorkRecords.id, input.recordId), eq(brandWorkRecords.userId, input.userId)));
  if (!r) throw new BrandWorkError("not_found");
  if (r.verificationStatus !== "verified")
    throw new BrandWorkError("wrong_state", "Payments can be confirmed once the record is verified.");
  if (r.paymentStatus === "confirmed") throw new BrandWorkError("wrong_state", "This payment is already confirmed.");
  if (!(await hasValidConsent(db, input.userId, CONSENT_KEYS.brandWorkRecords, now)))
    throw new BrandWorkError("consent_required");

  if (input.method !== "aa_match") {
    await db.transaction(async (tx) => {
      await tx
        .update(brandWorkRecords)
        .set({ requestedConfirmation: input.method })
        .where(eq(brandWorkRecords.id, r.id));
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: input.userId,
        eventType: "brand_work.confirmation_requested",
        entityType: "brand_work_record",
        entityId: r.id,
        metadata: { method: input.method },
      });
    });
    return { method: input.method };
  }

  if (!(await bankMatchAvailable(db)))
    throw new BrandWorkError("feature_off", "Checking shared bank data isn't available right now.");
  if (r.invoiceAmountPaise === null || !r.invoiceDate)
    throw new BrandWorkError("invalid", "Add the invoice amount and date to check shared bank data.");
  if (!(await hasValidConsent(db, input.userId, CONSENT_KEYS.brandPaymentMatch, now))) {
    if (!input.consentDefinitionId)
      throw new BrandWorkError("consent_required", "Agree to the bank-data check consent to use this option.");
    try {
      await grantConsent(db, {
        userId: input.userId,
        key: CONSENT_KEYS.brandPaymentMatch,
        consentDefinitionId: input.consentDefinitionId,
        source: input.source,
        metadata: { surface: "brand_work" },
        now,
      });
    } catch {
      throw new BrandWorkError("consent_required", "The consent text has been updated. Reload and review it.");
    }
  }
  const outcome = await matchBrandPayment(
    { db, now },
    {
      userId: input.userId,
      brandWorkRecordId: r.id,
      expectedAmountPaise: r.invoiceAmountPaise,
      invoiceDate: r.invoiceDate,
      payerName: r.billedPartyName,
    },
  );
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(brandWorkRecords).where(eq(brandWorkRecords.id, r.id)).for("update");
    if (!locked || locked.paymentStatus === "confirmed" || locked.verificationStatus !== "verified") return;
    if (outcome.result === "seen" && outcome.month) {
      await tx
        .update(brandWorkRecords)
        .set({
          requestedConfirmation: "aa_match",
          paymentStatus: "confirmed",
          paymentConfirmationMethod: "aa_match",
          paymentConfirmedMonth: outcome.month,
          paymentConfirmedAt: now,
        })
        .where(eq(brandWorkRecords.id, r.id));
      await syncBrandWorkPoints(tx, r.creatorId, now);
      await recordEvent(tx, {
        event: "brand_work_payment_confirmed",
        userId: input.userId,
        now,
      });
    } else {
      // `not_seen` only when data was there to check; `unknown` leaves the payment unconfirmed.
      await tx
        .update(brandWorkRecords)
        .set({
          requestedConfirmation: "aa_match",
          paymentStatus: outcome.result === "not_seen" ? "not_seen" : "unconfirmed",
        })
        .where(eq(brandWorkRecords.id, r.id));
    }
  });
  return { method: "aa_match", match: outcome.result };
}

/**
 * Withdrawal of `brand_payment_match`: payments confirmed by the bank-data
 * check go back to unconfirmed (other methods stay). Earned points stay.
 */
export async function resetBankMatchedPayments(tx: DbExecutor, input: { userId: string }) {
  const rows = await tx
    .update(brandWorkRecords)
    .set({
      paymentStatus: "unconfirmed",
      paymentConfirmationMethod: null,
      paymentConfirmedMonth: null,
      paymentConfirmedAt: null,
      requestedConfirmation: null,
    })
    .where(
      and(
        eq(brandWorkRecords.userId, input.userId),
        sql`(${brandWorkRecords.paymentConfirmationMethod} = 'aa_match' or (${brandWorkRecords.requestedConfirmation} = 'aa_match' and ${brandWorkRecords.paymentStatus} <> 'confirmed'))`,
      ),
    )
    .returning({ id: brandWorkRecords.id });
  return { brand_work_payments_reset: rows.length };
}
