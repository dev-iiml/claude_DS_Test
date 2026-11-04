/**
 * Verified brand and agency organisations (Stage 19) — vocabulary and pure
 * policy. Professional domain, never `fin`. An organisation signs up with a
 * work email and a public company identifier; two different partnerships
 * admins verify it before its members can unlock creator passports.
 */

export const ORG_TYPES = ["brand", "agency"] as const;
export type OrgType = (typeof ORG_TYPES)[number];
export const ORG_TYPE_LABELS: Record<OrgType, string> = { brand: "Brand", agency: "Agency" };

/** `pending` → (first admin verifies) → `pending` with verifier → (second admin approves) → `verified`. */
export const ORG_STATUSES = ["pending", "verified", "rejected", "suspended"] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const IDENTIFIER_TYPES = ["cin", "llpin"] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];
export const IDENTIFIER_LABELS: Record<IdentifierType, string> = {
  cin: "CIN (company)",
  llpin: "LLPIN (LLP)",
};

/** MCA Corporate Identification Number: L/U + 5-digit industry + 2-letter state + year + 3-letter type + 6 digits. */
export const CIN_PATTERN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
/** MCA LLP Identification Number: AAA-1234. */
export const LLPIN_PATTERN = /^[A-Z]{3}-\d{4}$/;

export function normaliseIdentifier(type: IdentifierType, raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  return type === "llpin" ? s.replace(/^([A-Z]{3})(\d{4})$/, "$1-$2") : s;
}

export function isValidIdentifier(type: IdentifierType, value: string): boolean {
  return type === "cin" ? CIN_PATTERN.test(value) : LLPIN_PATTERN.test(value);
}

export const MEMBER_ROLES = ["owner", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const MEMBER_STATUSES = ["active", "removed"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Brand directory claims and logos each need a verifier and a different approver. */
export const CLAIM_STATUSES = ["pending", "verified", "approved", "rejected"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const REVIEW_TARGETS = ["org", "claim", "logo"] as const;
export type ReviewTarget = (typeof REVIEW_TARGETS)[number];

export const REVIEW_ACTIONS = [
  "verify",
  "approve",
  "reject",
  "propose_suspend",
  "approve_suspend",
  "propose_reinstate",
  "approve_reinstate",
  "set_quota",
  "link_access_brand",
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const ORG_REASONS = [
  ["identifier_mismatch", "Company identifier doesn't match the legal name"],
  ["domain_mismatch", "Email domain doesn't match the website"],
  ["company_inactive", "Company isn't active at the registry"],
  ["insufficient_evidence", "Not enough evidence"],
  ["terms_breach", "Breach of the brand terms"],
  ["logo_not_authorised", "Logo use not authorised"],
  ["other", "Other"],
] as const;
export type OrgReason = (typeof ORG_REASONS)[number][0];
export const ORG_REASON_CODES = ORG_REASONS.map(([c]) => c) as [OrgReason, ...OrgReason[]];

/** Brand terms members accept before unlocking. A wording change is a new version (members accept again). */
export const BRAND_TERMS_VERSION = 1;
export const BRAND_TERMS = [
  "Use creator information only to consider and offer genuine paid or gifted work.",
  "Don't scrape, copy in bulk, export, resell or share creator information outside your organisation.",
  "Contact creators only about genuine opportunities, and respect a no.",
  "Every unlock is logged and shown to the creator, with your organisation's name.",
  "CreatorCo can suspend your organisation's access if these terms are broken.",
] as const;

export const DEFAULT_DAILY_UNLOCK_QUOTA = 50;
export const MAX_DAILY_UNLOCK_QUOTA = 500;

/**
 * Free-mail and disposable domains (a reference list; organisations must sign
 * up from their own domain). Lower case.
 */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.in",
  "ymail.com",
  "rediffmail.com",
  "rediff.com",
  "hotmail.com",
  "outlook.com",
  "outlook.in",
  "live.com",
  "live.in",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "zoho.com",
  "zohomail.in",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "tutanota.com",
  "fastmail.com",
  "hey.com",
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
]);

export function emailDomain(email: string): string | null {
  const m = /^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(email.trim());
  return m ? m[1]!.toLowerCase() : null;
}

export function isFreeMailDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return FREE_MAIL_DOMAINS.has(d) || [...FREE_MAIL_DOMAINS].some((f) => d.endsWith(`.${f}`));
}

/** The website's registrable host, e.g. "https://www.lumen.example/in" → "lumen.example". */
export function websiteHost(website: string): string | null {
  try {
    const u = new URL(website);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Email domain and website agree when one is the other or a subdomain of it. */
export function domainMatchesWebsite(domain: string, website: string): boolean {
  const host = websiteHost(website);
  if (!host) return false;
  const d = domain.toLowerCase();
  return d === host || d.endsWith(`.${host}`) || host.endsWith(`.${d}`);
}

export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg"] as const;

export const EMAIL_OTP_TTL_MINUTES = 10;
export const EMAIL_OTP_MAX_ATTEMPTS = 5;
export const INVITE_TTL_DAYS = 7;
