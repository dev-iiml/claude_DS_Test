import { and, eq, gt, inArray, isNotNull, lte, max, min } from "drizzle-orm";

import { cashflowAccounts, consentDefinitions, consentReceipts, creditApplications, fiTransactions } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { isFeatureEnabled } from "@/modules/integrations/change-service";

import { openFiText } from "./fi-data-protection";
import { PAYMENT_MATCH_RULES_VERSION, matchPayment, type MatchCredit } from "./payment-match-rules";
import type { BrandPaymentMatchOutcome } from "./payment-match-types";

/**
 * Brand payment match (Stage 18). Runs INSIDE the regulated financial domain
 * over AA line items CreatorCo already holds for an active check, within
 * their data-life. Never triggers a new AA fetch. Only `{ result, month }`
 * leaves this module — no amount, payer, narration, account or line item.
 * Missing or expired data is `unknown`, never `not_seen`.
 */
/** Checks the creator has confirmed on Review (a draft's data isn't used for anything). */
const ACTIVE_CHECK = ["inputs_ready", "submitted"] as const;

export async function matchBrandPayment(
  deps: { db: DbExecutor; now?: Date },
  input: {
    userId: string;
    brandWorkRecordId: string;
    expectedAmountPaise: number;
    invoiceDate: string;
    /** The billed party's name: who pays the creator. */
    payerName: string;
  },
): Promise<BrandPaymentMatchOutcome> {
  const now = deps.now ?? new Date();
  const { db } = deps;
  const allowed =
    (await isFeatureEnabled(db, "brand_payment_match")) &&
    (await hasValidConsent(db, input.userId, CONSENT_KEYS.brandPaymentMatch, now)) &&
    (await hasValidConsent(db, input.userId, CONSENT_KEYS.brandWorkRecords, now));
  if (!allowed) return { result: "unknown", month: null };

  const accounts = await db
    .select({
      id: cashflowAccounts.id,
      applicationId: cashflowAccounts.applicationId,
      periodFrom: cashflowAccounts.periodFrom,
      periodTo: cashflowAccounts.periodTo,
    })
    .from(cashflowAccounts)
    .innerJoin(creditApplications, eq(creditApplications.id, cashflowAccounts.applicationId))
    .where(
      and(
        eq(creditApplications.userId, input.userId),
        inArray(creditApplications.status, [...ACTIVE_CHECK]),
        eq(cashflowAccounts.transactionsRetained, true),
        gt(cashflowAccounts.dataLifeUntil, now),
      ),
    );
  let credits: MatchCredit[] | null = null;
  // The span the statements cover: only a fully covered window can say "not seen".
  const froms = accounts.map((a) => a.periodFrom).filter((d): d is string => d !== null);
  const tos = accounts.map((a) => a.periodTo).filter((d): d is string => d !== null);
  const coverage =
    froms.length === accounts.length && tos.length === accounts.length && accounts.length
      ? { from: [...froms].sort()[0]!, to: [...tos].sort().at(-1)! }
      : null;
  if (accounts.length) {
    const rows = await db
      .select({
        applicationId: fiTransactions.applicationId,
        bookedOn: fiTransactions.bookedOn,
        amount: fiTransactions.amount,
        narration: fiTransactions.narrationSealed,
        counterparty: fiTransactions.counterpartySealed,
      })
      .from(fiTransactions)
      .where(
        and(
          inArray(
            fiTransactions.accountId,
            accounts.map((a) => a.id),
          ),
          eq(fiTransactions.direction, "credit"),
          gt(fiTransactions.dataLifeUntil, now),
        ),
      );
    // Decrypted in memory only, for the comparison; nothing is returned or logged.
    credits = rows.map((r) => ({
      bookedOn: r.bookedOn,
      amountPaise: Math.round(Number(r.amount) * 100),
      payerText: `${r.counterparty ? openFiText(r.counterparty, r.applicationId) : ""} ${openFiText(r.narration, r.applicationId)}`,
    }));
  }
  const outcome = matchPayment({
    invoiceDate: input.invoiceDate,
    expectedAmountPaise: input.expectedAmountPaise,
    payerName: input.payerName,
    credits,
    coverage,
  });
  await recordAuditEvent(db, {
    actorType: "system",
    eventType: "fin.brand_payment_match",
    entityType: "brand_work_record",
    entityId: input.brandWorkRecordId,
    metadata: { result: outcome.result, rules_version: PAYMENT_MATCH_RULES_VERSION },
  });
  return outcome;
}

/**
 * Neutral reminders (Stage 18) for creators who chose brand payment checks:
 * their shared bank data's permitted period ends within 7 days, or ended in
 * the last 30 days with nothing current. Dates only — no amounts or accounts.
 */
export async function bankDataPermissionNotices(
  db: DbExecutor,
  now = new Date(),
): Promise<{ userId: string; kind: "aa_consent_ending" | "aa_data_life_ended"; onDate: string }[]> {
  const chose = await db
    .selectDistinct({ userId: consentReceipts.userId })
    .from(consentReceipts)
    .innerJoin(consentDefinitions, eq(consentDefinitions.id, consentReceipts.consentDefinitionId))
    .where(and(eq(consentDefinitions.key, CONSENT_KEYS.brandPaymentMatch), eq(consentReceipts.status, "granted")));
  if (!chose.length) return [];
  const life = await db
    .select({
      userId: creditApplications.userId,
      soonest: min(cashflowAccounts.dataLifeUntil),
      latest: max(cashflowAccounts.dataLifeUntil),
    })
    .from(cashflowAccounts)
    .innerJoin(creditApplications, eq(creditApplications.id, cashflowAccounts.applicationId))
    .where(
      and(
        inArray(
          creditApplications.userId,
          chose.map((c) => c.userId),
        ),
        isNotNull(cashflowAccounts.dataLifeUntil),
        lte(cashflowAccounts.dataLifeUntil, new Date(now.getTime() + 7 * 86_400_000)),
      ),
    )
    .groupBy(creditApplications.userId);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  type Notice = { userId: string; kind: "aa_consent_ending" | "aa_data_life_ended"; onDate: string };
  return life.flatMap((l): Notice[] => {
    if (!l.latest || !l.soonest) return [];
    if (l.latest.getTime() > now.getTime())
      return [{ userId: l.userId, kind: "aa_consent_ending" as const, onDate: day(l.soonest) }];
    if (now.getTime() - l.latest.getTime() <= 30 * 86_400_000)
      return [{ userId: l.userId, kind: "aa_data_life_ended" as const, onDate: day(l.latest) }];
    return [];
  });
}
