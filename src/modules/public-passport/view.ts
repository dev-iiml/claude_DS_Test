import {
  billingsBand,
  concentrationBand,
  dealBand,
  engagementBand,
  followerBand,
  growthBand,
  percent,
  stabilityBand,
  PASSPORT_BANDS_VERSION,
} from "./bands";
import { canSee, FIELD_RULES, type FieldTiers, type PassportField, type ViewerAccess } from "./domain";

/**
 * The passport view model (Stage 19) — pure. THIS is the redaction boundary:
 * the page, the JSON API and the share image render only what this returns.
 * A section the viewer can't see carries its key, a fixed title and a fixed
 * number of placeholder rows — never a value, a name, a count or whether it
 * is empty. Hidden fields are left out altogether.
 */

export interface PassportSource {
  /** "2026-10": when the Professional Graph values were computed (null without signals). */
  asOfMonth: string | null;
  profile: { displayName: string; bio: string | null; hasPhoto: boolean };
  /** Connected, verified accounts only. */
  handles: { platform: string; platformLabel: string; handle: string }[];
  /** Per connected platform, latest audience (followers or subscribers). Empty without signals. */
  followers: { platform: string; platformLabel: string; count: number | null }[];
  categories: string[];
  languages: string[];
  city: string | null;
  longevityYears: number | null;
  badges: {
    identityVerified: boolean;
    accountsConnected: boolean;
    brandWorkVerified: boolean;
    paymentConfirmed: boolean;
  };
  /** Industry labels of verified, non-private brand work (or all verified when private work counts in totals). */
  industries: string[];
  creatorStatus: string | null;
  /** Non-private verified brands only. `hasLogo`: the brand's verified organisation has an approved logo. */
  brands: {
    directoryId: string;
    name: string;
    industry: string;
    collaborations: number;
    lastMonth: string;
    hasLogo: boolean;
  }[];
  /** Brand work counts and ratios (no money). Null when there is no verified brand work. */
  brandNumbers: {
    verifiedBrands: number;
    collaborations12m: number;
    repeatBrands: number;
    recurrenceRate: number | null;
    tenureMonths: number | null;
    agencyShare: number | null;
    paymentConfirmationRate: number | null;
  } | null;
  /** Null when signals are off. */
  audience: {
    engagementRate: number | null;
    growthStability: number | null;
    authenticity: "pass" | "attention" | null;
  } | null;
  /** Rupees / ratios, for banding only — never rendered as figures. Null without verified amounts. */
  deals: {
    highest: number | null;
    median12m: number | null;
    billings12m: number | null;
    growth12mPercent: number | null;
    topClientShare12m: number | null;
  } | null;
  /** Whether Professional Graph values may be shown (the creator's professional-analytics consent is on). */
  signalsAvailable: boolean;
}

export interface ViewRow {
  label: string;
  value: string;
  /** Brand rows: show the approved logo from `/p/<slug>/logo/<directoryId>`. */
  logoBrandId?: string;
}

export type ViewSection =
  | {
      field: PassportField;
      title: string;
      state: "shown";
      source: "Verified" | "Calculated";
      asOf: string | null;
      rows: ViewRow[];
    }
  | { field: PassportField; title: string; state: "empty"; message: string }
  | { field: PassportField; title: string; state: "locked"; placeholders: number };

export interface PublicPassportView {
  bandsVersion: string;
  access: ViewerAccess;
  header: { displayName: string | null; bio: string | null; hasPhoto: boolean; locked: boolean };
  sections: ViewSection[];
}

/** Fixed per section, so a locked section looks the same whatever it hides. */
export const PLACEHOLDER_ROWS: Record<PassportField, number> = {
  profile: 1,
  handles: 2,
  follower_bands: 2,
  categories: 2,
  city: 1,
  longevity: 1,
  badges: 4,
  industries: 2,
  creator_status: 1,
  brands: 4,
  brand_numbers: 4,
  audience_signals: 3,
  deal_bands: 3,
};

const TITLES: Record<PassportField, string> = {
  profile: "About",
  handles: "Verified accounts",
  follower_bands: "Audience size",
  categories: "Categories and languages",
  city: "City",
  longevity: "Years creating",
  badges: "Verification",
  industries: "Industries worked with",
  creator_status: "Creator Status",
  brands: "Brands worked with",
  brand_numbers: "Brand work",
  audience_signals: "Audience signals",
  deal_bands: "Deal sizes",
};

const SECTION_ORDER: PassportField[] = [
  "badges",
  "handles",
  "follower_bands",
  "longevity",
  "categories",
  "city",
  "industries",
  "creator_status",
  "brands",
  "brand_numbers",
  "audience_signals",
  "deal_bands",
];

