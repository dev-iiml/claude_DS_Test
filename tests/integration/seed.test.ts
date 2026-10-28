import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { accessOpportunities, creatorProfiles, users } from "@/db/schema";
import { DEMO_CREATORS, DEMO_OPPORTUNITIES, demoIds, seedDemoData } from "@/db/seed/demo";
import { getPointsBalance } from "@/modules/rewards";
import { publishReferenceData } from "@/db/seed/reference";
import { isValidGstin } from "@/modules/creator-profile/gstin";
import { hasValidConsent } from "@/modules/consent";
import { signIn } from "@/modules/identity/auth/auth-service";

import { authDepsFor, connectTestDb } from "../support/db";

const { db } = connectTestDb();
const PASSWORD = "seed-test-password-123";

describe("deterministic seed", () => {
  it("loads fictional creators, a risk admin and the consent definition — and is idempotent", async () => {
    await publishReferenceData(db);
    const first = await seedDemoData(db, PASSWORD);
    const second = await seedDemoData(db, PASSWORD);
    await publishReferenceData(db);

    expect(first.createdProfiles).toBe(5);
    expect(second.createdProfiles).toBe(0);

    const seededEmails = sql`(${users.email} like '%@creators.creatorco.test' or ${users.email} like '%@staff.creatorco.test')`;
    const roles = await db
      .select({ role: users.role, n: sql<number>`count(*)::int` })
      .from(users)
      .where(seededEmails)
      .groupBy(users.role);
    expect(Object.fromEntries(roles.map((r) => [r.role, r.n]))).toEqual({
      creator: 5,
      risk_admin: 2,
      ops_admin: 2,
      partnerships_admin: 1,
    });

    // Stage 14: five sample opportunities from fictional brands; welcome points granted once, even on reseed.
    const opportunities = await db.select().from(accessOpportunities);
    expect(opportunities.filter((o) => DEMO_OPPORTUNITIES.some((d) => d.slug === o.slug))).toHaveLength(5);
    expect(opportunities.every((o) => o.isPreview)).toBe(true);
    const aarohi = demoIds.profile(1);
    expect(await getPointsBalance(db, aarohi)).toBe(500);
    const draft = demoIds.profile(DEMO_CREATORS.find((c) => !c.completed)!.n);
    expect(await getPointsBalance(db, draft)).toBe(0);

    const profiles = await db
      .select()
      .from(creatorProfiles)
      .innerJoin(users, eq(users.id, creatorProfiles.userId))
      .where(seededEmails);
    const gst = new Set(profiles.map((p) => p.creator_profiles.gstStatus));
    expect(gst).toEqual(new Set(["registered", "not_registered", "unknown_requires_review", null]));
    expect(new Set(profiles.map((p) => p.creator_profiles.creatorCategory)).size).toBeGreaterThanOrEqual(4);

    const registered = profiles.find((p) => p.creator_profiles.gstStatus === "registered")!;
    expect(isValidGstin(registered.creator_profiles.gstin!)).toBe(true);

    // Fictional only: reserved TLD and `.demo` handles.
    for (const c of DEMO_CREATORS) {
      expect(c.email.endsWith(".test")).toBe(true);
      expect(c.handle.endsWith(".demo")).toBe(true);
    }

    const completed = profiles.filter((p) => p.creator_profiles.profileStatus === "completed");
    for (const p of completed) expect(await hasValidConsent(db, p.users.id, "creator_profile")).toBe(true);
  });

  it("seeded accounts can sign in", async () => {
    const r = await signIn(authDepsFor(db), { email: "risk.admin@staff.creatorco.test", password: PASSWORD });
    expect(r.ok && r.user.role).toBe("risk_admin");
  });
});
