export type AccessErrorCode =
  | "not_found"
  | "invalid"
  | "wrong_state"
  | "closed"
  | "full"
  | "tier_required"
  | "insufficient_points"
  | "consent_required"
  | "profile_inactive";

export class AccessError extends Error {
  constructor(
    readonly code: AccessErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AccessError";
  }
}
