/**
 * Verified Creator Passport (Stage 19) — vocabulary and pure policy.
 *
 * A creator's opted-in public page. Every field has a tier the creator picks
 * within an allowed range: `public` (anyone with the link), `unlocked` (an
 * access-code holder or, if the creator allows it, a verified brand or agency
 * organisation) or `hidden`. Professional evidence only — never a credit
 * signal, never financial-domain data.
 */

export const FIELD_TIERS = ["public", "unlocked", "hidden"] as const;
export type FieldTier = (typeof FIELD_TIERS)[number];

export const PASSPORT_FIELDS = [
  "profile",
  "handles",
  "follower_bands",
  "categories",
  "city",
  "longevity",
  "badges",
  "industries",
  "creator_status",
  "brands",
  "brand_numbers",
  "audience_signals",
  "deal_bands",
] as const;
export type PassportField = (typeof PASSPORT_FIELDS)[number];

export interface FieldRule {
  label: string;
  /** What the field shows, in a few words (settings screen). */
  detail: string;
  allowed: readonly FieldTier[];
  default: FieldTier;
}

export const FIELD_RULES: Record<PassportField, FieldRule> = {
  profile: {
    label: "Name, photo and bio",
    detail: "Your display name, the photo you upload and a short bio.",
    allowed: ["public", "unlocked"],
    default: "public",
  },
  handles: {
    label: "Verified handles",
    detail: "Platform and handle of accounts you've connected and verified.",
    allowed: ["public", "unlocked"],
    default: "public",
  },
  follower_bands: {
    label: "Follower bands",
    detail: "A band per platform (for example 50k–100k), never the exact count.",
    allowed: ["public", "unlocked", "hidden"],
    default: "public",
  },
  categories: {
    label: "Categories and languages",
    detail: "Your content categories and the languages you create in.",
    allowed: ["public", "unlocked", "hidden"],
    default: "public",
  },
  city: {
    label: "City",
    detail: "The city on your profile.",
    allowed: ["public", "unlocked", "hidden"],
    default: "hidden",
  },
  longevity: {
    label: "Years creating",
    detail: "Your verified professional longevity, in years.",
    allowed: ["public", "unlocked"],
    default: "public",
  },
  badges: {
    label: "Verification badges",
    detail: "Identity verified, accounts connected, brand work verified, payment confirmed — yes or no only.",
    allowed: ["public"],
    default: "public",
  },
  industries: {
    label: "Industries worked with",
    detail: "Industries of your verified brand work — not brand names.",
    allowed: ["public", "unlocked", "hidden"],
    default: "public",
  },
  creator_status: {
    label: "Creator Status",
    detail: "Member, Onyx or Icon.",
    allowed: ["public", "unlocked", "hidden"],
    default: "hidden",
  },
  brands: {
    label: "Brands you've worked with",
    detail: "Brand names (and logos the brand has approved), collaborations and the last month you worked together.",
    allowed: ["unlocked", "hidden"],
    default: "unlocked",
  },
  brand_numbers: {
    label: "Brand work numbers",
    detail: "Verified brands, collaborations in 12 months, repeat brands, tenure and similar counts and ratios.",
    allowed: ["unlocked", "hidden"],
    default: "unlocked",
  },
  audience_signals: {
    label: "Audience signals",
    detail: "Engagement band, growth stability and an authenticity check (pass or attention only).",
    allowed: ["unlocked", "hidden"],
    default: "unlocked",
  },
  deal_bands: {
    label: "Deal-size bands",
    detail: "Bands such as ₹50k–1L for your verified deals — never exact amounts.",
    allowed: ["unlocked", "hidden"],
    default: "hidden",
  },
};

export type FieldTiers = Record<PassportField, FieldTier>;

export const DEFAULT_FIELD_TIERS: FieldTiers = Object.fromEntries(
  PASSPORT_FIELDS.map((f) => [f, FIELD_RULES[f].default]),
) as FieldTiers;

/** Fills gaps with defaults and clamps any tier outside a field's allowed range to its default. */
export function normaliseFieldTiers(input: Partial<Record<string, unknown>> | null | undefined): FieldTiers {
  const out = { ...DEFAULT_FIELD_TIERS };
  for (const f of PASSPORT_FIELDS) {
    const v = input?.[f];
    if (typeof v === "string" && (FIELD_RULES[f].allowed as readonly string[]).includes(v)) out[f] = v as FieldTier;
  }
  return out;
}

export function isTierAllowed(field: PassportField, tier: FieldTier): boolean {
  return (FIELD_RULES[field].allowed as readonly FieldTier[]).includes(tier);
}

// ── Viewers ─────────────────────────────────────────────────────────────────

/** Who is looking. `owner` is the creator previewing their own page (never sees beyond what unlockers see). */
export type ViewerAccess = "locked" | "unlocked";

