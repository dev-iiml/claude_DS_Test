import { eq } from "drizzle-orm";

import { hashPassword } from "@/modules/identity/auth/password";
import { hashApiKey } from "@/modules/partners/credentials";
import { syncMilestonePoints } from "@/modules/rewards/ledger-service";
import { gstinCheckCharacter } from "@/modules/creator-profile/gstin";
import { CONSENT_DEFINITION_SEEDS } from "@/modules/consent/definitions";
import { SELF_DECLARED_PROVIDER } from "@/modules/social-data/domain";
import type { GstStatus, LegalForm, OnboardingStep } from "@/modules/creator-profile/domain";
import type { UserRole } from "@/modules/identity/domain";

import type { Database } from "../create-db";
import {
  auditEvents,
  creatorAdditionalCategories,
  authIdentities,
  consentReceipts,
  creatorPreferences,
  creatorProfiles,
  creatorSocialAccounts,
  partnerApiKeys,
  partners,
  providerConfigs,
  providerRuntime,
  users,
  accessOpportunities,
  brands,
} from "../schema";

/**
 * Deterministic demo dataset. Every person here is FICTIONAL: names are
 * generic, handles end in `.demo`, emails use the reserved `.test` TLD and the
 * GSTIN uses an impossible PAN holder-type character ('Z') so it cannot
 * collide with a real registration. Fixed UUIDs and timestamps make reruns
 * idempotent and outputs reproducible.
 */
const SEED_AT = new Date("2026-09-15T04:30:00.000Z");

/** Fictional GSTIN with a valid check digit (PAN segment ZZZZZ9999Z is not a real holder type). */
export function fictionalGstin(stateCode: string): string {
  const first14 = `${stateCode}ZZZZZ9999Z1Z`;
  return first14 + gstinCheckCharacter(first14);
}

interface DemoCreator {
  n: number;
  email: string;
  legalName: string;
  displayName: string;
  handle: string;
  category: string;
  extraCategories?: string[];
  city: string;
  state: string;
  languages: string[];
  creatorSince: string;
  legalForm: LegalForm;
  gstStatus: GstStatus;
  gstin: string | null;
  platforms: string[];
  lastCompletedStep: OnboardingStep;
  completed: boolean;
  prefs: { pr: boolean; prCategories: string[]; brands: string[]; travel: boolean } | null;
}

export const DEMO_CREATORS: DemoCreator[] = [
  {
    n: 1,
    email: "aarohi.menon@creators.creatorco.test",
    legalName: "Aarohi Menon",
    displayName: "Aarohi Makes",
    handle: "aarohi.makes.demo",
    category: "beauty",
    extraCategories: ["fashion", "lifestyle"],
    city: "Mumbai",
    state: "Maharashtra",
    languages: ["en", "hi", "mr"],
    creatorSince: "2019-06-01",
    legalForm: "individual",
    gstStatus: "not_registered",
    gstin: null,
    platforms: ["instagram", "youtube"],
    lastCompletedStep: "consent",
    completed: true,
    prefs: { pr: true, prCategories: ["beauty", "fashion"], brands: ["beauty", "lifestyle"], travel: false },
  },
  {
    n: 2,
    email: "kabir.sethi@creators.creatorco.test",
    legalName: "Kabir Sethi",
    displayName: "Kabir on the Road",
    handle: "kabir.ontheroad.demo",
    category: "travel",
    extraCategories: ["photography"],
    city: "Jaipur",
    state: "Rajasthan",
    languages: ["en", "hi"],
    creatorSince: "2017-03-01",
    legalForm: "sole_proprietorship",
    gstStatus: "registered",
    gstin: fictionalGstin("08"),
    platforms: ["instagram", "youtube"],
    lastCompletedStep: "consent",
    completed: true,
    prefs: { pr: true, prCategories: ["travel", "photography"], brands: ["travel", "tech"], travel: true },
  },
  {
    n: 3,
    email: "ishita.rao@creators.creatorco.test",
    legalName: "Ishita Rao",
    displayName: "Ishita Cooks",
    handle: "ishita.cooks.demo",
    category: "food",
    city: "Hyderabad",
    state: "Telangana",
    languages: ["te", "en"],
    creatorSince: "2020-11-01",
    legalForm: "individual",
    gstStatus: "unknown_requires_review",
    gstin: null,
    platforms: ["youtube"],
    lastCompletedStep: "consent",
    completed: true,
    prefs: { pr: false, prCategories: [], brands: ["food", "home"], travel: true },
  },
  {
    n: 4,
    email: "dev.malhotra@creators.creatorco.test",
    legalName: "Dev Malhotra",
    displayName: "Dev Builds Tech",
    handle: "devbuildstech.demo",
    category: "tech",
    city: "Bengaluru",
    state: "Karnataka",
    languages: ["en", "kn"],
    creatorSince: "2018-01-01",
    legalForm: "individual",
    gstStatus: "not_registered",
    gstin: null,
    platforms: ["youtube", "linkedin", "x"],
    lastCompletedStep: "consent",
    completed: true,
    prefs: { pr: true, prCategories: ["tech"], brands: ["tech", "education"], travel: false },
  },
  {
    n: 5,
    email: "naina.kapoor@creators.creatorco.test",
    legalName: "Naina Kapoor",
    displayName: "Naina Style Notes",
    handle: "nainastylenotes.demo",
    category: "fashion",
    city: "New Delhi",
    state: "Delhi",
    languages: ["en", "hi"],
    creatorSince: "2021-08-01",
    legalForm: "individual",
    gstStatus: "not_registered",
    gstin: null,
    platforms: ["instagram"],
    lastCompletedStep: "profile",
    completed: false,
    prefs: null,
  },
];

