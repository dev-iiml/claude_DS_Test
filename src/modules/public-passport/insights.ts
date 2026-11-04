import { and, countDistinct, eq, gte, sql } from "drizzle-orm";

import { brandOrgs, passportAccessLog, passportReports, publicPassports } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { suppress, type Suppressed } from "@/modules/analytics/suppression";

import { FIELD_RULES, normaliseFieldTiers, PASSPORT_FIELDS, type FieldTier, type PassportField } from "./domain";

/**
 * Aggregates for `/insights/passports` (Stage 19). Counts are distinct
 * passports / organisations, suppressed under MIN_CELL. No slugs, no names,
 * no per-passport rows.
 */
export async function passportInsights(db: DbExecutor, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [p] = await db
    .select({
      published: sql<number>`count(*) filter (where ${publicPassports.status} = 'published')::int`,
      brandsAudience: sql<number>`count(*) filter (where ${publicPassports.status} = 'published' and ${publicPassports.audience} = 'code_holders_and_verified_brands')::int`,
      discoverable: sql<number>`count(*) filter (where ${publicPassports.status} = 'published' and ${publicPassports.discoverable})::int`,
      indexable: sql<number>`count(*) filter (where ${publicPassports.status} = 'published' and ${publicPassports.indexable})::int`,
      privateInTotals: sql<number>`count(*) filter (where ${publicPassports.status} = 'published' and ${publicPassports.includePrivateInTotals})::int`,
    })
    .from(publicPassports);
  const unlocks = await db
    .select({ kind: passportAccessLog.kind, n: countDistinct(passportAccessLog.passportId) })
    .from(passportAccessLog)
    .where(gte(passportAccessLog.day, since))
    .groupBy(passportAccessLog.kind);
  const orgs = await db
    .select({ status: brandOrgs.status, n: sql<number>`count(*)::int` })
    .from(brandOrgs)
    .groupBy(brandOrgs.status);
  const [reports] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(passportReports)
    .where(and(eq(passportReports.status, "open")));

  // Field visibility choices across published passports.
  const tiers = await db
    .select({ t: publicPassports.fieldTiers })
    .from(publicPassports)
    .where(eq(publicPassports.status, "published"));
  const fields = PASSPORT_FIELDS.map((field: PassportField) => {
    const counts: Record<FieldTier, number> = { public: 0, unlocked: 0, hidden: 0 };
    for (const r of tiers) counts[normaliseFieldTiers(r.t as Record<string, unknown>)[field]] += 1;
    return {
      field,
      label: FIELD_RULES[field].label,
      allowed: FIELD_RULES[field].allowed,
      counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, suppress(v)])) as Record<
        FieldTier,
        Suppressed
      >,
    };
  });

  const unlocked = (kind: string) => suppress(Number(unlocks.find((u) => u.kind === kind)?.n ?? 0));
  const org = (status: string) => Number(orgs.find((o) => o.status === status)?.n ?? 0);
  return {
    published: suppress(Number(p?.published ?? 0)),
    brandsAudience: suppress(Number(p?.brandsAudience ?? 0)),
    discoverable: suppress(Number(p?.discoverable ?? 0)),
    indexable: suppress(Number(p?.indexable ?? 0)),
    privateInTotals: suppress(Number(p?.privateInTotals ?? 0)),
    unlocks30d: { code: unlocked("code"), brand: unlocked("brand"), lockout: unlocked("lockout") },
    // Organisations are businesses, not people — shown as counts.
    orgs: {
      verified: org("verified"),
      pending: org("pending"),
      suspended: org("suspended"),
      rejected: org("rejected"),
    },
    openReports: Number(reports?.n ?? 0),
    fields,
  };
}
