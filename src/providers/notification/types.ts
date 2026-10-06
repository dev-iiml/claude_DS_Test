import type { Provider } from "../types";

/** Transactional messaging (SMS/email). Bought, not built. */
export interface NotificationProvider extends Provider {
  sendOtpSms(input: { to: string; code: string; purpose: "mobile_verification" }): Promise<{ reference: string }>;
}