export const DEMO_STAFF: { n: number; email: string; role: UserRole }[] = [
  { n: 101, email: "risk.admin@staff.creatorco.test", role: "risk_admin" },
  // A second risk admin, so simulated-lender policy changes can be approved by someone else.
  { n: 104, email: "risk.approver@staff.creatorco.test", role: "risk_admin" },
  // Two ops admins so maker-checker approvals can be demonstrated.
  { n: 102, email: "ops.admin@staff.creatorco.test", role: "ops_admin" },
  { n: 103, email: "ops.approver@staff.creatorco.test", role: "ops_admin" },
  // Brand partnerships desk (Stage 14): reviews Access requests and manages opportunities.
  { n: 105, email: "partnerships.admin@staff.creatorco.test", role: "partnerships_admin" },
  // Read-only aggregate analytics (Stage 15): /insights only.
  { n: 106, email: "analyst@staff.creatorco.test", role: "analyst" },
];

const uuid = (prefix: string, n: number) => `00000000-0000-4000-${prefix}-${String(n).padStart(12, "0")}`;
export const demoIds = {
  identity: (n: number) => uuid("8001", n),
  user: (n: number) => uuid("8002", n),
  profile: (n: number) => uuid("8003", n),
  social: (n: number, i: number) => uuid("8004", n * 100 + i),
  receipt: (n: number) => uuid("8005", n),
  brand: (n: number) => uuid("8008", n),
  opportunity: (n: number) => uuid("8009", n),
};

