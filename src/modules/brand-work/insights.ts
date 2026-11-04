import { and, count, eq, isNotNull, like, sql } from "drizzle-orm";

import { brandIndustries, brandWorkRecords, brandWorkReversals, creatorPointsLedger } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { MIN_CELL, suppress, type Suppressed } from "@/modules/analytics/suppression";

/**
 * Verified brand work aggregates for `/insights` (Stage 18). Cross-creator
 * only: no creator-level rows, no brand-level amounts, no documents. Every
 * count of people under MIN_CELL is suppressed; deal sizes are banded and
 * shown only for industries with at least MIN_CELL creators.
 */
const n = (v: unknown) => Number(v ?? 0);

/** Distinct creators per bucket, suppressed. */
const creators = (v: unknown) => suppress(n(v));

const DEAL_BANDS = [
  [0, 10_000, "Under ₹10k"],
  [10_000, 50_000, "₹10k–50k"],
  [50_000, 2_00_000, "₹50k–2L"],
  [2_00_000, 10_00_000, "₹2L–10L"],
  [10_00_000, Number.POSITIVE_INFINITY, "₹10L+"],
] as const;

export function dealBand(rupees: number): string {
  return DEAL_BANDS.find(([lo, hi]) => rupees >= lo && rupees < hi)![2];
}

export interface BrandWorkInsights {
  funnel: { label: string; creators: Suppressed }[];
  methods: { method: string; creators: Suppressed }[];
  reviewHours: { median: number | null; p90: number | null; samples: number };
  reasons: { code: string; creators: Suppressed }[];
  flags: { flag: string; creators: Suppressed }[];
  reversalRate: number | null;
  pointsByMilestone: { rule: string; creators: Suppressed }[];
  industries: { label: string; creators: Suppressed; medianDealBand: string | null }[];
  verifiedBrandCount: { bucket: string; creators: Suppressed }[];
}

