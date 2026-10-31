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
