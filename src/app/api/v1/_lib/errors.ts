import "server-only";

import { ConsentError } from "@/modules/consent";
import { OnboardingError } from "@/modules/creator-profile/onboarding-service";
import { SocialConnectionError } from "@/modules/social-data/connection-service";
import { isProviderOutage } from "@/providers/errors";

import { ApiError } from "./http";

/** Maps domain errors to API errors. Unknown errors propagate (→ 500). */
export function toApiError(error: unknown): never {
  if (error instanceof OnboardingError) {
    const conflict = ["step_locked", "already_completed", "profile_missing"].includes(error.code);
    const message = error.message !== error.code ? error.message : "This step can't be saved right now.";
    throw new ApiError(
      conflict ? 409 : 422,
      error.code,
      message,
      error.field ? { [error.field]: [message] } : undefined,
    );
  }
  if (error instanceof SocialConnectionError) {
    const status = error.code === "not_found" ? 404 : error.code === "profile_incomplete" ? 409 : 422;
    throw new ApiError(
      status,
      error.code,
      error.message !== error.code ? error.message : "The connection couldn't be completed.",
    );
  }
  if (error instanceof ConsentError) {
    throw new ApiError(
      409,
      "consent_outdated",
      "The consent text has changed. Fetch the current version and try again.",
    );
  }
  if (isProviderOutage(error)) {
    throw new ApiError(503, "service_unavailable", "This service is temporarily unavailable. Please try again later.");
  }
  throw error;
}
