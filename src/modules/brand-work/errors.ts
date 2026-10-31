export type BrandWorkErrorCode =
  | "not_found"
  | "invalid"
  | "wrong_state"
  | "consent_required"
  | "profile_inactive"
  | "too_many_documents"
  | "file_rejected"
  | "uploads_paused"
  | "four_eyes"
  | "own_record"
  | "locked"
  | "feature_off"
  | "unavailable";

export class BrandWorkError extends Error {
  constructor(
    readonly code: BrandWorkErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "BrandWorkError";
  }
}