export async function brandWorkInsights(db: DbExecutor): Promise<BrandWorkInsights> {
  const [f] = await db
    .select({
      created: sql<number>`count(distinct ${brandWorkRecords.creatorId})`,
      submitted: sql<number>`count(distinct ${brandWorkRecords.creatorId}) filter (where ${brandWorkRecords.submittedAt} is not null)`,
      verified: sql<number>`count(distinct ${brandWorkRecords.creatorId}) filter (where ${brandWorkRecords.verificationStatus} = 'verified')`,
      confirmed: sql<number>`count(distinct ${brandWorkRecords.creatorId}) filter (where ${brandWorkRecords.paymentStatus} = 'confirmed')`,
    })
    .from(brandWorkRecords);
  const methods = await db
    .select({
      method: brandWorkRecords.paymentConfirmationMethod,
      c: sql<number>`count(distinct ${brandWorkRecords.creatorId})`,
    })
    .from(brandWorkRecords)
    .where(isNotNull(brandWorkRecords.paymentConfirmationMethod))
    .groupBy(brandWorkRecords.paymentConfirmationMethod);
  const [rt] = await db
    .select({
      median: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from (${brandWorkRecords.verifiedAt} - ${brandWorkRecords.submittedAt})) / 3600)`,
      p90: sql<
        number | null
      >`percentile_cont(0.9) within group (order by extract(epoch from (${brandWorkRecords.verifiedAt} - ${brandWorkRecords.submittedAt})) / 3600)`,
      samples: count(),
    })
    .from(brandWorkRecords)
    .where(and(isNotNull(brandWorkRecords.verifiedAt), isNotNull(brandWorkRecords.submittedAt)));
  const reasons = await db
    .select({ code: brandWorkRecords.reasonCode, c: sql<number>`count(distinct ${brandWorkRecords.creatorId})` })
    .from(brandWorkRecords)
    .where(isNotNull(brandWorkRecords.reasonCode))
    .groupBy(brandWorkRecords.reasonCode);
  const flags = await db.execute<{ flag: string; c: number }>(
    sql`select f as flag, count(distinct creator_id)::int as c from ${brandWorkRecords}, unnest(flags) as f group by f order by c desc`,
  );
  const [rev] = await db
    .select({ approved: count() })
    .from(brandWorkReversals)
    .where(eq(brandWorkReversals.status, "approved"));
  const [ver] = await db
    .select({ c: count(), creators: sql<number>`count(distinct ${brandWorkRecords.creatorId})` })
    .from(brandWorkRecords)
    .where(isNotNull(brandWorkRecords.verifiedAt));
  const points = await db
    .select({ rule: creatorPointsLedger.rule, c: sql<number>`count(distinct ${creatorPointsLedger.creatorId})` })
    .from(creatorPointsLedger)
    .where(and(eq(creatorPointsLedger.entryType, "earn"), like(creatorPointsLedger.rule, "brand_%")))
    .groupBy(creatorPointsLedger.rule);
  const industries = await db
    .select({
      label: brandIndustries.label,
      c: sql<number>`count(distinct ${brandWorkRecords.creatorId})`,
      // The band is shown only when enough different creators entered an amount.
      withAmount: sql<number>`count(distinct ${brandWorkRecords.creatorId}) filter (where ${brandWorkRecords.invoiceAmountPaise} is not null)`,
      median: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${brandWorkRecords.invoiceAmountPaise}) / 100`,
    })
    .from(brandWorkRecords)
    .innerJoin(brandIndustries, eq(brandIndustries.code, brandWorkRecords.industryCode))
    .where(eq(brandWorkRecords.verificationStatus, "verified"))
    .groupBy(brandIndustries.label)
    .orderBy(sql`count(distinct ${brandWorkRecords.creatorId}) desc`);
  const brandCounts = await db.execute<{ bucket: string; c: number }>(
    sql`select case when b = 1 then '1 brand' when b <= 4 then '2–4 brands' when b <= 9 then '5–9 brands' else '10+ brands' end as bucket,
          count(*)::int as c
        from (select creator_id, count(distinct brand_directory_id) as b from ${brandWorkRecords}
              where verification_status = 'verified' and brand_directory_id is not null group by creator_id) t
        group by 1 order by min(b)`,
  );
  const verifiedCount = n(ver?.c);
  return {
    funnel: [
      { label: "Added a record", creators: creators(f?.created) },
      { label: "Submitted", creators: creators(f?.submitted) },
      { label: "Verified", creators: creators(f?.verified) },
      { label: "Payment confirmed", creators: creators(f?.confirmed) },
    ],
    methods: methods.map((m) => ({ method: m.method ?? "unknown", creators: creators(m.c) })),
    reviewHours: {
      // Timing stats only once there are enough reviews not to describe a single record.
      median: n(rt?.samples) >= MIN_CELL && rt?.median !== null ? Math.round(Number(rt!.median)) : null,
      p90: n(rt?.samples) >= MIN_CELL && rt?.p90 !== null ? Math.round(Number(rt!.p90)) : null,
      samples: n(rt?.samples),
    },
    reasons: reasons.map((r) => ({ code: r.code ?? "other", creators: creators(r.c) })),
    flags: [...flags].map((r) => ({ flag: r.flag, creators: creators(r.c) })),
    reversalRate: n(ver?.creators) >= MIN_CELL ? Math.round((n(rev?.approved) / verifiedCount) * 1000) / 10 : null,
    pointsByMilestone: points.map((p) => ({ rule: p.rule ?? "?", creators: creators(p.c) })),
    industries: industries.map((i) => ({
      label: i.label,
      creators: creators(i.c),
      medianDealBand: n(i.withAmount) >= MIN_CELL && i.median !== null ? dealBand(Number(i.median)) : null,
    })),
    verifiedBrandCount: [...brandCounts].map((b) => ({ bucket: b.bucket, creators: creators(b.c) })),
  };
}
