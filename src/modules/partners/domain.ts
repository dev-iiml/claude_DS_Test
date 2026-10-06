/**
 * Partner access vocabulary and pure rules (Stage 12b). A partner is a
 * regulated entity (bank/NBFC) that receives CreatorCo credit proposals
 * through the partner API:
 *
 * - **pull + thin webhooks** (user decision): webhooks carry only an event id,
 *   type and identifiers; the partner fetches the proposal with its API key
 *   and posts its decision back. Nothing sensitive sits in delivery queues or
 *   retries;
 * - **API keys**: hashed, scoped, expiring; issued by one ops admin and
 *   approved by another (shown once to the issuer), revoked instantly by any
 *   ops admin, rotated with an overlap window;
 * - **webhook endpoints**: a new URL needs a second ops admin; the signing
 *   secret is derived from a root key (nothing secret is stored).
 *
 * No Node/DOM APIs here (crypto lives in `credentials.ts`).
 */

export const PARTNER_ENVIRONMENTS = ["sandbox", "live"] as const;
export type PartnerEnvironment = (typeof PARTNER_ENVIRONMENTS)[number];

export const PARTNER_STATUSES = ["active", "suspended"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

/** What a key may do. Keys never grant anything outside their own partner's proposals. */
export const PARTNER_SCOPES = ["proposals:read", "decisions:write", "events:read"] as const;
export type PartnerScope = (typeof PARTNER_SCOPES)[number];

export const PARTNER_SCOPE_LABELS: Record<PartnerScope, string> = {
  "proposals:read": "Read proposals sent to this partner",
  "decisions:write": "Post decisions on those proposals",
  "events:read": "Read the event feed (to recover missed webhooks)",
};

/** `cancelled`: the issuer withdrew a key before approval (they hold the raw key, so they can always kill it). */
export const API_KEY_STATUSES = ["pending", "active", "revoked", "rejected", "expired", "cancelled"] as const;
export type ApiKeyStatus = (typeof API_KEY_STATUSES)[number];

export const ENDPOINT_STATUSES = ["pending", "active", "retired", "rejected", "expired", "cancelled"] as const;
export type EndpointStatus = (typeof ENDPOINT_STATUSES)[number];

export const PARTNER_EVENT_TYPES = [
  /** A proposal is ready for the partner to fetch. */
  "proposal.submitted",
  /** A CreatorCo reviewer raised a query on the partner's decision; the partner may post a revision. */
  "decision.queried",
  /** A CreatorCo reviewer withdrew an unanswered query; the decision stands as posted. */
  "decision.query_withdrawn",
  /** A CreatorCo reviewer confirmed the decision; the creator now sees it. */
  "decision.confirmed",
  /** Stage 13: the creator accepted the offer — fetch the proposal for the acceptance and applicant details. */
  "offer.accepted",
  /** Stage 13: the creator declined the offer. */
  "offer.declined",
  /** Connectivity test sent from /ops. */
  "ping",
] as const;
export type PartnerEventType = (typeof PARTNER_EVENT_TYPES)[number];

export const DELIVERY_STATUSES = ["pending", "delivered", "dead"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** A key or endpoint not approved within this window can no longer be approved. */
export const PENDING_APPROVAL_TTL_HOURS = 48;
export const KEY_LIFETIME_DAYS = [90, 180, 365] as const;
export const DEFAULT_KEY_LIFETIME_DAYS = 365;
/** How long a replaced key keeps working after its successor is approved. */
export const ROTATION_OVERLAP_HOURS = [0, 24, 72, 168] as const;
/** How long the previous webhook signing secret is still sent after a rotation. */
export const WEBHOOK_SECRET_OVERLAP_HOURS = 24;
/** Receivers should reject signatures older than this. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
export const WEBHOOK_TIMEOUT_MS = 5_000;
export const MAX_DELIVERY_ATTEMPTS = 8;
/** A delivery claimed by a worker that vanished is retried after this. */
export const DELIVERY_LEASE_MS = 3 * WEBHOOK_TIMEOUT_MS;
export const LAST_USED_RESOLUTION_MS = 60_000;

/** 1m, 2m, 4m … capped at 2h (8 attempts ≈ 4h before a delivery is dead). */
export function deliveryRetryDelayMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 2 * 3_600_000);
}

export const PARTNER_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

// ── API key format ──────────────────────────────────────────────────────────
// `cck_<test|live>_<8-char id>_<43-char secret>`. The id is stored in clear (lookup and display);
// only a SHA-256 hash of the whole key is kept.

