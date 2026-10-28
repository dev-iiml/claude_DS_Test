import { and, desc, eq, inArray, or } from "drizzle-orm";

import { auditEvents, type consentDefinitions, users } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { CONSENT_KEYS, findValidReceipt, getActiveDefinition } from "@/modules/consent";
import { GST_STATUS_OPTIONS, LANGUAGES, LEGAL_FORM_OPTIONS } from "@/modules/creator-profile/reference";
import { getOnboardingState, listCategories, listPlatforms } from "@/modules/creator-profile/queries";
import { getLatestProfessionalGraph } from "@/modules/professional-graph/graph-service";
import { getCreatorStatus } from "@/modules/creator-status/status-service";
import { resolveProvider } from "@/modules/integrations/router";
import { MAX_ACCOUNTS_PER_PLATFORM } from "@/modules/social-data/domain";

/**
 * Creator Passport read model — the creator's own verified professional
 * identity. Pure data, no UI: the web app and future native apps (via
 * `/api/v1/passport`) render the same shape.
 *
 * Restricted fields never appear here: no GSTIN, no PAN, no full mobile
 * number. Nothing in this view is a credit figure.
 */

export type VerificationState = "verified" | "declared" | "attention" | "missing";

export interface PassportVerification {
  key: "mobile" | "legal_name" | "gst" | "social";
  label: string;
  state: VerificationState;
  detail: string;
}

export interface PassportAccount {
  id: string;
  platform: string;
  platformLabel: string;
  handle: string;
  declaredHandle: string | null;
  status: "declared" | "connected" | "pending" | "error";
  connectable: boolean;
  connectedAt: string | null;
  handleDiffers: boolean;
  /** The creator's main account on this platform. */
  isPrimary: boolean;
  /** Whether the platform has more than one active account (show the primary marker). */
  sharesPlatform: boolean;
}

export interface PassportActivity {
  id: string;
  label: string;
  at: string;
}

const ACTIVITY_COPY: Record<string, string> = {
  "auth.signed_up": "Joined CreatorCo",
  "creator_profile.completed": "Completed your Creator Professional Profile",
  "creator_profile.updated": "Updated your Passport",
  "identity.mobile_verified": "Verified your mobile number",
  "identity.prefill_fetched": "Verified your legal name",
  "consent.granted": "Gave a consent",
  "consent.withdrawn": "Withdrew a consent",
  "social.account_connected": "Connected a social account",
  "social.account_disconnected": "Disconnected a social account",
  "professional_graph.computed": "Professional signals updated",
};

/** "CC 1A2B 3C4D" — a display number derived from the profile id; not an account number. */
export function memberNumberFor(creatorId: string): string {
  const hex = creatorId.replace(/-/g, "").slice(-8).toUpperCase();
  return `CC ${hex.slice(0, 4)} ${hex.slice(4)}`;
}

const monthYear = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

