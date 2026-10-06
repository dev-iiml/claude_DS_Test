import { stableHash, type ProviderHealth } from "../types";
import type { IdentityVerificationProvider, IdentityVerificationResult } from "./types";

export class MockIdentityVerificationProvider implements IdentityVerificationProvider {
  readonly descriptor = { key: "mock", kind: "identity", mode: "mock" } as const;

  async health(): Promise<ProviderHealth> {
    return { status: "ok", checkedAt: new Date(0) };
  }

  async startVerification(input: { subjectRef: string; method: string; declaredName: string }) {
    const reference = `idv_${stableHash(`${input.subjectRef}:${input.method}`).toString(36)}`;
    return { reference, redirectUrl: `https://mock.invalid/verify/${reference}` };
  }

  async getVerificationResult(reference: string): Promise<IdentityVerificationResult> {
    const h = stableHash(reference);
    return {
      reference,
      status: "verified",
      nameMatchScore: 0.9 + (h % 10) / 100,
      completedAt: new Date("2026-01-01T00:00:00Z"),
    };
  }
}
