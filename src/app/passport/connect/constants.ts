/** Where providers return the creator after authorisation (registered with each provider). */
export const CONNECT_CALLBACK_PATH = "/passport/connect/callback";

/** Creator-facing copy for connection outcomes carried in `?connect_error=`. */
export const CONNECT_ERROR_COPY: Record<string, string> = {
  cancelled: "Connection cancelled. Nothing was shared.",
  invalid_state: "That connection link isn't valid. Please start again.",
  expired: "That connection took too long and expired. Please start again.",
  already_used: "That connection link has already been used.",
  platform_mismatch: "The account returned was for a different platform. Please try again.",
  provider_changed: "We updated how accounts connect while you were away. Please start again.",
  account_limit: "You've reached the number of accounts you can connect on this platform.",
  linked_elsewhere: "This account is already connected to a CreatorCo profile.",
  not_found: "We couldn't find that account on your Passport.",
  refresh_failed: "We couldn't refresh your accounts just now. Please try again.",
  provider_error: "The platform didn't respond. Please try again in a moment.",
};
