import { stableHash, type ProviderHealth } from "../types";
import type { NotificationProvider } from "./types";

/**
 * Mock SMS: sends nothing. In mock mode the verification service issues the
 * fixed demo code `MOCK_OTP_CODE`, so no code ever needs to be logged.
 */
export const MOCK_OTP_CODE = "123456";

export class MockNotificationProvider implements NotificationProvider {
  readonly descriptor = { key: "mock", kind: "notification", mode: "mock" } as const;

  async health(): Promise<ProviderHealth> {
    return { status: "ok", checkedAt: new Date(0) };
  }

  async sendOtpSms(input: { to: string; code: string; purpose: "mobile_verification" }) {
    return { reference: `sms_${stableHash(`${input.to}:${input.purpose}`).toString(36)}` };
  }
}