const month = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y!, (m ?? 1) - 1, 1)),
  );
};
const yesNo = (b: boolean) => (b ? "Yes" : "No");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function shown(
  field: PassportField,
  source: "Verified" | "Calculated",
  asOf: string | null,
  rows: ViewRow[],
): ViewSection {
  return { field, title: TITLES[field], state: "shown", source, asOf: asOf ? month(asOf) : null, rows };
}
const empty = (field: PassportField, message: string): ViewSection => ({
  field,
  title: TITLES[field],
  state: "empty",
  message,
});

const NO_BRAND_WORK = "No verified brand work yet";
const NO_SIGNALS = "Not shared yet";

/** The rows for a visible field (or an empty state). Only called once the viewer may see the field. */
function sectionFor(field: PassportField, s: PassportSource): ViewSection {
  switch (field) {
    case "badges":
      return shown(field, "Verified", null, [
        { label: "Identity verified", value: yesNo(s.badges.identityVerified) },
        { label: "Accounts connected", value: yesNo(s.badges.accountsConnected) },
        { label: "Brand work verified", value: yesNo(s.badges.brandWorkVerified) },
        { label: "Payment confirmed", value: yesNo(s.badges.paymentConfirmed) },
      ]);
    case "handles":
      return s.handles.length
        ? shown(
            field,
            "Verified",
            null,
            s.handles.map((h) => ({ label: h.platformLabel, value: `@${h.handle}` })),
          )
        : empty(field, "No connected accounts");
    case "follower_bands": {
      const rows = s.followers
        .map((f) => ({ label: f.platformLabel, value: followerBand(f.count) }))
        .filter((r): r is ViewRow => r.value !== null);
      return s.signalsAvailable && rows.length ? shown(field, "Verified", s.asOfMonth, rows) : empty(field, NO_SIGNALS);
    }
    case "longevity":
      return s.signalsAvailable && s.longevityYears !== null
        ? shown(field, "Verified", s.asOfMonth, [
            { label: "Creating for", value: s.longevityYears < 1 ? "Under a year" : plural(s.longevityYears, "year") },
          ])
        : empty(field, NO_SIGNALS);
    case "categories": {
      const rows: ViewRow[] = [];
      if (s.categories.length) rows.push({ label: "Categories", value: s.categories.join(", ") });
      if (s.languages.length) rows.push({ label: "Languages", value: s.languages.join(", ") });
      return rows.length ? shown(field, "Verified", null, rows) : empty(field, "Not added");
    }
    case "city":
      return s.city ? shown(field, "Verified", null, [{ label: "City", value: s.city }]) : empty(field, "Not added");
    case "industries":
      return s.industries.length
        ? shown(field, "Verified", null, [{ label: "Industries", value: s.industries.join(", ") }])
        : empty(field, NO_BRAND_WORK);
    case "creator_status":
      return s.creatorStatus
        ? shown(field, "Calculated", s.asOfMonth, [{ label: "Status", value: s.creatorStatus }])
        : empty(field, "Not calculated yet");
    case "brands":
      return s.brands.length
        ? shown(
            field,
            "Verified",
            null,
            s.brands.map((b) => ({
              label: b.name,
              value: `${plural(b.collaborations, "collaboration")} · last ${month(b.lastMonth)}`,
              ...(b.hasLogo ? { logoBrandId: b.directoryId } : {}),
            })),
          )
        : empty(field, NO_BRAND_WORK);
    case "brand_numbers": {
      if (!s.brandNumbers) return empty(field, NO_BRAND_WORK);
      if (!s.signalsAvailable) return empty(field, NO_SIGNALS);
      const n = s.brandNumbers;
      const rows: ViewRow[] = [
        { label: "Verified brands", value: String(n.verifiedBrands) },
        { label: "Collaborations, last 12 months", value: String(n.collaborations12m) },
        { label: "Repeat brands", value: String(n.repeatBrands) },
      ];
      const add = (label: string, v: string | null) => v !== null && rows.push({ label, value: v });
      add("Brands that came back", percent(n.recurrenceRate));
      add("Working with brands for", n.tenureMonths === null ? null : plural(n.tenureMonths, "month"));
      add("Through agencies or platforms", percent(n.agencyShare));
      add("Payments confirmed", percent(n.paymentConfirmationRate));
      return shown(field, "Calculated", s.asOfMonth, rows);
    }
    case "audience_signals": {
      if (!s.signalsAvailable || !s.audience) return empty(field, NO_SIGNALS);
      const rows: ViewRow[] = [];
      const e = engagementBand(s.audience.engagementRate);
      const g = stabilityBand(s.audience.growthStability);
      if (e) rows.push({ label: "Engagement", value: e });
      if (g) rows.push({ label: "Growth", value: g });
      if (s.audience.authenticity)
        rows.push({ label: "Authenticity check", value: s.audience.authenticity === "pass" ? "Pass" : "Attention" });
      return rows.length ? shown(field, "Calculated", s.asOfMonth, rows) : empty(field, NO_SIGNALS);
    }
    case "deal_bands": {
      if (!s.deals) return empty(field, NO_BRAND_WORK);
      const rows: ViewRow[] = [];
      const add = (label: string, v: string | null) => v !== null && rows.push({ label, value: v });
      add("Largest verified deal", dealBand(s.deals.highest));
      add("Typical deal, last 12 months", dealBand(s.deals.median12m));
      add("Verified billings, last 12 months", billingsBand(s.deals.billings12m));
      add("Compared with the year before", growthBand(s.deals.growth12mPercent));
      add("Client spread", concentrationBand(s.deals.topClientShare12m));
      return rows.length ? shown(field, "Calculated", null, rows) : empty(field, NO_BRAND_WORK);
    }
    case "profile":
      // Rendered in the header.
      return empty(field, "");
  }
}

