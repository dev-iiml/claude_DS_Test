import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  domainMatchesWebsite,
  emailDomain,
  isFreeMailDomain,
  isValidIdentifier,
  normaliseIdentifier,
} from "@/modules/brand-orgs/domain";
import { canAccessBrandApp, homePathFor, isBrandMemberRole, isStaffRole } from "@/modules/identity/policy";
import { USER_ROLES } from "@/modules/identity/domain";
import { dealBand, followerBand, PASSPORT_BANDS_VERSION } from "@/modules/public-passport/bands";
import {
  canSee,
  DEFAULT_FIELD_TIERS,
  FIELD_RULES,
  FIELD_TIERS,
  isTierAllowed,
  normaliseFieldTiers,
  PASSPORT_FIELDS,
  slugProblem,
  suggestSlug,
  type FieldTier,
  type FieldTiers,
} from "@/modules/public-passport/domain";
import {
  accessCodeMatches,
  decodeUnlock,
  encodeUnlock,
  generateAccessCode,
  gstinFingerprint,
  ipPseudonym,
  normaliseAccessCode,
  unlockCookieName,
} from "@/modules/public-passport/keys";
import {
  buildPassportView,
  composePreview,
  hasLockedContent,
  OPEN_TIERS,
  PLACEHOLDER_ROWS,
  publicSummary,
  type PassportSource,
} from "@/modules/public-passport/view";
import { EARN_RULE_CODES, EARN_RULES } from "@/modules/rewards/rules";

/** Distinctive values, so a leak is easy to spot in serialised output. */
const SOURCE: PassportSource = {
  asOfMonth: "2026-10",
  profile: { displayName: "Kabir Sethi", bio: "Slow travel across the Western Ghats.", hasPhoto: true },
  handles: [{ platform: "instagram", platformLabel: "Instagram", handle: "kabir.ontheroad.demo" }],
  followers: [{ platform: "instagram", platformLabel: "Instagram", count: 73_412 }],
  categories: ["Travel"],
  languages: ["English", "Hindi"],
  city: "Jaipur",
  longevityYears: 6,
  badges: { identityVerified: true, accountsConnected: true, brandWorkVerified: true, paymentConfirmed: false },
  industries: ["Travel & hospitality"],
  creatorStatus: "Onyx",
  brands: [
    {
      directoryId: "00000000-0000-4000-800b-000000000001",
      name: "Wanderlane Luggage",
      industry: "Travel",
      collaborations: 3,
      lastMonth: "2026-08",
      hasLogo: true,
    },
    {
      directoryId: "00000000-0000-4000-800b-000000000003",
      name: "Chai Theory Cafes",
      industry: "Food",
      collaborations: 1,
      lastMonth: "2026-05",
      hasLogo: false,
    },
  ],
  brandNumbers: {
    verifiedBrands: 7,
    collaborations12m: 11,
    repeatBrands: 3,
    recurrenceRate: 0.43,
    tenureMonths: 29,
    agencyShare: 0.27,
    paymentConfirmationRate: 0.61,
  },
  audience: { engagementRate: 0.048, growthStability: 0.71, authenticity: "pass" },
  deals: { highest: 187_654, median12m: 64_321, billings12m: 912_345, growth12mPercent: 22, topClientShare12m: 0.35 },
  signalsAvailable: true,
};

const SECRET_STRINGS = [
  "Wanderlane",
  "Chai Theory",
  "187654",
  "187,654",
  "1,87,654",
  "64321",
  "912345",
  "73412",
  "73,412",
  "Kabir Sethi",
  "Western Ghats",
  "Jaipur",
  "Onyx",
  "800b-000000000001",
];

const allTiers = (tier: FieldTier): FieldTiers =>
  Object.fromEntries(
    PASSPORT_FIELDS.map((f) => [
      f,
      (FIELD_RULES[f].allowed as readonly FieldTier[]).includes(tier) ? tier : FIELD_RULES[f].allowed[0],
    ]),
  ) as FieldTiers;

