import "server-only";

import { FinancialEligibilityError } from "@/modules/financial-eligibility/application-service";
import { LendingError } from "@/modules/lending";
import { PrivacyError } from "@/modules/privacy";

import { toApiError } from "../_lib/errors";
import { ApiError } from "../_lib/http";

const STATUS: Record<FinancialEligibilityError["code"], number> = {
  profile_inactive: 409,
  consent_required: 409,
  not_found: 404,
  wrong_step: 409,
  bureau_limit: 429,
  pan_mismatch: 422,
  provider_error: 502,
  provider_changed: 409,
  number_limit: 409,
  duplicate_number: 409,
};

export function toEligibilityApiError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof FinancialEligibilityError) {
    throw new ApiError(
      STATUS[error.code],
      error.code,
      error.message !== error.code ? error.message : "This step can't be completed right now.",
    );
  }
  if (error instanceof LendingError) {
    const status = {
      not_found: 404,
      invalid: 422,
      consent_required: 409,
      conflict: 409,
      wrong_state: 409,
      provider_changed: 409,
    }[error.code];
    throw new ApiError(
      status,
      error.code,
      error.message !== error.code ? error.message : "This can't be done right now.",
    );
  }
  if (error instanceof PrivacyError) throw new ApiError(409, error.code, "This consent can't be given right now.");
  toApiError(error);
}