export function buildPassportView(source: PassportSource, tiers: FieldTiers, access: ViewerAccess): PublicPassportView {
  const profileVisible = canSee(tiers.profile, access);
  const sections: ViewSection[] = [];
  for (const field of SECTION_ORDER) {
    const tier = tiers[field];
    if (tier === "hidden" || !(FIELD_RULES[field].allowed as readonly string[]).includes(tier)) continue;
    sections.push(
      canSee(tier, access)
        ? sectionFor(field, source)
        : { field, title: TITLES[field], state: "locked", placeholders: PLACEHOLDER_ROWS[field] },
    );
  }
  return {
    bandsVersion: PASSPORT_BANDS_VERSION,
    access,
    header: profileVisible
      ? {
          displayName: source.profile.displayName,
          bio: source.profile.bio,
          hasPhoto: source.profile.hasPhoto,
          locked: false,
        }
      : { displayName: null, bio: null, hasPhoto: false, locked: true },
    sections,
  };
}

/** Whether anything on the page is locked for this viewer (show the unlock form). */
export function hasLockedContent(view: PublicPassportView): boolean {
  return view.header.locked || view.sections.some((s) => s.state === "locked");
}

/** Text for the share image and page metadata — public tier only, by construction. */
export function publicSummary(source: PassportSource, tiers: FieldTiers): { title: string; lines: string[] } {
  const v = buildPassportView(source, tiers, "locked");
  const lines: string[] = [];
  for (const s of v.sections) {
    if (s.state !== "shown") continue;
    if (s.field === "handles") lines.push(s.rows.map((r) => r.value).join(" · "));
    if (s.field === "categories") lines.push(s.rows[0]?.value ?? "");
    if (s.field === "longevity") lines.push(`Creating for ${s.rows[0]?.value ?? ""}`);
  }
  return { title: v.header.displayName ?? "A verified creator", lines: lines.filter(Boolean).slice(0, 3) };
}

// ── Owner's live preview ────────────────────────────────────────────────────

/** Every field at its most open allowed tier — used once, server-side, to build the owner's preview material. */
export const OPEN_TIERS: FieldTiers = Object.fromEntries(
  (Object.keys(FIELD_RULES) as PassportField[]).map((f) => [f, FIELD_RULES[f].allowed[0]!]),
) as FieldTiers;

/**
 * The creator's live preview on Passport → Sharing: given the view with every
 * field shown (built on the server from their own data — bands, never raw
 * amounts), recompose what a stranger or an unlocker would see for the tiers
 * being edited. Equal to `buildPassportView(source, tiers, access)` (unit-tested),
 * so the preview never needs the raw source in the browser.
 */
export function composePreview(open: PublicPassportView, tiers: FieldTiers, access: ViewerAccess): PublicPassportView {
  const byField = new Map(open.sections.map((s) => [s.field, s]));
  const sections: ViewSection[] = [];
  for (const field of SECTION_ORDER) {
    const tier = tiers[field];
    if (tier === "hidden" || !(FIELD_RULES[field].allowed as readonly string[]).includes(tier)) continue;
    const full = byField.get(field);
    if (!full) continue;
    sections.push(
      canSee(tier, access)
        ? full
        : { field, title: TITLES[field], state: "locked", placeholders: PLACEHOLDER_ROWS[field] },
    );
  }
  return {
    bandsVersion: open.bandsVersion,
    access,
    header: canSee(tiers.profile, access)
      ? open.header
      : { displayName: null, bio: null, hasPhoto: false, locked: true },
    sections,
  };
}