describe("field tier matrix (spec §1)", () => {
  it("matches the allowed tiers and defaults", () => {
    const expected: Record<string, [FieldTier[], FieldTier]> = {
      profile: [["public", "unlocked"], "public"],
      handles: [["public", "unlocked"], "public"],
      follower_bands: [["public", "unlocked", "hidden"], "public"],
      categories: [["public", "unlocked", "hidden"], "public"],
      city: [["public", "unlocked", "hidden"], "hidden"],
      longevity: [["public", "unlocked"], "public"],
      badges: [["public"], "public"],
      industries: [["public", "unlocked", "hidden"], "public"],
      creator_status: [["public", "unlocked", "hidden"], "hidden"],
      brands: [["unlocked", "hidden"], "unlocked"],
      brand_numbers: [["unlocked", "hidden"], "unlocked"],
      audience_signals: [["unlocked", "hidden"], "unlocked"],
      deal_bands: [["unlocked", "hidden"], "hidden"],
    };
    expect(Object.keys(FIELD_RULES).sort()).toEqual(Object.keys(expected).sort());
    for (const [field, [allowed, def]] of Object.entries(expected)) {
      expect([...FIELD_RULES[field as keyof typeof FIELD_RULES].allowed], field).toEqual(allowed);
      expect(DEFAULT_FIELD_TIERS[field as keyof typeof DEFAULT_FIELD_TIERS], field).toBe(def);
    }
  });

  it("normalises stored tiers: unknown or disallowed values fall back to the default", () => {
    const t = normaliseFieldTiers({ brands: "public", badges: "hidden", city: "public", nonsense: "public" });
    expect(t.brands).toBe("unlocked");
    expect(t.badges).toBe("public");
    expect(t.city).toBe("public");
    expect(isTierAllowed("deal_bands", "public")).toBe(false);
    expect(isTierAllowed("brands", "public")).toBe(false);
  });

  it("only unlocked viewers see the unlocked tier; nobody sees hidden", () => {
    expect(canSee("public", "locked")).toBe(true);
    expect(canSee("unlocked", "locked")).toBe(false);
    expect(canSee("unlocked", "unlocked")).toBe(true);
    expect(canSee("hidden", "unlocked")).toBe(false);
  });
});

describe("bands", () => {
  it("uses the specified deal-size labels and never exact figures", () => {
    expect(PASSPORT_BANDS_VERSION).toMatch(/^ppb-\d+\.\d+\.\d+$/);
    expect([10_000, 30_000, 75_000, 1_50_000, 3_00_000, 9_00_000].map(dealBand)).toEqual([
      "<₹25k",
      "₹25k–50k",
      "₹50k–1L",
      "₹1–2.5L",
      "₹2.5–5L",
      "₹5L+",
    ]);
    expect(dealBand(null)).toBeNull();
    expect(followerBand(73_412)).toBe("50k–100k");
    expect(followerBand(-1)).toBeNull();
  });
});

