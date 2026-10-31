import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BRAND_WORK_RULES_VERSION,
  needsSecondReview,
  normaliseBrandName,
  recordFlags,
  sniffMimeType,
  type RecordCheckInput,
} from "@/modules/brand-work/rules";
import { matchPayment, PAYMENT_MATCH_RULES_VERSION } from "@/modules/financial-eligibility/payment-match-rules";
import {
  BRAND_FEATURE_KEYS,
  brandFeatures,
  brandPortfolio,
  type BrandWorkInput,
  type EngineInput,
} from "@/modules/professional-graph/engine";
import { PROFESSIONAL_INPUTS } from "@/modules/underwriting/model";

const base: RecordCheckInput = {
  today: "2026-10-20",
  workDate: "2026-09-01",
  invoiceDate: "2026-09-05",
  amountPaise: 50_000_00,
  documentCounterparties: [],
  duplicateAcrossCreators: false,
  creatorVerifiedAmounts: [],
  recentNewBrandCount: 0,
  sameBrandAmountMonthElsewhere: false,
};

describe("brand-work record flags", () => {
  it("is versioned", () => expect(BRAND_WORK_RULES_VERSION).toMatch(/^bw-\d+\.\d+\.\d+$/));

  it("a clean record has no flags and needs one reviewer", () => {
    expect(recordFlags(base)).toEqual([]);
    expect(needsSecondReview([])).toBe(false);
  });

  it("raises each flag from its own input", () => {
    expect(recordFlags({ ...base, invoiceDate: "2026-10-21" })).toContain("future_dated_invoice");
    expect(recordFlags({ ...base, invoiceDate: "2026-08-01" })).toContain("invoice_before_work");
    expect(recordFlags({ ...base, duplicateAcrossCreators: true })).toEqual(["duplicate_document"]);
    expect(recordFlags({ ...base, amountPaise: 100_00 })).toContain("amount_out_of_band");
    expect(recordFlags({ ...base, amountPaise: 60_00_000_00 })).toContain("amount_out_of_band");
    expect(recordFlags({ ...base, recentNewBrandCount: 5 })).toEqual(["many_new_brands_fast"]);
    expect(recordFlags({ ...base, sameBrandAmountMonthElsewhere: true })).toEqual([
      "same_brand_amount_month_across_creators",
    ]);
  });

  it("counterparty mismatch compares normalised names", () => {
    expect(recordFlags({ ...base, documentCounterparties: ["Lumen Co. Pvt Ltd", "LUMEN CO"] })).toEqual([]);
    expect(recordFlags({ ...base, documentCounterparties: ["Lumen", "Other Agency"] })).toContain(
      "counterparty_mismatch",
    );
  });

  it("the median rule needs three verified records and a 5× jump", () => {
    const amounts = [10_000_00, 12_000_00, 14_000_00];
    expect(recordFlags({ ...base, amountPaise: 60_000_00, creatorVerifiedAmounts: amounts.slice(0, 2) })).toEqual([]);
    expect(recordFlags({ ...base, amountPaise: 60_000_00, creatorVerifiedAmounts: amounts })).toEqual([]);
    expect(recordFlags({ ...base, amountPaise: 60_000_01, creatorVerifiedAmounts: amounts })).toEqual([
      "amount_above_creator_median",
    ]);
  });

  it("an unknown amount never raises an amount flag", () => {
    expect(recordFlags({ ...base, amountPaise: null, creatorVerifiedAmounts: [1, 2, 3] })).toEqual([]);
  });
});

