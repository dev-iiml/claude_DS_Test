import { eq } from "drizzle-orm";

import { hashPassword } from "@/modules/identity/auth/password";
import { hashApiKey } from "@/modules/partners/credentials";
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
];

const uuid = (prefix: string, n: number) => `00000000-0000-4000-${prefix}-${String(n).padStart(12, "0")}`;
export const demoIds = {
  identity: (n: number) => uuid("8001", n),
  user: (n: number) => uuid("8002", n),
  profile: (n: number) => uuid("8003", n),
  social: (n: number, i: number) => uuid("8004", n * 100 + i),
  receipt: (n: number) => uuid("8005", n),
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

    await seedSandboxPartner(tx);

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