describe("view model = the redaction boundary", () => {
  it("the locked view carries no locked values, names, counts or logo ids", () => {
    const locked = buildPassportView(SOURCE, allTiers("unlocked"), "locked");
    const json = JSON.stringify(locked);
    for (const s of SECRET_STRINGS) expect(json, s).not.toContain(s);
    expect(locked.header).toEqual({ displayName: null, bio: null, hasPhoto: false, locked: true });
    expect(locked.sections.every((s) => s.state === "locked" || s.field === "badges")).toBe(true);
    expect(hasLockedContent(locked)).toBe(true);
  });

  it("locked sections look the same whatever they hide (fixed placeholders)", () => {
    const empty: PassportSource = {
      ...SOURCE,
      brands: [],
      brandNumbers: null,
      deals: null,
      audience: null,
      signalsAvailable: false,
    };
    const tiers = { ...allTiers("unlocked"), deal_bands: "unlocked" as const };
    const a = buildPassportView(SOURCE, tiers, "locked");
    const b = buildPassportView(empty, tiers, "locked");
    expect(a).toEqual(b);
    for (const s of a.sections) if (s.state === "locked") expect(s.placeholders).toBe(PLACEHOLDER_ROWS[s.field]);
  });

  it("hidden fields are left out entirely, for every viewer", () => {
    const tiers = {
      ...DEFAULT_FIELD_TIERS,
      brands: "hidden" as const,
      deal_bands: "hidden" as const,
      city: "hidden" as const,
    };
    for (const access of ["locked", "unlocked"] as const) {
      const v = buildPassportView(SOURCE, tiers, access);
      expect(v.sections.map((s) => s.field)).not.toContain("brands");
      expect(v.sections.map((s) => s.field)).not.toContain("deal_bands");
      expect(JSON.stringify(v)).not.toContain("Wanderlane");
      expect(JSON.stringify(v)).not.toContain("Jaipur");
    }
  });

  it("amounts appear only as bands, only unlocked, only when deal bands are on", () => {
    const off = buildPassportView(SOURCE, DEFAULT_FIELD_TIERS, "unlocked");
    expect(off.sections.map((s) => s.field)).not.toContain("deal_bands");
    expect(JSON.stringify(off)).not.toContain("₹");
    const on = buildPassportView(SOURCE, { ...DEFAULT_FIELD_TIERS, deal_bands: "unlocked" }, "unlocked");
    const deals = on.sections.find((s) => s.field === "deal_bands")!;
    expect(deals.state).toBe("shown");
    const json = JSON.stringify(on);
    for (const s of ["187654", "64321", "912345", "1,87,654"]) expect(json).not.toContain(s);
    expect(json).toContain("₹1–2.5L");
    expect(
      buildPassportView(SOURCE, { ...DEFAULT_FIELD_TIERS, deal_bands: "unlocked" }, "locked").sections.find(
        (s) => s.field === "deal_bands",
      )!.state,
    ).toBe("locked");
  });

  it("shows 'No verified brand work yet' when there is none", () => {
    const v = buildPassportView(
      { ...SOURCE, brands: [], brandNumbers: null, deals: null },
      DEFAULT_FIELD_TIERS,
      "unlocked",
    );
    const brands = v.sections.find((s) => s.field === "brands")!;
    expect(brands).toMatchObject({ state: "empty", message: "No verified brand work yet" });
  });

  it("every shown value carries a source label", () => {
    const v = buildPassportView(SOURCE, { ...allTiers("public"), deal_bands: "unlocked" }, "unlocked");
    for (const s of v.sections) if (s.state === "shown") expect(["Verified", "Calculated"]).toContain(s.source);
  });

  it("the share-image summary uses the public tier only", () => {
    const summary = publicSummary(SOURCE, { ...DEFAULT_FIELD_TIERS, profile: "unlocked", handles: "unlocked" });
    expect(summary.title).toBe("A verified creator");
    expect(JSON.stringify(summary)).not.toContain("kabir.ontheroad.demo");
  });

  it("the owner's live preview recomposes exactly what the public page would show", () => {
    const open = buildPassportView(SOURCE, OPEN_TIERS, "unlocked");
    const combos: FieldTiers[] = [
      DEFAULT_FIELD_TIERS,
      allTiers("public"),
      allTiers("unlocked"),
      allTiers("hidden"),
      { ...DEFAULT_FIELD_TIERS, profile: "unlocked", deal_bands: "unlocked", city: "public" },
    ];
    for (const tiers of combos)
      for (const access of ["locked", "unlocked"] as const)
        expect(composePreview(open, tiers, access)).toEqual(buildPassportView(SOURCE, tiers, access));
    expect(FIELD_TIERS).toEqual(["public", "unlocked", "hidden"]);
  });
});

describe("links (slugs)", () => {
  it("suggests from the main handle and blocks reserved, malformed and number-like links", () => {
    expect(suggestSlug("Kabir.OnTheRoad.Demo")).toBe("kabir-ontheroad-demo");
    expect(suggestSlug("ab")).toBe("");
    expect(slugProblem("kabir-ontheroad")).toBeNull();
    expect(slugProblem("admin")).toBe("reserved");
    expect(slugProblem("creatorco-official")).toBe("reserved");
    expect(slugProblem("Kabir")).toBe("format");
    expect(slugProblem("a--b")).toBe("format");
    expect(slugProblem("-ab")).toBe("format");
    expect(slugProblem("kabir9876543210")).toBe("restricted");
  });
});

describe("access codes and unlock cookies", () => {
  it("generates 16-character Crockford base32 codes, hashed, with a 4-character hint", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = generateAccessCode();
      expect(c.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
      expect(c.display).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
      expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(c.hash).not.toContain(c.code);
      expect(c.hint).toBe(c.code.slice(-4));
      seen.add(c.code);
    }
    expect(seen.size).toBe(200);
  });

  it("matches what people type (case, dashes, O/0, I/L/1) in constant time", () => {
    const c = generateAccessCode();
    const typed = c.display.toLowerCase().replace(/0/g, "o").replace(/1/g, "l");
    const normalised = normaliseAccessCode(` ${typed} `)!;
    expect(accessCodeMatches(normalised, c.hash)).toBe(true);
    expect(accessCodeMatches(generateAccessCode().code, c.hash)).toBe(false);
    expect(normaliseAccessCode("too-short")).toBeNull();
    expect(accessCodeMatches(c.code, "not-a-hash")).toBe(false);
  });

  it("unlock cookies are signed, per passport, and expire", () => {
    const passport = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const code = "33333333-3333-4333-8333-333333333333";
    const now = Date.UTC(2026, 10, 4, 10);
    const value = encodeUnlock(passport, code, new Date(now + 3_600_000));
    expect(decodeUnlock(passport, value, now)).toBe(code);
    expect(decodeUnlock(other, value, now)).toBeNull();
    expect(decodeUnlock(passport, value, now + 3_600_001)).toBeNull();
    expect(
      decodeUnlock(
        passport,
        value.replace(/.$/, (ch) => (ch === "A" ? "B" : "A")),
        now,
      ),
    ).toBeNull();
    expect(decodeUnlock(passport, undefined, now)).toBeNull();
    expect(unlockCookieName(passport)).not.toBe(unlockCookieName(other));
    expect(unlockCookieName(passport)).toMatch(/^cc_pu_[0-9a-f]{16}$/);
  });

  it("keeps only keyed pseudonyms of IPs and GSTINs", () => {
    expect(ipPseudonym("203.0.113.9")).toMatch(/^ip1:[0-9a-f]{32}$/);
    expect(ipPseudonym("203.0.113.9")).toBe(ipPseudonym("203.0.113.9"));
    expect(ipPseudonym("203.0.113.9")).not.toContain("203");
    expect(ipPseudonym(null)).toBeNull();
    expect(gstinFingerprint("08ABCDE1234F1Z5")).toMatch(/^g1:[0-9a-f]{32}$/);
    expect(gstinFingerprint("08abcde1234f1z5")).toBe(gstinFingerprint("08ABCDE1234F1Z5"));
  });
});

