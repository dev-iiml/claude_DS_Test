import type { Provider } from "../types";

/** Transactional messaging (SMS/email). Bought, not built. */
export interface NotificationProvider extends Provider {
  sendOtpSms(input: { to: string; code: string; purpose: "mobile_verification" }): Promise<{ reference: string }>;
  /** Stage 19: a one-time code to a work email (brand sign-up) or an invitation link. Never anything else. */
  sendOtpEmail(input: { to: string; code: string; purpose: "brand_signup" }): Promise<{ reference: string }>;
  sendInviteEmail(input: { to: string; link: string; organisation: string }): Promise<{ reference: string }>;
}
