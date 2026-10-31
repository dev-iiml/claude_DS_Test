import type { ProviderKind, ProviderMode } from "@/providers/types";

/**
 * Integration control plane vocabulary and pure policy (no I/O), so routing,
 * circuit and approval rules are unit-tested exhaustively.
 */

export const CIRCUIT_STATES = ["closed", "open", "half_open"] as const;
export type CircuitState = (typeof CIRCUIT_STATES)[number];

export const HEALTH_STATUSES = ["unknown", "ok", "degraded", "down"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const CHANGE_ACTIONS = [
  "create_config",
  "update_config",
  "set_route",
  "pause_kind",
  "resume_kind",
  "set_feature",
] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

export const CHANGE_STATUSES = ["pending", "applied", "rejected", "cancelled", "expired", "superseded"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export const CHANGE_REQUEST_TTL_HOURS = 48;

export const CIRCUIT_POLICY = {
  /** Consecutive provider failures that open the circuit. */
  failureThreshold: 5,
  /** How long an open circuit rejects traffic before one probe call is allowed. */
  cooldownMs: 60_000,
} as const;
export type CircuitPolicy = { failureThreshold: number; cooldownMs: number };

export const DEFAULT_TIMEOUT_MS = 10_000;

/** Vendor-neutral config key stored with data the provider produced (e.g. `bureau_b`). */
export const CONFIG_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Secrets are never stored: a config holds the *name* of an env var. Names
 * must carry the `INTEGRATION_` prefix so a config cannot point an adapter at
 * the app's own secrets (DATABASE_URL, CRON_SECRET, …).
 */
export const SECRET_REF_PATTERN = /^INTEGRATION_[A-Z0-9_]{2,60}$/;

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  social: "Social data",
  identity: "Mobile verification",
  identity_lookup: "Identity lookup",
  tax_registration: "GST registry",
  notification: "Notifications",
  bureau: "Credit bureau",
  financial_data: "Account Aggregator",
  lender: "Partner lender",
  document_storage: "Document storage",
  file_scan: "File scanning",
};

// ── Feature switches ────────────────────────────────────────────────────────

/**
 * Control-plane feature switches (Stage 18). Each belongs to the provider kind
 * whose data it uses (the change request's `kind`). Turning one ON needs a
 * second ops admin; turning one OFF applies at once (like a kill switch).
 */
export const FEATURE_SWITCHES = {
  brand_payment_match: {
    kind: "financial_data",
    label: "Brand payment matching",
    description:
      "Lets a creator who chose it check Account Aggregator data CreatorCo already holds under an active eligibility check for a matching credit. Only seen / not seen and the month leave the financial domain. Turn on only after the partner lender / FIU confirms the AA consent artefact's purpose covers this use.",
  },
} as const satisfies Record<string, { kind: ProviderKind; label: string; description: string }>;
export type FeatureSwitchKey = keyof typeof FEATURE_SWITCHES;
export const FEATURE_SWITCH_KEYS = Object.keys(FEATURE_SWITCHES) as FeatureSwitchKey[];

// ── Circuit breaker ─────────────────────────────────────────────────────────

export interface CircuitSnapshot {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: Date | null;
}

export const CLOSED_CIRCUIT: CircuitSnapshot = { state: "closed", consecutiveFailures: 0, openedAt: null };

/** Rejections (`rejected` errors) are not events: the provider answered. */
export type CircuitEvent = "success" | "failure";

export function nextCircuit(
  current: CircuitSnapshot,
  event: CircuitEvent,
  now: Date,
  policy: CircuitPolicy = CIRCUIT_POLICY,
): CircuitSnapshot {
  if (event === "success") return CLOSED_CIRCUIT;
  // A failed probe (or a failure while open) re-opens for a full cooldown.
  if (current.state !== "closed") {
    return { state: "open", consecutiveFailures: current.consecutiveFailures + 1, openedAt: now };
  }
  const failures = current.consecutiveFailures + 1;
  return failures >= policy.failureThreshold
    ? { state: "open", consecutiveFailures: failures, openedAt: now }
    : { state: "closed", consecutiveFailures: failures, openedAt: null };
}

/**
 * The state traffic sees. An open circuit offers one probe (`half_open`) once
 * the cooldown passes. A stored `half_open` means a probe was claimed at
 * `openedAt`: traffic stays away until it reports back, or until another
 * cooldown passes (the probing worker may have died).
 */
export function effectiveCircuitState(
  c: CircuitSnapshot,
  now: Date,
  policy: CircuitPolicy = CIRCUIT_POLICY,
): CircuitState {
  if (c.state === "closed") return "closed";
  const cooled = c.openedAt !== null && now.getTime() - c.openedAt.getTime() >= policy.cooldownMs;
  return cooled ? "half_open" : "open";
}

// ── Routing ─────────────────────────────────────────────────────────────────

export interface RoutableConfig {
  id: string;
  kind: ProviderKind;
  key: string;
  adapter: string;
  mode: ProviderMode;
  enabled: boolean;
  /** Adapter missing from this build, or a required secret env var is not set. */
  misconfigured: boolean;
  circuit: CircuitSnapshot;
}

export interface RouteSnapshot {
  kind: ProviderKind;
  primaryConfigId: string;
  fallbackConfigId: string | null;
  paused: boolean;
}

export type UnavailableReason = "disabled" | "misconfigured" | "mock_in_production" | "circuit_open";

export type RouteSelection =
  | { status: "ok"; config: RoutableConfig; via: "primary" | "fallback" }
  | { status: "paused" }
  | { status: "unavailable"; reason: UnavailableReason }
  | { status: "not_configured" };

export interface SelectionContext {
  now: Date;
  /** Mock adapters never serve traffic in production. */
  production: boolean;
  policy?: CircuitPolicy;
}

function blockedReason(c: RoutableConfig, ctx: SelectionContext): UnavailableReason | null {
  if (!c.enabled) return "disabled";
  if (c.misconfigured) return "misconfigured";
  if (ctx.production && c.mode === "mock") return "mock_in_production";
  if (effectiveCircuitState(c.circuit, ctx.now, ctx.policy) === "open") return "circuit_open";
  return null;
}

/**
 * Picks the config that serves new calls: the primary unless it is disabled,
 * forbidden or its circuit is open, then the fallback. A half-open primary is
 * preferred again so recovery happens automatically (one probe call).
 */
export function selectRoute(
  route: RouteSnapshot | undefined,
  configs: ReadonlyMap<string, RoutableConfig>,
  ctx: SelectionContext,
): RouteSelection {
  if (!route) return { status: "not_configured" };
  if (route.paused) return { status: "paused" };
  const primary = configs.get(route.primaryConfigId);
  if (!primary) return { status: "not_configured" };
  const primaryBlocked = blockedReason(primary, ctx);
  if (!primaryBlocked) return { status: "ok", config: primary, via: "primary" };
  const fallback = route.fallbackConfigId ? configs.get(route.fallbackConfigId) : undefined;
  if (fallback && !blockedReason(fallback, ctx)) return { status: "ok", config: fallback, via: "fallback" };
  return { status: "unavailable", reason: primaryBlocked };
}

// ── Maker-checker ───────────────────────────────────────────────────────────

export interface ApprovalContext {
  action: ChangeAction;
  /** Mode the config will run in after the change (create/update). */
  targetMode?: ProviderMode;
  /** Mode before the change (update). */
  currentMode?: ProviderMode;
  /** Whether the config is currently a route's primary or fallback. */
  configIsRouted?: boolean;
  /** set_feature: turning the switch on. */
  enabling?: boolean;
}

/**
 * Approved policy ("risky changes only"): anything that changes where live
 * traffic goes, moves a config to sandbox/live, or lifts a kill switch needs a
 * second person. Engaging a kill switch is instant (incident response).
 * Creating or editing an unrouted mock config carries no traffic and applies
 * at once.
 */
export function requiresApproval(ctx: ApprovalContext): boolean {
  switch (ctx.action) {
    case "pause_kind":
      return false;
    case "set_feature":
      return Boolean(ctx.enabling);
    case "resume_kind":
    case "set_route":
      return true;
    case "create_config":
      return ctx.targetMode !== "mock";
    case "update_config":
      // Sandbox/live configs hold real credentials references: any edit is reviewed.
      return Boolean(ctx.configIsRouted) || ctx.currentMode !== "mock" || (ctx.targetMode ?? "mock") !== "mock";
  }
}

export function changeExpiresAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + CHANGE_REQUEST_TTL_HOURS * 3_600_000);
}

/** Starts of hourly stat buckets (UTC). */
export function hourBucket(d: Date): Date {
  const b = new Date(d);
  b.setUTCMinutes(0, 0, 0);
  return b;
}
