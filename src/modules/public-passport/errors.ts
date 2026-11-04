export type PassportErrorCode =
  | "not_found"
  | "invalid"
  | "wrong_state"
  | "consent_required"
  | "not_eligible"
  | "slug_taken"
  | "feature_off"
  | "code_invalid"
  | "locked_out"
  | "forbidden"
  | "quota_exceeded"
  | "four_eyes"
  | "file_rejected";

export class PassportError extends Error {
  constructor(
    readonly code: PassportErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PassportError";
  }
}

/** HTTP status for API routes. */
export const PASSPORT_ERROR_STATUS: Record<PassportErrorCode, number> = {
  not_found: 404,
  invalid: 422,
  wrong_state: 409,
  consent_required: 409,
  not_eligible: 409,
  slug_taken: 409,
  feature_off: 503,
  code_invalid: 422,
  locked_out: 429,
  forbidden: 403,
  quota_exceeded: 429,
  four_eyes: 403,
  file_rejected: 422,
};