export const KEY_ENV_TAG: Record<PartnerEnvironment, "test" | "live"> = { sandbox: "test", live: "live" };
const API_KEY_FORMAT = /^cck_(test|live)_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;

export interface ParsedApiKey {
  environment: PartnerEnvironment;
  /** `cck_test_ab12cd34` — the public part, unique per key. */
  prefix: string;
}

export function parseApiKey(raw: string): ParsedApiKey | null {
  const m = API_KEY_FORMAT.exec(raw);
  if (!m) return null;
  return { environment: m[1] === "test" ? "sandbox" : "live", prefix: `cck_${m[1]}_${m[2]}` };
}

export function keyIsUsable(
  key: { status: ApiKeyStatus; expiresAt: Date },
  partner: { status: PartnerStatus },
  now: Date,
): boolean {
  return key.status === "active" && key.expiresAt.getTime() > now.getTime() && partner.status === "active";
}

export function pendingExpired(proposedAt: Date, now: Date): boolean {
  return now.getTime() - proposedAt.getTime() > PENDING_APPROVAL_TTL_HOURS * 3_600_000;
}

// ── Webhook URLs ────────────────────────────────────────────────────────────

const LOCAL_NAME = /(^|\.)(localhost|local|internal|localdomain|home|lan|corp|intranet)$/i;

/** Dotted-quad IPv4 → number, or null. */
function ipv4(host: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
];

/** True for loopback, private, link-local, CGNAT, documentation, multicast and reserved IPv4. */
export function isNonPublicIpv4(address: string): boolean {
  const n = ipv4(address);
  if (n === null) return false;
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (ipv4(base)! & mask) >>> 0;
  });
}

/**
 * True for any IPv6 address that isn't plainly global unicast (2000::/3), and
 * for IPv4-mapped/compatible forms of non-public IPv4.
 */
export function isNonPublicIpv6(address: string): boolean {
  const a = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (!a.includes(":")) return false;
  const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a) ?? /^::(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return true; // mapped/compatible literals are never legitimate webhook hosts
  const first = a.startsWith("::") ? 0 : parseInt(a.split(":")[0] || "0", 16);
  return !(first >= 0x2000 && first <= 0x3fff);
}

export const isNonPublicAddress = (address: string) => isNonPublicIpv4(address) || isNonPublicIpv6(address);

/**
 * Validates a partner webhook URL. Production-like (staging/production):
 * HTTPS only, a DNS name (no IP literals), no credentials, no local or
 * internal names. Delivery re-checks the resolved addresses (SSRF). Elsewhere
 * `http://localhost` / `127.0.0.1` are allowed for sandbox testing.
 */
export function validateWebhookUrl(raw: string, opts: { production: boolean }): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "Enter a full URL, e.g. https://partner.example/webhooks/creatorco.";
  }
  if (raw.length > 500) return "Keep the URL under 500 characters.";
  if (url.username || url.password) return "Don't put credentials in the URL.";
  if (url.hash) return "Remove the #fragment.";
  const host = url.hostname.replace(/\.+$/, "");
  const ipLiteral = ipv4(host) !== null || host.startsWith("[") || host.includes(":");
  const local = LOCAL_NAME.test(host) || isNonPublicAddress(host) || !host.includes(".");
  if (opts.production) {
    if (url.protocol !== "https:") return "Webhook URLs must use HTTPS.";
    if (ipLiteral) return "Use the partner's DNS name, not an IP address.";
    if (local) return "Webhook URLs can't point to a private or local address.";
  } else if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && (host === "localhost" || host === "127.0.0.1"))
  ) {
    return "Use HTTPS (plain HTTP is allowed only for localhost while testing).";
  }
  return null;
}

// ── Event envelope ──────────────────────────────────────────────────────────

export interface PartnerEventEnvelope {
  id: string;
  type: PartnerEventType;
  createdAt: string;
  /** Identifiers only — fetch the proposal through the API. */
  data: { proposalId?: string; queryId?: string };
}

export function eventEnvelope(e: {
  id: string;
  type: PartnerEventType;
  createdAt: Date;
  proposalId: string | null;
  queryId: string | null;
}): PartnerEventEnvelope {
  return {
    id: `evt_${e.id}`,
    type: e.type,
    createdAt: e.createdAt.toISOString(),
    data: {
      ...(e.proposalId ? { proposalId: e.proposalId } : {}),
      ...(e.queryId ? { queryId: e.queryId } : {}),
    },
  };
}
