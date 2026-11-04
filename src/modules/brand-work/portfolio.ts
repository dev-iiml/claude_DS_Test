import { and, count, eq, isNotNull } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { brandDirectory, brandWorkRecords } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { brandPortfolio, type PortfolioBrand } from "@/modules/professional-graph/engine";
import { runProfessionalGraph } from "@/modules/professional-graph/graph-service";

/**
 * "Brands you've worked with" — verified records only, no amounts. Private
 * (NDA) records count in the aggregate signals but are never listed by name
 * outside the creator's own records view.
 */
export async function portfolioForCreator(db: DbExecutor, creatorId: string): Promise<PortfolioBrand[]> {
  const rows = await db
    .select({
      id: brandWorkRecords.id,
      brandId: brandWorkRecords.brandDirectoryId,
      brandName: brandDirectory.canonicalName,
      industry: brandWorkRecords.industryCode,
      billedPartyType: brandWorkRecords.billedPartyType,
      deliverables: brandWorkRecords.deliverables,
      workDate: brandWorkRecords.workDate,
      paymentStatus: brandWorkRecords.paymentStatus,
      visibility: brandWorkRecords.visibility,
    })
    .from(brandWorkRecords)
    .innerJoin(brandDirectory, eq(brandDirectory.id, brandWorkRecords.brandDirectoryId))
    .where(
      and(
        eq(brandWorkRecords.creatorId, creatorId),
        eq(brandWorkRecords.verificationStatus, "verified"),
        isNotNull(brandWorkRecords.brandDirectoryId),
      ),
    );
  return brandPortfolio(
    rows.map((r) => ({
      id: r.id,
      brandId: r.brandId!,
      brandName: r.brandName,
      industry: r.industry ?? "other",
      billedPartyType: r.billedPartyType,
      deliverables: r.deliverables,
      workMonth: r.workDate.slice(0, 7),
      amountPaise: null, // never in the portfolio
      paymentConfirmed: r.paymentStatus === "confirmed",
      confirmationMonth: null,
      visibility: r.visibility,
    })),
    { includePrivate: false },
  );
}

/** Partnerships desk (Access requests): counts and the non-private portfolio. No documents, amounts or methods. */
export async function partnershipsBrandSummary(db: DbExecutor, creatorId: string) {
  const [verified] = await db
    .select({ n: count() })
    .from(brandWorkRecords)
    .where(and(eq(brandWorkRecords.creatorId, creatorId), eq(brandWorkRecords.verificationStatus, "verified")));
  const [confirmed] = await db
    .select({ n: count() })
    .from(brandWorkRecords)
    .where(
      and(
        eq(brandWorkRecords.creatorId, creatorId),
        eq(brandWorkRecords.verificationStatus, "verified"),
        eq(brandWorkRecords.paymentStatus, "confirmed"),
      ),
    );
  const portfolio = await portfolioForCreator(db, creatorId);
  return {
    verifiedRecords: Number(verified?.n ?? 0),
    anyPaymentConfirmed: Number(confirmed?.n ?? 0) > 0,
    // Never the confirmation state per brand: names, industries and counts only.
    brands: portfolio.map((b) => ({
      name: b.displayName,
      industry: b.industry,
      collaborations: b.collaborations,
      firstMonth: b.firstMonth,
      lastMonth: b.lastMonth,
    })),
  };
}

/** Recomputes the creator's Professional Graph after a verification change (only with professional analytics on). */
export async function refreshGraphForRecord(db: Database, recordId: string) {
  const [r] = await db
    .select({ userId: brandWorkRecords.userId, creatorId: brandWorkRecords.creatorId })
    .from(brandWorkRecords)
    .where(eq(brandWorkRecords.id, recordId));
  if (!r) return;
  await runProfessionalGraph(db, { userId: r.userId, creatorId: r.creatorId, trigger: "system" });
}

/**
 * Verified brand work for the Verified Creator Passport (Stage 19), with each record's visibility. Amounts are
 * returned so the passport can show creator-chosen BANDS; the passport module never renders a figure.
 */
export async function verifiedWorkForPassport(db: DbExecutor, creatorId: string) {
  const rows = await db
    .select({
      id: brandWorkRecords.id,
      brandId: brandWorkRecords.brandDirectoryId,
      brandName: brandDirectory.canonicalName,
      industry: brandWorkRecords.industryCode,
      billedPartyType: brandWorkRecords.billedPartyType,
      deliverables: brandWorkRecords.deliverables,
      workDate: brandWorkRecords.workDate,
      amountPaise: brandWorkRecords.invoiceAmountPaise,
      paymentStatus: brandWorkRecords.paymentStatus,
      paymentMethod: brandWorkRecords.paymentConfirmationMethod,
      confirmedMonth: brandWorkRecords.paymentConfirmedMonth,
      visibility: brandWorkRecords.visibility,
    })
    .from(brandWorkRecords)
    .innerJoin(brandDirectory, eq(brandDirectory.id, brandWorkRecords.brandDirectoryId))
    .where(
      and(
        eq(brandWorkRecords.creatorId, creatorId),
        eq(brandWorkRecords.verificationStatus, "verified"),
        isNotNull(brandWorkRecords.brandDirectoryId),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    brandId: r.brandId!,
    brandName: r.brandName,
    industry: r.industry ?? "other",
    billedPartyType: r.billedPartyType,
    deliverables: r.deliverables,
    workMonth: r.workDate.slice(0, 7),
    amountPaise: r.amountPaise,
    // A payment confirmed from the creator's shared bank data (`aa_match`) never shows on a public page: the passport
    // counts agency and remittance-advice confirmations only, so nothing derived from bank data is published.
    paymentConfirmed: r.paymentStatus === "confirmed" && r.paymentMethod !== "aa_match",
    confirmationMonth: r.confirmedMonth && r.paymentMethod !== "aa_match" ? r.confirmedMonth.slice(0, 7) : null,
    visibility: r.visibility,
  }));
}
