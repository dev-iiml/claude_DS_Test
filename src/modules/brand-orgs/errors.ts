export type BrandOrgErrorCode =
  | "not_found"
  | "invalid"
  | "free_mail"
  | "email_taken"
  | "identifier_taken"
  | "code_invalid"
  | "code_expired"
  | "wrong_state"
  | "four_eyes"
  | "forbidden"
  | "not_verified"
  | "terms_required"
  | "quota_exceeded"
  | "feature_off"
  | "file_rejected"
  | "unavailable";

export class BrandOrgError extends Error {
  constructor(
    readonly code: BrandOrgErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "BrandOrgError";
  }
}

export const BRAND_ORG_ERROR_STATUS: Record<BrandOrgErrorCode, number> = {
  not_found: 404,
  invalid: 422,
  free_mail: 422,
  email_taken: 409,
  identifier_taken: 409,
  code_invalid: 422,
  code_expired: 410,
  wrong_state: 409,
  four_eyes: 403,
  forbidden: 403,
  not_verified: 403,
  terms_required: 409,
  quota_exceeded: 429,
  feature_off: 503,
  file_rejected: 422,
  unavailable: 503,
};
