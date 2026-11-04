import { and, desc, inArray } from "drizzle-orm";

import { creatorSocialSnapshots } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { verifiedWorkForPassport } from "@/modules/brand-work/portfolio";
import { INDUSTRY_LABELS } from "@/modules/brand-work/presentation";
import { approvedLogoBrandIds } from "@/modules/brand-orgs/logos";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { listCategories, listPlatforms, getOnboardingState } from "@/modules/creator-profile/queries";
import { LANGUAGES } from "@/modules/creator-profile/reference";
import { getCreatorStatus } from "@/modules/creator-status/status-service";
import { CREATOR_STATUS_LABELS } from "@/modules/creator-status/status";
import { brandFeatures, brandPortfolio, type FeatureKey } from "@/modules/professional-graph/engine";
import { getLatestProfessionalGraph } from "@/modules/professional-graph/graph-service";

import type { PassportSource } from "./view";

/**
 * Assembles the raw material for a passport from the creator's own
 * PROFESSIONAL data only (profile, connected accounts, Professional Graph,
 * Creator Status, verified brand work). Nothing here reads the financial
 * domain, offers, eligibility or points — an import-boundary test enforces it.
 * The view model (`view.ts`) then decides what each viewer may see.
 */
export interface PassportSourceOptions {
  /** Count private brand work in totals, industries and badges (never by name). */
  includePrivateInTotals: boolean;
  hasPhoto: boolean;
  bio: string | null;
  now?: Date;
}

