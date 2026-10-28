/**
 * Identity vocabulary. Roles are authoritative only when read from the
 * `users` table on the server — never from client-supplied data.
 */
export const USER_ROLES = [
  "creator",
  "risk_admin",
  "ops_admin",
  "partnerships_admin",
  "analyst",
  "super_admin",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["active", "suspended", "deactivated"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Risk console (`/admin`): underwriting and aggregates. */
export const ADMIN_ROLES = ["risk_admin", "super_admin"] as const satisfies readonly UserRole[];

/** Integration control plane (`/ops`): providers, approvals, jobs. No access to risk data. */
export const OPS_ROLES = ["ops_admin", "super_admin"] as const satisfies readonly UserRole[];

/** Brand partnerships desk (`/partnerships`): Access opportunities and requests. No risk or financial data. */
export const PARTNERSHIPS_ROLES = ["partnerships_admin", "super_admin"] as const satisfies readonly UserRole[];

/** Insights (`/insights`): aggregate funnel and model analytics only — no creator detail, no actions. */
export const ANALYTICS_ROLES = ["analyst", "risk_admin", "super_admin"] as const satisfies readonly UserRole[];

/** Session origin: browser cookie, or a bearer token held by a native app / API client. */
export const SESSION_CLIENTS = ["web", "ios", "android", "api"] as const;
export type SessionClient = (typeof SESSION_CLIENTS)[number];
