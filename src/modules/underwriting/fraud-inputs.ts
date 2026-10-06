import { and, count, countDistinct, eq, gte, isNotNull, isNull, ne } from "drizzle-orm";

import { creatorProfiles, creatorSocialAccounts, creditApplications } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { nameMatchScore, type FraudInputs } from "@/modules/fraud/rules";
import { getIdentityPrefill } from "@/modules/identity/identity-prefill";

import type { FeatureSnapshot } from "./model";

/**
 * Gathers the fraud layer's inputs for a check (Stage 11). Everything is
 * reduced to counts, ratios and flags before it leaves this function — names,
 * PAN fingerprints and handles are compared here and never stored with the run.
 *
 * Consent (user decision): identity, duplicate, income, connected-account and
 * velocity checks run under financial eligibility; audience checks use
 * Professional Graph values only when they were allowed into the snapshot
 * (professional-analytics consent).
 */

type App = typeof creditApplications.$inferSelect;

const DAY_MS = 86_400_000;
const normaliseHandle = (h: string) => h.trim().replace(/^@/, "").toLowerCase();

function monthsBetween(earlier: Date, later: Date) {
  return (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 + (later.getUTCMonth() - earlier.getUTCMonth());
}

const asNumber = (v: FeatureSnapshot[string] | undefined) => (typeof v === "number" ? v : null);

export async function buildFraudInputs(
  db: DbExecutor,
  input: {
    app: App;
    snapshot: FeatureSnapshot;
    /** Professional Graph values, present only with professional-analytics consent. */
    graph: FeatureSnapshot | null;
    now: Date;
  },
): Promise<FraudInputs> {
  const { app, snapshot, graph, now } = input;

  const [profile] = await db
    .select({ legalName: creatorProfiles.legalName, creatorSince: creatorProfiles.creatorSince })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.id, app.creatorId))
    .limit(1);
  const lookup = await getIdentityPrefill(db, app.userId);

  let sharedPan: number | null = null;
  let changedPan: number | null = null;
  if (app.panFingerprint) {
    const [shared] = await db
      .select({ n: countDistinct(creditApplications.userId) })
      .from(creditApplications)
      .where(
        and(
          eq(creditApplications.panFingerprint, app.panFingerprint),
          ne(creditApplications.userId, app.userId),
          isNull(creditApplications.inputsErasedAt),
        ),
      );
    const [changed] = await db
      .select({ n: countDistinct(creditApplications.panFingerprint) })
      .from(creditApplications)
      .where(
        and(
          eq(creditApplications.userId, app.userId),
          ne(creditApplications.id, app.id),
          isNotNull(creditApplications.panFingerprint),
          ne(creditApplications.panFingerprint, app.panFingerprint),
          isNull(creditApplications.inputsErasedAt),
        ),
      );
    sharedPan = shared?.n ?? 0;
    changedPan = changed?.n ?? 0;
  }

  const accounts = await db
    .select({
      handle: creatorSocialAccounts.handle,
      declaredHandle: creatorSocialAccounts.declaredHandle,
      accountCreatedAt: creatorSocialAccounts.accountCreatedAt,
    })
    .from(creatorSocialAccounts)
    .where(
      and(eq(creatorSocialAccounts.creatorId, app.creatorId), eq(creatorSocialAccounts.connectionStatus, "connected")),
    );
  const handleMismatches = accounts.length
    ? accounts.filter((a) => a.declaredHandle && normaliseHandle(a.declaredHandle) !== normaliseHandle(a.handle)).length
    : null;
  const oldest = accounts
    .map((a) => a.accountCreatedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const tenureGap =
    oldest && profile?.creatorSince
      ? Math.max(0, monthsBetween(new Date(`${profile.creatorSince}T00:00:00Z`), oldest))
      : null;

  const [recent] = await db
    .select({ n: count() })
    .from(creditApplications)
    .where(
      and(
        eq(creditApplications.userId, app.userId),
        gte(creditApplications.createdAt, new Date(now.getTime() - 90 * DAY_MS)),
      ),
    );

  const spike = graph?.follower_spike_detected;
  return {
    identity_name_match: lookup && profile ? nameMatchScore(profile.legalName, lookup.verifiedName) : null,
    pan_shared_with_other_accounts: sharedPan,
    pan_changes_across_checks: changedPan,
    declared_to_observed_income: asNumber(snapshot.declared_to_observed_income),
    connected_handle_mismatches: handleMismatches,
    declared_tenure_gap_months: tenureGap,
    follower_spike_detected: typeof spike === "boolean" ? spike : null,
    engagement_rate_3m: graph ? asNumber(graph.engagement_rate_3m) : null,
    total_audience: graph ? asNumber(graph.total_audience) : null,
    applications_90d: recent?.n ?? 0,
  };
}