export async function seedDemoData(db: Database, password: string) {
  const passwordHash = await hashPassword(password);
  const consentDef = CONSENT_DEFINITION_SEEDS[0];

  return db.transaction(async (tx) => {
    let createdProfiles = 0;
    for (const staff of DEMO_STAFF) {
      await tx
        .insert(authIdentities)
        .values({
          id: demoIds.identity(staff.n),
          email: staff.email,
          passwordHash,
          createdAt: SEED_AT,
          updatedAt: SEED_AT,
        })
        .onConflictDoNothing();
      await tx
        .insert(users)
        .values({
          id: demoIds.user(staff.n),
          authUserId: demoIds.identity(staff.n),
          email: staff.email,
          role: staff.role,
          status: "active",
          createdAt: SEED_AT,
          updatedAt: SEED_AT,
        })
        .onConflictDoNothing();
    }

    for (const c of DEMO_CREATORS) {
      const userId = demoIds.user(c.n);
      const profileId = demoIds.profile(c.n);

      await tx
        .insert(authIdentities)
        .values({ id: demoIds.identity(c.n), email: c.email, passwordHash, createdAt: SEED_AT, updatedAt: SEED_AT })
        .onConflictDoNothing();
      await tx
        .insert(users)
        .values({
          id: userId,
          authUserId: demoIds.identity(c.n),
          email: c.email,
          role: "creator",
          status: "active",
          createdAt: SEED_AT,
          updatedAt: SEED_AT,
        })
        .onConflictDoNothing();

      const [exists] = await tx
        .select({ id: creatorProfiles.id })
        .from(creatorProfiles)
        .where(eq(creatorProfiles.id, profileId));
      if (exists) continue;
      createdProfiles++;

      const reachedBusiness = ["business", "interests", "consent"].includes(c.lastCompletedStep);
      if (c.completed) {
        await tx.insert(consentReceipts).values({
          id: demoIds.receipt(c.n),
          userId,
          consentDefinitionId: consentDef.id,
          status: "granted",
          grantedAt: SEED_AT,
          source: "onboarding",
          metadata: { surface: "seed" },
          createdAt: SEED_AT,
        });
      }
      await tx.insert(creatorProfiles).values({
        id: profileId,
        userId,
        legalName: c.legalName,
        displayName: c.displayName,
        primaryCreatorHandle: c.handle,
        creatorCategory: c.category,
        city: c.city,
        state: c.state,
        country: "IN",
        languages: c.languages,
        creatorSince: c.creatorSince,
        legalForm: reachedBusiness ? c.legalForm : null,
        gstStatus: reachedBusiness ? c.gstStatus : null,
        gstin: reachedBusiness ? c.gstin : null,
        profileStatus: c.completed ? "completed" : "draft",
        lastCompletedStep: c.lastCompletedStep,
        completedAt: c.completed ? SEED_AT : null,
        createdAt: SEED_AT,
        updatedAt: SEED_AT,
      });
      await tx.insert(creatorSocialAccounts).values(
        c.platforms.map((platform, i) => ({
          id: demoIds.social(c.n, i),
          creatorId: profileId,
          platform,
          handle: c.handle,
          declaredHandle: c.handle,
          connectionStatus: "declared" as const,
          provider: SELF_DECLARED_PROVIDER,
          isPrimary: true,
          createdAt: SEED_AT,
          updatedAt: SEED_AT,
        })),
      );
      if (c.extraCategories?.length) {
        await tx
          .insert(creatorAdditionalCategories)
          .values(
            c.extraCategories.map((categoryCode) => ({ creatorId: profileId, categoryCode, createdAt: SEED_AT })),
          );
      }
      if (c.prefs) {
        await tx.insert(creatorPreferences).values({
          creatorId: profileId,
          prInterest: c.prefs.pr,
          preferredCategories: c.prefs.prCategories,
          brandInterests: c.prefs.brands,
          travelInterest: c.prefs.travel,
          createdAt: SEED_AT,
          updatedAt: SEED_AT,
        });
      }
    }

    // Membership milestone points for completed demo members (idempotent: each rule once per creator).
    for (const c of DEMO_CREATORS.filter((d) => d.completed)) {
      await syncMilestonePoints(tx, { userId: demoIds.user(c.n), now: SEED_AT });
    }

    await seedSandboxPartner(tx);
    await seedAccessPreview(tx);

    if (createdProfiles > 0) {
      await tx.insert(auditEvents).values({
        actorType: "system",
        eventType: "seed.demo_loaded",
        entityType: "system",
        metadata: { creators: createdProfiles, staff: DEMO_STAFF.length },
        createdAt: SEED_AT,
      });
    }
    return { createdProfiles };
  });
}

/**
 * Stage 12b sandbox partner (dev/test only): a partner-API lender config
 * `partner_sandbox` (enabled, NOT routed — switch the lender route to it in
 * /ops to use it), the "Sandbox Partner Lender", and one approved test key so
 * `npm run partner:sandbox` works out of the box. The key is public and
 * fictional; test keys never authenticate a live partner.
 */
export const DEMO_PARTNER = {
  id: "00000000-0000-4000-8006-000000000001",
  key: "partner_sandbox",
  lenderKey: "partner_sandbox",
  keyId: "00000000-0000-4000-8007-000000000001",
  apiKey: `cck_test_sandbox1_${"DemoOnlySandboxPartnerKey_NotASecret".padEnd(43, "x")}`,
} as const;