describe("brand organisations", () => {
  it("refuses free-mail domains and checks the website domain", () => {
    expect(emailDomain("Asha@Lumen.Example")).toBe("lumen.example");
    expect(emailDomain("not-an-email")).toBeNull();
    for (const d of ["gmail.com", "yahoo.co.in", "outlook.com", "rediffmail.com"])
      expect(isFreeMailDomain(d), d).toBe(true);
    expect(isFreeMailDomain("lumen.example")).toBe(false);
    expect(domainMatchesWebsite("lumen.example", "https://www.lumen.example/in")).toBe(true);
    expect(domainMatchesWebsite("in.lumen.example", "https://lumen.example")).toBe(true);
    expect(domainMatchesWebsite("lumen.example", "https://other.example")).toBe(false);
  });

  it("validates CIN and LLPIN formats", () => {
    expect(isValidIdentifier("cin", normaliseIdentifier("cin", " u74999mh2015ptc123456 "))).toBe(true);
    expect(isValidIdentifier("cin", "U74999MH2015PTC12345")).toBe(false);
    expect(isValidIdentifier("llpin", normaliseIdentifier("llpin", "aab-1234"))).toBe(true);
    expect(isValidIdentifier("llpin", "AAB1234")).toBe(false);
  });
});

describe("roles: brand members are neither staff nor creators", () => {
  it("separates the brand app from creator and staff areas in both directions", () => {
    expect(USER_ROLES).toContain("brand_member");
    expect(isBrandMemberRole("brand_member")).toBe(true);
    expect(isStaffRole("brand_member")).toBe(false);
    expect(canAccessBrandApp("brand_member")).toBe(true);
    for (const role of USER_ROLES.filter((r) => r !== "brand_member")) {
      expect(canAccessBrandApp(role), role).toBe(false);
      expect(isBrandMemberRole(role), role).toBe(false);
    }
    expect(homePathFor({ role: "brand_member", onboardingComplete: false })).toBe("/brands");
  });
});

describe("Stage 19 boundaries", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  const FORBIDDEN = /from "@\/modules\/(financial-eligibility|underwriting|lending|offers|rewards)(\/[^"]*)?"/;

  it("public passports and brand organisations never import the financial domain, offers or rewards", () => {
    for (const f of [
      ...files("src/modules/public-passport"),
      ...files("src/modules/brand-orgs"),
      ...files("src/app/p"),
      ...files("src/app/brands"),
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(FORBIDDEN);
      expect(src, f).not.toMatch(/\bfin\.[a-z]/);
    }
  });

  it("no credit module imports public passports or brand organisations", () => {
    for (const dir of [
      "src/modules/financial-eligibility",
      "src/modules/underwriting",
      "src/modules/lending",
      "src/modules/fraud",
      "src/modules/creator-status",
    ])
      for (const f of files(dir))
        expect(readFileSync(f, "utf8"), f).not.toMatch(/@\/modules\/(public-passport|brand-orgs)/);
  });

  it("no points, perks or nudges for publishing or unlocking", () => {
    for (const code of EARN_RULE_CODES) expect(code, code).not.toMatch(/publi|unlock|shar|access_code|consent/);
    for (const r of Object.values(EARN_RULES))
      expect(`${r.label} ${r.trigger}`).not.toMatch(/publi|unlock|shar|access code/i);
  });
});