/** May this viewer see a field set to `tier`? Hidden is never shown, to anyone. */
export function canSee(tier: FieldTier, access: ViewerAccess): boolean {
  if (tier === "hidden") return false;
  if (tier === "public") return true;
  return access === "unlocked";
}

// ── Sharing choices ─────────────────────────────────────────────────────────

export const UNLOCK_AUDIENCES = ["code_holders_only", "code_holders_and_verified_brands"] as const;
export type UnlockAudience = (typeof UNLOCK_AUDIENCES)[number];
export const DEFAULT_AUDIENCE: UnlockAudience = "code_holders_only";

export const PASSPORT_STATUSES = ["draft", "published", "unpublished"] as const;
export type PassportStatus = (typeof PASSPORT_STATUSES)[number];

// ── Slugs ───────────────────────────────────────────────────────────────────

export const SLUG_MIN = 3;
export const SLUG_MAX = 30;
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;
export const SLUG_REDIRECT_DAYS = 30;

/** Words that can't be a passport link (routes, brand, staff and confusing terms). */
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "access",
  "account",
  "brands",
  "brand",
  "brand-work",
  "creatorco",
  "creator-co",
  "dashboard",
  "eligibility",
  "help",
  "insights",
  "login",
  "logout",
  "official",
  "ops",
  "partnerships",
  "passport",
  "privacy",
  "settings",
  "signup",
  "staff",
  "support",
  "terms",
  "verified",
  "www",
]);

/** "Kabir.OnTheRoad.Demo" → "kabir-ontheroad-demo" (a suggestion; the creator can change it). */
export function suggestSlug(handle: string | null | undefined): string {
  const s = (handle ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return s.length >= SLUG_MIN ? s : "";
}

export type SlugProblem = "format" | "reserved" | "restricted";

/** Format and reserved-word checks (identifier patterns are checked by the caller with `restrictedTextKinds`). */
export function slugProblem(slug: string): SlugProblem | null {
  if (!SLUG_PATTERN.test(slug) || slug.includes("--")) return "format";
  if (RESERVED_SLUGS.has(slug) || slug.startsWith("creatorco")) return "reserved";
  // Long digit runs look like phone, account or ID numbers.
  if (/\d{6,}/.test(slug)) return "restricted";
  return null;
}

// ── Access codes ────────────────────────────────────────────────────────────

export const CODE_EXPIRY_DAYS = [7, 30, 90] as const;
export type CodeExpiryDays = (typeof CODE_EXPIRY_DAYS)[number];
/** 16 Crockford base32 characters = 80 bits; shown once as XXXX-XXXX-XXXX-XXXX. */
export const CODE_LENGTH = 16;
export const CODE_MAX_USES_LIMIT = 1000;
/** An unlock lasts at most this long, and never past the code's expiry. */
export const UNLOCK_TTL_HOURS = 24;
/** Wrong codes on one passport within the window lock code entry on it. */
export const CODE_FAILURE_LIMIT = 10;
export const CODE_FAILURE_WINDOW_MINUTES = 15;
export const CODE_LOCKOUT_MINUTES = 15;

export const ACCESS_LOG_KINDS = ["code", "brand", "lockout"] as const;
export type AccessLogKind = (typeof ACCESS_LOG_KINDS)[number];

// ── Reports and takedowns ───────────────────────────────────────────────────

export const REPORT_REASONS = [
  ["impersonation", "Pretending to be someone else"],
  ["inaccurate", "False or misleading information"],
  ["offensive", "Offensive content"],
  ["privacy", "Shares someone's private information"],
  ["other", "Something else"],
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number][0];
export const REPORT_REASON_CODES = REPORT_REASONS.map(([c]) => c) as [ReportReason, ...ReportReason[]];

export const REPORT_STATUSES = ["open", "dismissed", "actioned"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** `offline`: taken down pending review; `permanent_proposed` → `permanent` needs a second admin; `lifted`. */
export const TAKEDOWN_STATUSES = ["offline", "permanent_proposed", "permanent", "lifted"] as const;
export type TakedownStatus = (typeof TAKEDOWN_STATUSES)[number];

// ── Bio and photo ───────────────────────────────────────────────────────────

export const BIO_MAX = 280;
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png"] as const;

/** The footer shown on every passport. */
export const VERIFIED_BY_NOTE = [
  "Verified by CreatorCo means: connected social accounts were checked with the platform, and brand work marked verified was checked by CreatorCo staff against the creator's invoices, purchase orders or agreements.",
  "Not checked: content quality, audience demographics beyond the signals shown, or anything the creator hasn't connected.",
  "This page is not a credit assessment, a rating or an endorsement by CreatorCo.",
] as const;

export const LOCKED_HINT = "Unlock with an access code or as a verified brand";