export async function loadPassportSource(
  db: DbExecutor,
  input: { userId: string; creatorId: string },
  opts: PassportSourceOptions,
): Promise<PassportSource | null> {
  const now = opts.now ?? new Date();
  const state = await getOnboardingState(db, input.userId);
  const profile = state.profile;
  if (!profile || profile.id !== input.creatorId || profile.profileStatus !== "completed") return null;

  const [categories, platforms] = await Promise.all([listCategories(db), listPlatforms(db)]);
  const categoryLabel = new Map(categories.map((c) => [c.code, c.label]));
  const platformLabel = new Map(platforms.map((p) => [p.code, p.label]));
  const languageLabel = new Map<string, string>(LANGUAGES.map((l) => [l.code, l.label]));

  const connected = state.socialAccounts.filter((a) => a.connectionStatus === "connected");
  const handles = connected
    .sort((a, b) => a.platform.localeCompare(b.platform) || Number(b.isPrimary) - Number(a.isPrimary))
    .map((a) => ({
      platform: a.platform,
      platformLabel: platformLabel.get(a.platform) ?? a.platform,
      handle: a.handle,
    }));

  // Graph-derived values only while the creator's professional-analytics consent is on.
  const signalsConsent = await hasValidConsent(db, input.userId, CONSENT_KEYS.professionalAnalytics, now);
  const graph = signalsConsent ? await getLatestProfessionalGraph(db, profile.id) : null;
  const feature = (key: FeatureKey) => {
    const v = graph?.features.find((f) => f.key === key)?.value;
    return typeof v === "number" ? v : typeof v === "boolean" ? v : null;
  };
  const signalsAvailable = Boolean(graph);

  // Latest audience per connected account (followers or subscribers).
  const followers: PassportSource["followers"] = [];
  if (signalsAvailable && connected.length) {
    const snaps = await db
      .select({
        accountId: creatorSocialSnapshots.socialAccountId,
        followers: creatorSocialSnapshots.followers,
        subscribers: creatorSocialSnapshots.subscribers,
        capturedAt: creatorSocialSnapshots.capturedAt,
      })
      .from(creatorSocialSnapshots)
      .where(
        and(
          inArray(
            creatorSocialSnapshots.socialAccountId,
            connected.map((a) => a.id),
          ),
        ),
      )
      .orderBy(desc(creatorSocialSnapshots.capturedAt));
    for (const a of connected) {
      const latest = snaps.find((s) => s.accountId === a.id);
      followers.push({
        platform: a.platform,
        platformLabel: platformLabel.get(a.platform) ?? a.platform,
        count: latest ? (latest.followers ?? latest.subscribers ?? null) : null,
      });
    }
  }

  // Verified brand work: names only from non-private records; totals honour the creator's private-work choice.
  const work = await verifiedWorkForPassport(db, profile.id);
  const counted = opts.includePrivateInTotals ? work : work.filter((r) => r.visibility !== "private");
  const named = brandPortfolio(work, { includePrivate: false });
  const logos = await approvedLogoBrandIds(
    db,
    named.map((b) => b.brandDirectoryId),
  );
  const features = brandFeatures({
    asOf: now.toISOString(),
    creatorSince: null,
    declaredPlatforms: [],
    accounts: [],
    brandWork: counted,
  });
  const bf = (key: FeatureKey) => {
    const v = features.find((f) => f.key === key)?.value;
    return typeof v === "number" ? v : null;
  };

  const status = signalsAvailable ? await getCreatorStatus(db, profile.id) : null;
  const longevityMonths = feature("professional_longevity_months");
  const spike = feature("follower_spike_detected");
  const mismatches = feature("handle_mismatches");

  return {
    asOfMonth: graph ? graph.computedAt.toISOString().slice(0, 7) : null,
    profile: { displayName: profile.displayName, bio: opts.bio, hasPhoto: opts.hasPhoto },
    handles,
    followers,
    categories: [profile.creatorCategory, ...state.additionalCategories]
      .filter((c): c is string => Boolean(c))
      .map((c) => categoryLabel.get(c) ?? c),
    languages: [...profile.languages.map((c) => languageLabel.get(c) ?? c), ...(profile.languagesOther ?? [])],
    city: profile.city,
    longevityYears: typeof longevityMonths === "number" ? Math.floor(longevityMonths / 12) : null,
    badges: {
      identityVerified: profile.legalNameSource === "verified_lookup",
      accountsConnected: connected.length > 0,
      brandWorkVerified: counted.length > 0,
      paymentConfirmed: counted.some((r) => r.paymentConfirmed),
    },
    industries: [...new Set(counted.map((r) => INDUSTRY_LABELS[r.industry] ?? r.industry))].sort(),
    creatorStatus: status?.basis === "signals" ? CREATOR_STATUS_LABELS[status.tier] : null,
    brands: named.map((b) => ({
      directoryId: b.brandDirectoryId,
      name: b.displayName,
      industry: INDUSTRY_LABELS[b.industry] ?? b.industry,
      collaborations: b.collaborations,
      lastMonth: b.lastMonth,
      hasLogo: logos.has(b.brandDirectoryId),
    })),
    brandNumbers: counted.length
      ? {
          verifiedBrands: bf("verified_brand_count") ?? 0,
          collaborations12m: bf("verified_collaborations_12m") ?? 0,
          repeatBrands: bf("repeat_brand_count") ?? 0,
          recurrenceRate: bf("brand_recurrence_rate"),
          tenureMonths: bf("brand_tenure_months"),
          agencyShare: bf("agency_mediated_share"),
          paymentConfirmationRate: bf("payment_confirmation_rate"),
        }
      : null,
    audience: signalsAvailable
      ? {
          engagementRate:
            typeof feature("engagement_rate_3m") === "number" ? (feature("engagement_rate_3m") as number) : null,
          growthStability:
            typeof feature("growth_stability") === "number" ? (feature("growth_stability") as number) : null,
          authenticity:
            spike === null && mismatches === null
              ? null
              : spike === true || (typeof mismatches === "number" && mismatches > 0)
                ? "attention"
                : "pass",
        }
      : null,
    deals: counted.some((r) => r.amountPaise !== null)
      ? {
          highest: bf("highest_verified_deal"),
          median12m: bf("median_verified_deal_12m"),
          billings12m: bf("verified_brand_billings_12m"),
          growth12mPercent: bf("deal_value_growth_12m"),
          topClientShare12m: bf("top_brand_revenue_share_12m"),
        }
      : null,
    signalsAvailable,
  };
}