describe("brand names and uploads", () => {
  it("normalises case, punctuation and legal suffixes", () => {
    expect(normaliseBrandName("Nykaa Fashion Pvt Ltd")).toBe("nykaa fashion");
    expect(normaliseBrandName("Nykaa Fashion Pvt. Ltd.")).toBe("nykaa fashion");
    expect(normaliseBrandName("  Orbitnest   Technologies India Private Limited ")).toBe("orbitnest");
    expect(normaliseBrandName("Salt & Pepper LLP")).toBe("salt and pepper");
    expect(normaliseBrandName("Café Quillmere")).toBe("cafe quillmere");
  });

  it("sniffs the real type from magic bytes", () => {
    expect(sniffMimeType(new TextEncoder().encode("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffMimeType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffMimeType(new Uint8Array([]))).toBeNull();
  });
});

describe("brand payment match (fin, enum-only)", () => {
  const credit = (bookedOn: string, amountPaise: number, payerText = "NEFT LUMEN BEAUTY PVT LTD") => ({
    bookedOn,
    amountPaise,
    payerText,
  });
  const full = { from: "2026-01-01", to: "2026-12-31" };
  const input = {
    invoiceDate: "2026-06-10",
    expectedAmountPaise: 100_000_00,
    payerName: "Lumen Beauty Pvt Ltd",
    coverage: full,
  };

  it("is versioned", () => expect(PAYMENT_MATCH_RULES_VERSION).toMatch(/^pm-\d+\.\d+\.\d+$/));

  it("no data, a partial period or an open window is unknown — never not_seen", () => {
    expect(matchPayment({ ...input, credits: null })).toEqual({ result: "unknown", month: null });
    expect(matchPayment({ ...input, credits: [] })).toEqual({ result: "not_seen", month: null });
    expect(matchPayment({ ...input, credits: [], coverage: null }).result).toBe("unknown");
    expect(matchPayment({ ...input, credits: [], coverage: { from: "2026-01-01", to: "2026-06-30" } }).result).toBe(
      "unknown",
    );
    expect(matchPayment({ ...input, credits: [], coverage: { from: "2026-06-05", to: "2026-12-31" } }).result).toBe(
      "unknown",
    );
  });

  it("matches net of TDS inside the window and returns only the month", () => {
    expect(matchPayment({ ...input, credits: [credit("2026-07-15", 90_000_00)] })).toEqual({
      result: "seen",
      month: "2026-07-01",
    });
    expect(matchPayment({ ...input, credits: [credit("2026-07-15", 85_000_00)] }).result).toBe("seen");
    expect(matchPayment({ ...input, credits: [credit("2026-07-15", 84_999_99)] }).result).toBe("not_seen");
    expect(matchPayment({ ...input, credits: [credit("2026-07-15", 100_000_01)] }).result).toBe("not_seen");
  });

  it("a match counts even before the window closes", () => {
    const partial = { from: "2026-01-01", to: "2026-07-31" };
    expect(matchPayment({ ...input, coverage: partial, credits: [credit("2026-07-15", 95_000_00)] }).result).toBe(
      "seen",
    );
  });

  it("respects the −7 / +120 day window", () => {
    expect(matchPayment({ ...input, credits: [credit("2026-06-03", 95_000_00)] }).result).toBe("seen");
    expect(matchPayment({ ...input, credits: [credit("2026-06-02", 95_000_00)] }).result).toBe("not_seen");
    expect(matchPayment({ ...input, credits: [credit("2026-10-08", 95_000_00)] }).result).toBe("seen");
    expect(matchPayment({ ...input, credits: [credit("2026-10-09", 95_000_00)] }).result).toBe("not_seen");
  });

  it("needs a distinctive payer word; rails, legal forms and generic words don't count", () => {
    expect(matchPayment({ ...input, credits: [credit("2026-07-01", 95_000_00, "NEFT PVT LTD INDIA")] }).result).toBe(
      "not_seen",
    );
    const glam = { ...input, payerName: "The Glam Agency" };
    expect(
      matchPayment({ ...glam, credits: [credit("2026-07-01", 95_000_00, "NEFT THE AGENCY OF RECORD")] }).result,
    ).toBe("not_seen");
    expect(matchPayment({ ...glam, credits: [credit("2026-07-01", 95_000_00, "NEFT-GLAM AGENCY")] }).result).toBe(
      "seen",
    );
    // A name with nothing distinctive can't be matched at all.
    expect(matchPayment({ ...input, payerName: "Digital Media Pvt Ltd", credits: [] }).result).toBe("unknown");
  });

  it("picks the earliest matching credit", () => {
    const out = matchPayment({
      ...input,
      credits: [credit("2026-09-01", 95_000_00), credit("2026-07-20", 95_000_00)],
    });
    expect(out.month).toBe("2026-07-01");
  });
});

const rec = (over: Partial<BrandWorkInput> & { id: string }): BrandWorkInput => ({
  brandId: "b1",
  industry: "beauty",
  billedPartyType: "brand",
  deliverables: ["reel"],
  workMonth: "2026-05",
  amountPaise: 50_000_00,
  paymentConfirmed: false,
  confirmationMonth: null,
  ...over,
});
const engine = (brandWork: BrandWorkInput[]): EngineInput => ({
  asOf: "2026-10-15T00:00:00.000Z",
  creatorSince: null,
  declaredPlatforms: [],
  accounts: [],
  brandWork,
});
const value = (input: EngineInput, key: (typeof BRAND_FEATURE_KEYS)[number]) =>
  brandFeatures(input).find((f) => f.key === key)!.value;

describe("brand features (pg-0.3.0)", () => {
  const records = [
    rec({ id: "r1", brandId: "b1", workMonth: "2024-12", amountPaise: 20_000_00 }),
    rec({ id: "r2", brandId: "b1", workMonth: "2025-06", amountPaise: 30_000_00, paymentConfirmed: true }),
    rec({ id: "r3", brandId: "b1", workMonth: "2026-01", amountPaise: 40_000_00 }),
    rec({
      id: "r4",
      brandId: "b2",
      industry: "travel",
      workMonth: "2026-04",
      amountPaise: 60_000_00,
      billedPartyType: "agency",
    }),
    rec({ id: "r5", brandId: "b3", industry: "tech", workMonth: "2026-10", amountPaise: null, paymentConfirmed: true }),
  ];

  it("produces all 14 features, deterministically and independent of input order", () => {
    const a = brandFeatures(engine(records));
    expect(a.map((f) => f.key)).toEqual([...BRAND_FEATURE_KEYS]);
    expect(brandFeatures(engine([...records].reverse()))).toEqual(a);
  });

  it("computes counts, recurrence, tenure and concentration", () => {
    const i = engine(records);
    expect(value(i, "verified_brand_count")).toBe(3);
    expect(value(i, "repeat_brand_count")).toBe(1);
    expect(value(i, "brand_recurrence_rate")).toBeCloseTo(1 / 3, 3);
    expect(value(i, "brand_tenure_months")).toBe(22);
    expect(value(i, "brand_industry_count")).toBe(3);
    expect(value(i, "brand_industry_concentration")).toBeCloseTo((3 / 5) ** 2 + 2 * (1 / 5) ** 2, 3);
    expect(value(i, "agency_mediated_share")).toBeCloseTo(0.2, 3);
    expect(value(i, "payment_confirmation_rate")).toBeCloseTo(0.4, 3);
  });

  it("uses a rolling 12-month window for value features (in rupees)", () => {
    const i = engine(records);
    // Last 12 months (Nov 2025 – Oct 2026): r3, r4, r5 (r5 has no amount).
    expect(value(i, "verified_collaborations_12m")).toBe(3);
    expect(value(i, "verified_brand_billings_12m")).toBe(100_000);
    expect(value(i, "top_brand_revenue_share_12m")).toBeCloseTo(0.6, 3);
    expect(value(i, "highest_verified_deal")).toBe(60_000);
    expect(value(i, "median_verified_deal_12m")).toBeNull(); // needs 3 amounts
    // Prior window (Nov 2024 – Oct 2025): r1 + r2 = ₹50,000 → +100%.
    expect(value(i, "deal_value_growth_12m")).toBe(100);
    expect(value(engine(records.slice(1)), "deal_value_growth_12m")).toBeNull(); // needs 2 amounts in each window
  });

  it("is null, not zero, without evidence", () => {
    const i = engine([]);
    expect(value(i, "verified_brand_count")).toBe(0);
    for (const k of [
      "brand_recurrence_rate",
      "brand_tenure_months",
      "highest_verified_deal",
      "verified_brand_billings_12m",
      "payment_confirmation_rate",
    ] as const)
      expect(value(i, k), k).toBeNull();
    expect(brandFeatures({ ...engine([]), brandWork: undefined }).length).toBe(14);
  });

  it("the portfolio read model has no amounts and hides private records", () => {
    const named = records.map((r, n) => ({
      ...r,
      brandName: `Brand ${r.brandId}`,
      visibility: n === 4 ? ("private" as const) : ("show_on_passport" as const),
    }));
    const pub = brandPortfolio(named);
    expect(pub.map((b) => b.brandDirectoryId)).toEqual(["b2", "b1"]);
    expect(pub[1]).toMatchObject({
      collaborations: 3,
      firstMonth: "2024-12",
      lastMonth: "2026-01",
      paymentConfirmed: true,
    });
    expect(JSON.stringify(pub)).not.toMatch(/amount|paise/i);
    expect(brandPortfolio(named, { includePrivate: true })).toHaveLength(3);
  });
});

/** Brand work is creator-professional evidence; it never reaches credit, and it reads fin only through one door. */
describe("brand-work boundaries", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  const FIN_TABLES =
    /\b(fin\.[a-z]|creditApplications|cashflow[A-Z]\w*|fiTransactions|fiVendorAnalytics|financialFeature\w*|underwriting(Runs|Inputs|Results)|fraud(Checks|Flags)|creditProposals|lenderDecisions|bureauSummaries)\b/;

  it("brand-work never touches fin tables or financial internals except the payment-match door", () => {
    for (const f of files("src/modules/brand-work")) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(FIN_TABLES);
      const imports = [
        ...src.matchAll(/from "(@\/modules\/(?:financial-eligibility|underwriting|lending|fraud|partners)[^"]*)"/g),
      ].map((m) => m[1]);
      for (const i of imports)
        expect(
          [
            "@/modules/financial-eligibility/brand-payment-match",
            "@/modules/financial-eligibility/payment-match-types",
          ],
          f,
        ).toContain(i);
    }
  });

  it("no credit module or Creator Status imports brand work", () => {
    const offenders = ["underwriting", "fraud", "lending", "financial-eligibility", "partners", "creator-status"]
      .flatMap((m) => files(join("src/modules", m)))
      .filter((f) => /@\/modules\/brand-work\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("underwriting has no brand feature inputs", () => {
    for (const k of BRAND_FEATURE_KEYS) expect(PROFESSIONAL_INPUTS as readonly string[]).not.toContain(k);
    const src = files("src/modules/underwriting")
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const k of BRAND_FEATURE_KEYS) expect(src).not.toContain(k);
  });

  it("brand milestone points are method-neutral and never read an amount or a consent", () => {
    const src = readFileSync("src/modules/brand-work/points.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/amount|paise|consent|aa_match|confirmationMethod/i);
  });
});
