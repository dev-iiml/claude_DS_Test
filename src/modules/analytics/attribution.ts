/**
 * Sign-up attribution (Stage 16) — pure, first-party. Where a new account came
 * from, recorded only on `account_created`: the campaign tags on the link
 * (utm_source / utm_medium / utm_campaign) and the KIND of site that referred
 * the visitor (never the URL or host).
 *
 * Tags are free text set by whoever shares a link, so they could carry a
 * handle, a name or a phone number. Only reviewed values are kept:
 * - source and medium must be in the allow-lists below;
 * - a campaign must be registered in `ANALYTICS_CAMPAIGNS` (comma-separated
 *   slugs, set by the growth team);
 * anything else is recorded as `other`. The values travel from the landing page
 * to sign-up in a short-lived first-party cookie (already reduced), cleared at
 * sign-up. No identifier is involved.
 */
export const REFERRER_KINDS = ["search", "social", "other"] as const;
export type ReferrerKind = (typeof REFERRER_KINDS)[number];

export const ATTRIBUTION_OTHER = "other" as const;

/** Known traffic sources (lowercase). Anything else → `other`. */
export const KNOWN_SOURCES = [
  "instagram",
  "youtube",
  "facebook",
  "x",
  "twitter",
  "linkedin",
  "whatsapp",
  "telegram",
  "threads",
  "snapchat",
  "sharechat",
  "moj",
  "google",
  "bing",
  "newsletter",
  "email",
  "sms",
  "partner",
  "brand",
  "creator_referral",
  "event",
  "press",
  "podcast",
  "qr",
] as const;

/** Known mediums (lowercase). Anything else → `other`. */
export const KNOWN_MEDIUMS = [
  "social",
  "organic",
  "paid",
  "cpc",
  "bio",
  "story",
  "reel",
  "post",
  "video",
  "email",
  "newsletter",
  "sms",
  "referral",
  "affiliate",
  "partner",
  "influencer",
  "event",
  "offline",
  "qr",
  "press",
] as const;

export type SourceTag = (typeof KNOWN_SOURCES)[number] | typeof ATTRIBUTION_OTHER;
export type MediumTag = (typeof KNOWN_MEDIUMS)[number] | typeof ATTRIBUTION_OTHER;

export interface Attribution {
  utm_source: SourceTag | null;
  utm_medium: MediumTag | null;
  utm_campaign: string | null;
  referrer: ReferrerKind | null;
}

export const EMPTY_ATTRIBUTION: Attribution = {
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  referrer: null,
};

/** Lowercase slug of 1–40 chars: letters, digits, `_` and `-` (spaces and `+` become `_`). */
export const ATTRIBUTION_SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function cleanSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\s+]+/g, "_");
  return ATTRIBUTION_SLUG.test(slug) ? slug : null;
}

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|ecosia|baidu)\.[a-z.]+$/;
const SOCIAL =
  /(^|\.)(instagram\.com|facebook\.com|fb\.com|t\.co|x\.com|twitter\.com|linkedin\.com|lnkd\.in|youtube\.com|youtu\.be|threads\.net|whatsapp\.com|wa\.me|reddit\.com|pinterest\.[a-z.]+|snapchat\.com|telegram\.org|t\.me|sharechat\.com|moj\.app|linktr\.ee)$/;

/** The kind of site a referrer URL belongs to; null for none, invalid or our own site. */
export function referrerKind(referrer: string | null | undefined, ownHost: string): ReferrerKind | null {
  if (!referrer) return null;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || host === ownHost.toLowerCase()) return null;
  if (SEARCH.test(host)) return "search";
  if (SOCIAL.test(host)) return "social";
  return "other";
}

/** Registered campaigns from `ANALYTICS_CAMPAIGNS` (comma-separated slugs). */
export function parseCampaigns(raw: string | null | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((c) => cleanSlug(c))
      .filter((c): c is string => c !== null),
  );
}

const SOURCES: ReadonlySet<string> = new Set(KNOWN_SOURCES);
const MEDIUMS: ReadonlySet<string> = new Set(KNOWN_MEDIUMS);

/** A tag present but not reviewed becomes `other`; an absent tag stays null. */
function reduce<T extends string>(value: string | null | undefined, allowed: ReadonlySet<string>): T | "other" | null {
  if (!value?.trim()) return null;
  const slug = cleanSlug(value);
  return slug && allowed.has(slug) ? (slug as T) : ATTRIBUTION_OTHER;
}

/** Reduces raw tags to reviewed values: allow-listed source/medium, registered campaign, else `other`. */
export function reduceTags(
  tags: { utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null },
  campaigns: ReadonlySet<string>,
): Pick<Attribution, "utm_source" | "utm_medium" | "utm_campaign"> {
  return {
    utm_source: reduce<SourceTag>(tags.utm_source, SOURCES),
    utm_medium: reduce<MediumTag>(tags.utm_medium, MEDIUMS),
    utm_campaign: reduce(tags.utm_campaign, campaigns),
  };
}

/** Attribution from a landing URL's query and the Referer header, or null when there is none. */
export function attributionFrom(
  params: Pick<URLSearchParams, "get">,
  referrer: string | null,
  ownHost: string,
  campaigns: ReadonlySet<string>,
): Attribution | null {
  const a: Attribution = {
    ...reduceTags(
      {
        utm_source: params.get("utm_source"),
        utm_medium: params.get("utm_medium"),
        utm_campaign: params.get("utm_campaign"),
      },
      campaigns,
    ),
    referrer: referrerKind(referrer, ownHost),
  };
  return a.utm_source || a.utm_medium || a.utm_campaign || a.referrer ? a : null;
}

/** Cookie value: only slugs, `k=v` pairs joined by `&` (cookie-safe characters only). */
export function encodeAttribution(a: Attribution): string {
  return (Object.entries(a) as [keyof Attribution, string | null][])
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** Parses a cookie value and reduces it again (the cookie is client-held); anything unexpected is dropped. */
export function decodeAttribution(value: string | null | undefined, campaigns: ReadonlySet<string>): Attribution {
  if (!value || value.length > 300) return EMPTY_ATTRIBUTION;
  const params = new URLSearchParams(value);
  const referrer = params.get("referrer");
  return {
    ...reduceTags(
      {
        utm_source: params.get("utm_source"),
        utm_medium: params.get("utm_medium"),
        utm_campaign: params.get("utm_campaign"),
      },
      campaigns,
    ),
    referrer: (REFERRER_KINDS as readonly string[]).includes(referrer ?? "") ? (referrer as ReferrerKind) : null,
  };
}

export const ATTRIBUTION_COOKIE = "cc_attr";
/** Long enough to read the landing page and sign up; it is cleared at sign-up either way. */
export const ATTRIBUTION_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;