export async function getPassport(db: DbExecutor, userId: string) {
  const state = await getOnboardingState(db, userId);
  const { profile, preferences, socialAccounts, additionalCategories, gstRegistration } = state;
  if (!profile || profile.profileStatus !== "completed") return null;

  const [user] = await db
    .select({ mobileVerifiedAt: users.mobileVerifiedAt, mobile: users.mobile, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [categories, platforms] = await Promise.all([listCategories(db), listPlatforms(db)]);
  const categoryLabel = new Map(categories.map((c) => [c.code, c.label]));
  const platformLabel = new Map(platforms.map((p) => [p.code, p.label]));
  const { provider: social } = await resolveProvider(
    { db, production: process.env.APP_ENV === "production" },
    "social",
  );
  const connectable = new Set<string>(social.supportedPlatforms());
  const languageLabel = new Map<string, string>(LANGUAGES.map((l) => [l.code, l.label]));

  const active = socialAccounts.filter((a) => a.connectionStatus !== "disconnected");
  const perPlatform = new Map<string, number>();
  for (const a of active) perPlatform.set(a.platform, (perPlatform.get(a.platform) ?? 0) + 1);
  const accounts: PassportAccount[] = active
    .sort(
      (x, y) =>
        x.platform.localeCompare(y.platform) ||
        Number(y.isPrimary) - Number(x.isPrimary) ||
        (x.connectedAt?.getTime() ?? 0) - (y.connectedAt?.getTime() ?? 0),
    )
    .map((a) => ({
      id: a.id,
      platform: a.platform,
      platformLabel: platformLabel.get(a.platform) ?? a.platform,
      handle: a.handle,
      declaredHandle: a.declaredHandle,
      status: a.connectionStatus as PassportAccount["status"],
      connectable: connectable.has(a.platform),
      connectedAt: a.connectedAt?.toISOString() ?? null,
      handleDiffers:
        a.connectionStatus === "connected" &&
        a.declaredHandle !== null &&
        a.declaredHandle.toLowerCase() !== a.handle.toLowerCase(),
      isPrimary: a.isPrimary,
      sharesPlatform: (perPlatform.get(a.platform) ?? 0) > 1,
    }));
  const connectedCount = accounts.filter((a) => a.status === "connected").length;
  const connectablePlatforms = platforms
    .filter((p) => connectable.has(p.code) && !accounts.some((a) => a.platform === p.code && a.status === "connected"))
    .map((p) => ({
      code: p.code,
      label: p.label,
      declaredHandle: accounts.find((a) => a.platform === p.code)?.handle ?? null,
    }));

  const verifications: PassportVerification[] = [
    user?.mobileVerifiedAt
      ? { key: "mobile", label: "Mobile number", state: "verified", detail: "Verified by one-time code" }
      : { key: "mobile", label: "Mobile number", state: "missing", detail: "Not verified yet" },
    profile.legalNameSource === "verified_lookup"
      ? { key: "legal_name", label: "Legal name", state: "verified", detail: "Matched to your identity records" }
      : { key: "legal_name", label: "Legal name", state: "declared", detail: "Self-declared" },
    gstFor(profile.gstStatus, gstRegistration?.registrationStatus ?? null),
    connectedCount
      ? {
          key: "social",
          label: "Creator activity",
          state: "verified",
          detail: `${connectedCount} connected account${connectedCount === 1 ? "" : "s"}`,
        }
      : {
          key: "social",
          label: "Creator activity",
          state: "declared",
          detail: "Self-declared — connect an account to verify",
        },
  ];

  const [graph, status] = await Promise.all([
    getLatestProfessionalGraph(db, profile.id),
    getCreatorStatus(db, profile.id),
  ]);
  const [analyticsReceipt, analyticsDefinition, connectionDefinition] = await Promise.all([
    findValidReceipt(db, userId, CONSENT_KEYS.professionalAnalytics),
    getActiveDefinition(db, CONSENT_KEYS.professionalAnalytics),
    getActiveDefinition(db, CONSENT_KEYS.socialAccountConnection),
  ]);

  const activity = await recentActivity(
    db,
    userId,
    profile.id,
    accounts.map((a) => a.id),
  );
  const legalForm = LEGAL_FORM_OPTIONS.find((o) => o.value === profile.legalForm)?.label ?? null;
  const gstLabel = GST_STATUS_OPTIONS.find((o) => o.value === profile.gstStatus)?.label ?? null;
  const memberSince = profile.completedAt ?? user?.createdAt ?? new Date();

  return {
    creatorId: profile.id,
    displayName: profile.displayName,
    legalName: profile.legalName,
    handle: profile.primaryCreatorHandle,
    tier: status.tier,
    status,
    memberSince: monthYear.format(memberSince),
    memberNumber: memberNumberFor(profile.id),
    location: [profile.city, profile.state].filter(Boolean).join(", ") || null,
    languages: [...profile.languages.map((c) => languageLabel.get(c) ?? c), ...(profile.languagesOther ?? [])],
    categories: [profile.creatorCategory, ...additionalCategories]
      .filter((c): c is string => Boolean(c))
      .map((code, i) => ({ code, label: categoryLabel.get(code) ?? code, primary: i === 0 })),
    creatorSince: profile.creatorSince,
    business: { legalForm, gstStatus: gstLabel },
    interests: {
      prInterest: preferences?.prInterest ?? false,
      travelInterest: preferences?.travelInterest ?? false,
      brandInterests: preferences?.brandInterests ?? [],
    },
    verifications,
    accounts,
    connectablePlatforms,
    // Platforms with a connected account where another account may be added.
    addablePlatforms: platforms
      .filter(
        (p) =>
          connectable.has(p.code) &&
          accounts.some((a) => a.platform === p.code && a.status === "connected") &&
          (perPlatform.get(p.code) ?? 0) < MAX_ACCOUNTS_PER_PLATFORM,
      )
      .map((p) => ({ code: p.code, label: p.label, declaredHandle: null })),
    // Signals are only shown while the analytics consent is in force.
    graph: analyticsReceipt ? graph : null,
    consents: {
      professionalAnalytics: Boolean(analyticsReceipt),
      analyticsDefinition: analyticsDefinition ? pickDefinition(analyticsDefinition) : null,
      connectionDefinition: connectionDefinition ? pickDefinition(connectionDefinition) : null,
    },
    activity,
  };
}

export type PassportView = NonNullable<Awaited<ReturnType<typeof getPassport>>>;

function pickDefinition(d: typeof consentDefinitions.$inferSelect) {
  return { id: d.id, title: d.title, purpose: d.purpose, body: d.body, version: d.version };
}

function gstFor(declared: string | null, registry: string | null): PassportVerification {
  const base = { key: "gst" as const, label: "GST registration" };
  if (declared === "registered") {
    if (registry === "active") return { ...base, state: "verified", detail: "Active on the GST registry" };
    if (registry === "suspended" || registry === "cancelled") {
      return { ...base, state: "attention", detail: `Registry shows ${registry}` };
    }
    return { ...base, state: "declared", detail: "Registered — not yet checked against the registry" };
  }
  if (declared === "not_registered") return { ...base, state: "declared", detail: "Not registered (self-declared)" };
  if (declared === "unknown_requires_review")
    return { ...base, state: "attention", detail: "Unsure — we'll help you confirm" };
  return { ...base, state: "missing", detail: "Not declared" };
}

async function recentActivity(
  db: DbExecutor,
  userId: string,
  creatorId: string,
  accountIds: string[],
): Promise<PassportActivity[]> {
  const entityIds = [creatorId, ...accountIds];
  const rows = await db
    .select({ id: auditEvents.id, eventType: auditEvents.eventType, createdAt: auditEvents.createdAt })
    .from(auditEvents)
    .where(
      and(
        inArray(auditEvents.eventType, Object.keys(ACTIVITY_COPY)),
        or(eq(auditEvents.actorId, userId), inArray(auditEvents.entityId, entityIds)),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(8);
  return rows.map((r) => ({
    id: r.id,
    label: ACTIVITY_COPY[r.eventType] ?? r.eventType,
    at: r.createdAt.toISOString(),
  }));
}
