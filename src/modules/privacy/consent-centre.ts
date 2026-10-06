import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { consentDefinitions, consentReceipts, consentWithdrawals, dataErasureRequests } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { selectActiveDefinition } from "@/modules/consent";
import { definitionFingerprint } from "@/modules/consent/fingerprint";

import { PURPOSES, type PurposePolicy } from "./purposes";

/**
 * Consent centre read model: every purpose with its current text, the
 * creator's status and full receipt history. Pure data for web and API.
 */

export type PurposeStatus = "on" | "off" | "needs_review" | "never";

export interface ReceiptView {
  id: string;
  version: number;
  status: "granted" | "withdrawn";
  source: string;
  grantedAt: Date | null;
  withdrawnAt: Date | null;
}

export interface PurposeView {
  policy: PurposePolicy;
  status: PurposeStatus;
  current: { id: string; version: number; title: string; purpose: string; body: string; activeFrom: Date } | null;
  /** Granted receipt for the current version, if any. */
  activeReceipt: ReceiptView | null;
  receipts: ReceiptView[];
  deferredErasures: { scope: string; holdReasons: string[]; requestedAt: Date }[];
}

export function statusFor(receipts: readonly ReceiptView[], currentVersion: number | null): PurposeStatus {
  if (!receipts.length) return "never";
  const granted = receipts.filter((r) => r.status === "granted");
  if (currentVersion !== null && granted.some((r) => r.version === currentVersion)) return "on";
  if (granted.length) return "needs_review";
  return "off";
}

export async function getConsentCentre(db: DbExecutor, userId: string, now = new Date()): Promise<PurposeView[]> {
  const keys = PURPOSES.map((p) => p.key);
  const defs = await db.select().from(consentDefinitions).where(inArray(consentDefinitions.key, keys));
  const receipts = await db
    .select({
      id: consentReceipts.id,
      key: consentDefinitions.key,
      version: consentDefinitions.version,
      status: consentReceipts.status,
      source: consentReceipts.source,
      grantedAt: consentReceipts.grantedAt,
      withdrawnAt: consentReceipts.withdrawnAt,
    })
    .from(consentReceipts)
    .innerJoin(consentDefinitions, eq(consentDefinitions.id, consentReceipts.consentDefinitionId))
    .where(eq(consentReceipts.userId, userId))
    .orderBy(desc(consentReceipts.createdAt));
  const deferred = await db
    .select({
      key: consentWithdrawals.consentKey,
      scope: dataErasureRequests.scope,
      holdReasons: dataErasureRequests.holdReasons,
      requestedAt: dataErasureRequests.requestedAt,
    })
    .from(dataErasureRequests)
    .innerJoin(consentWithdrawals, eq(consentWithdrawals.id, dataErasureRequests.withdrawalId))
    .where(and(eq(dataErasureRequests.userId, userId), eq(dataErasureRequests.status, "deferred")))
    .orderBy(asc(dataErasureRequests.requestedAt));

  return PURPOSES.map((policy) => {
    const current = selectActiveDefinition(defs, policy.key, now);
    const mine: ReceiptView[] = receipts.filter((r) => r.key === policy.key).map(({ key: _key, ...r }) => r);
    return {
      policy,
      status: statusFor(mine, current?.version ?? null),
      current: current
        ? {
            id: current.id,
            version: current.version,
            title: current.title,
            purpose: current.purpose,
            body: current.body,
            activeFrom: current.activeFrom,
          }
        : null,
      activeReceipt: mine.find((r) => r.status === "granted" && r.version === current?.version) ?? null,
      receipts: mine,
      deferredErasures: deferred.filter((d) => d.key === policy.key).map(({ key: _key, ...d }) => d),
    };
  });
}

/** One receipt, with the exact text agreed to and its fingerprint. Owner only. */
export async function getReceipt(db: DbExecutor, input: { userId: string; receiptId: string }) {
  const [row] = await db
    .select({ r: consentReceipts, d: consentDefinitions })
    .from(consentReceipts)
    .innerJoin(consentDefinitions, eq(consentDefinitions.id, consentReceipts.consentDefinitionId))
    .where(and(eq(consentReceipts.id, input.receiptId), eq(consentReceipts.userId, input.userId)))
    .limit(1);
  if (!row) return null;
  const [withdrawal] = await db
    .select({
      reason: consentWithdrawals.reason,
      source: consentWithdrawals.source,
      effects: consentWithdrawals.effects,
    })
    .from(consentWithdrawals)
    .where(eq(consentWithdrawals.receiptId, row.r.id))
    .limit(1);
  return {
    id: row.r.id,
    key: row.d.key,
    version: row.d.version,
    title: row.d.title,
    purpose: row.d.purpose,
    body: row.d.body,
    fingerprint: definitionFingerprint(row.d),
    status: row.r.status,
    source: row.r.source,
    grantedAt: row.r.grantedAt,
    withdrawnAt: row.r.withdrawnAt,
    withdrawal: withdrawal ?? null,
  };
}