async function seedSandboxPartner(tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) {
  await tx
    .insert(providerConfigs)
    .values({ kind: "lender", key: DEMO_PARTNER.lenderKey, adapter: "partner_api", mode: "sandbox", enabled: true })
    .onConflictDoNothing();
  const [config] = await tx
    .select({ id: providerConfigs.id })
    .from(providerConfigs)
    .where(eq(providerConfigs.key, DEMO_PARTNER.lenderKey));
  if (config) await tx.insert(providerRuntime).values({ configId: config.id }).onConflictDoNothing();
  await tx
    .insert(partners)
    .values({
      id: DEMO_PARTNER.id,
      key: DEMO_PARTNER.key,
      name: "Sandbox Partner Lender",
      environment: "sandbox",
      lenderKey: DEMO_PARTNER.lenderKey,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .onConflictDoNothing();
  await tx
    .insert(partnerApiKeys)
    .values({
      id: DEMO_PARTNER.keyId,
      partnerId: DEMO_PARTNER.id,
      prefix: "cck_test_sandbox1",
      secretHash: hashApiKey(DEMO_PARTNER.apiKey),
      label: "Demo sandbox key (public)",
      scopes: ["proposals:read", "decisions:write", "events:read"],
      status: "active",
      expiresAt: new Date(SEED_AT.getTime() + 10 * 365 * 86_400_000),
      proposedBy: demoIds.user(102),
      proposedAt: SEED_AT,
      decidedBy: demoIds.user(103),
      decidedAt: SEED_AT,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .onConflictDoNothing();
}

/**
 * Stage 14 Access preview: FICTIONAL sample brands and opportunities (names are
 * invented; none is a real company). Fixed ids and dates; requests stay open
 * until 30 Sep 2027.
 */
export const DEMO_BRANDS = [
  { n: 1, name: "Aurel Beauty", category: "Beauty", description: "A fictional skincare and colour house." },
  { n: 2, name: "Northlight Cameras", category: "Photography", description: "A fictional camera and lens maker." },
  { n: 3, name: "Saffron Stay Hotels", category: "Travel", description: "A fictional boutique hotel group." },
  { n: 4, name: "Atelier Nine", category: "Fashion", description: "A fictional ready-to-wear label." },
  { n: 5, name: "Soundfold Live", category: "Music & events", description: "A fictional live-music promoter." },
] as const;

const ACCESS_OPENS = new Date("2026-09-15T04:30:00.000Z");
const ACCESS_CLOSES = new Date("2027-09-30T18:29:00.000Z"); // 23:59 IST

export const DEMO_OPPORTUNITIES = [
  {
    n: 1,
    brand: 1,
    title: "Luxury Beauty Drop",
    kind: "pr_drop",
    category: "Beauty",
    summary: "A curated box from the new autumn skincare line, before launch.",
    details:
      "Receive the full autumn line two weeks before it reaches stores. No posting obligation — share it only if it fits your work.",
    minTier: "member",
    pointsCost: 300,
    seats: 25,
  },
  {
    n: 2,
    brand: 2,
    title: "Camera Creator Programme",
    kind: "programme",
    category: "Photography & film",
    summary: "Three months with a mirrorless kit and a monthly craft session.",
    details:
      "A kit to use for three months (body and two lenses), plus a monthly session with the brand's imaging team. For creators with an established practice.",
    minTier: "onyx",
    pointsCost: 800,
    seats: 10,
  },
  {
    n: 3,
    brand: 3,
    title: "Creator Hotel Weekend",
    kind: "experience",
    category: "Travel",
    summary: "Two nights for two at a heritage property in Udaipur.",
    details:
      "A weekend stay for two with breakfast and a guided city walk. Dates are agreed with the hotel team; travel isn't included.",
    minTier: "onyx",
    pointsCost: 1500,
    seats: 6,
  },
  {
    n: 4,
    brand: 4,
    title: "Fashion Preview",
    kind: "event",
    category: "Fashion",
    summary: "An invitation to the spring collection preview in Mumbai.",
    details: "An evening preview of the spring collection with the design team. One guest per invitation.",
    minTier: "member",
    pointsCost: 0,
    seats: 40,
  },
  {
    n: 5,
    brand: 5,
    title: "Music & Event Access",
    kind: "event",
    category: "Music",
    summary: "Backstage access at a winter festival weekend.",
    details:
      "Two festival passes with backstage access on one evening, and a short conversation with the production team.",
    minTier: "icon",
    pointsCost: 2000,
    seats: 4,
  },
] as const;

/**
 * 50 more FICTIONAL opportunities (n 6–55) so the Access list has enough to filter, sort and page through.
 * Generated deterministically from fixed lists: invented brands, fixed dates, no randomness.
 */
export const EXTRA_DEMO_BRANDS = [
  { n: 6, name: "Monsoon Thread Co", category: "Fashion", description: "A fictional handloom-first apparel label." },
  { n: 7, name: "Pixelgrove Audio", category: "Tech", description: "A fictional headphones and mic maker." },
  {
    n: 8,
    name: "Kesar & Clove Kitchens",
    category: "Food",
    description: "A fictional regional-cuisine restaurant group.",
  },
  { n: 9, name: "Trailmark Outdoors", category: "Travel", description: "A fictional trekking and outdoor gear brand." },
  { n: 10, name: "Lumen Skin Lab", category: "Beauty", description: "A fictional dermatologist-led skincare brand." },
  {
    n: 11,
    name: "Stridewell Fitness",
    category: "Fitness",
    description: "A fictional fitness studio and apparel brand.",
  },
  { n: 12, name: "Quillmere Learning", category: "Education", description: "A fictional online learning platform." },
  { n: 13, name: "Harbourline Stays", category: "Travel", description: "A fictional coastal homestay network." },
  { n: 14, name: "Velvet Reel Studios", category: "Music & events", description: "A fictional indie music label." },
  { n: 15, name: "Orbitnest Gadgets", category: "Tech", description: "A fictional smart-home accessories brand." },
  { n: 16, name: "Saathi Home Living", category: "Home & decor", description: "A fictional home-decor brand." },
  { n: 17, name: "Brewlane Coffee", category: "Food", description: "A fictional specialty coffee roaster." },
] as const;

const EXTRA_TEMPLATES = [
  { kind: "pr_drop", title: "Launch Kit", summary: "A launch kit from the new range, before it reaches stores." },
  { kind: "event", title: "Creator Evening", summary: "An invitation to an evening with the brand team." },
  { kind: "experience", title: "Weekend Experience", summary: "A hosted weekend experience for one, with a guest." },
  { kind: "programme", title: "Creator Programme", summary: "A three-month programme with monthly sessions." },
  { kind: "pr_drop", title: "First Look Box", summary: "A first-look box with samples and a note from the founders." },
] as const;

const EXTRA_TIERS = ["member", "member", "onyx", "member", "icon"] as const;
const EXTRA_COSTS = [0, 150, 300, 500, 800, 1200, 2000] as const;

export const EXTRA_DEMO_OPPORTUNITIES = Array.from({ length: 50 }, (_, i) => {
  const n = 6 + i;
  const brand = EXTRA_DEMO_BRANDS[i % EXTRA_DEMO_BRANDS.length]!;
  const t = EXTRA_TEMPLATES[i % EXTRA_TEMPLATES.length]!;
  // Closing dates spread across Oct 2027 – Mar 2028, after the original five (which stay first when sorting by date).
  const closesAt = new Date(Date.UTC(2027, 9 + (i % 6), 28, 18, 29));
  // Every tenth opens later, so "Not available yet" has something to show.
  const opensAt =
    i % 10 === 9 ? new Date("2027-01-15T04:30:00.000Z") : new Date(Date.UTC(2026, 8, 15 + (i % 30), 4, 30));
  return {
    n,
    brand: brand.n,
    title: `${brand.name} ${t.title}`,
    kind: t.kind,
    category: brand.category,
    summary: t.summary,
    details: `${t.summary} A sample opportunity from ${brand.name}, a fictional brand in the CreatorCo preview. Nothing is sent to a brand and nothing is fulfilled.`,
    minTier: EXTRA_TIERS[i % EXTRA_TIERS.length]!,
    pointsCost: EXTRA_COSTS[i % EXTRA_COSTS.length]!,
    seats: 5 + ((i * 7) % 36),
    opensAt,
    closesAt,
  };
});

async function seedAccessPreview(tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) {
  for (const b of [...DEMO_BRANDS, ...EXTRA_DEMO_BRANDS]) {
    await tx
      .insert(brands)
      .values({
        id: demoIds.brand(b.n),
        name: b.name,
        category: b.category,
        description: b.description,
        isSample: true,
        createdAt: SEED_AT,
        updatedAt: SEED_AT,
      })
      .onConflictDoNothing();
  }
  const all = [
    ...DEMO_OPPORTUNITIES.map((o) => ({ ...o, opensAt: ACCESS_OPENS, closesAt: ACCESS_CLOSES })),
    ...EXTRA_DEMO_OPPORTUNITIES,
  ];
  for (const o of all) {
    await tx
      .insert(accessOpportunities)
      .values({
        id: demoIds.opportunity(o.n),
        brandId: demoIds.brand(o.brand),
        title: o.title,
        kind: o.kind,
        category: o.category,
        summary: o.summary,
        details: o.details,
        minTier: o.minTier,
        pointsCost: o.pointsCost,
        seats: o.seats,
        opensAt: o.opensAt,
        closesAt: o.closesAt,
        status: "live",
        isSample: true,
        createdAt: SEED_AT,
        updatedAt: SEED_AT,
      })
      .onConflictDoNothing();
  }
}
