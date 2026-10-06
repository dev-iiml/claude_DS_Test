export const PROVIDER_REQUEST_OUTCOMES = ["success", "not_found", "rejected", "error"] as const;
export type ProviderRequestOutcome = (typeof PROVIDER_REQUEST_OUTCOMES)[number];

export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 30;
export const OTP_MAX_SENDS_PER_HOUR = 5;
