import { describe, expect, it } from "vitest";

import { ADAPTERS, adaptersFor, findAdapter } from "@/providers/catalog";
import { ProviderError, classifyProviderError, isProviderOutage, ProviderRoutingError } from "@/providers/errors";
import { createMockProviderRegistry } from "@/providers/registry";
import { PROVIDER_KINDS } from "@/providers/types";
import { encodeMockCode } from "@/providers/social/mock-social-data-provider";
import { mockAccountsFor } from "@/providers/financial-data/mock-financial-data-provider";

describe("provider registry", () => {
  it("exposes every provider behind its interface, in mock mode", async () => {
    const p = createMockProviderRegistry();
    for (const provider of [p.social, p.identity, p.bureau, p.financialData, p.lender]) {
      expect(provider.descriptor.mode).toBe("mock");
      await expect(provider.health()).resolves.toMatchObject({ status: "ok" });
    }
  });

  it("mocks are deterministic", async () => {
    const a = createMockProviderRegistry();
    const b = createMockProviderRegistry();
    const asOf = new Date("2026-01-01T00:00:00Z");
    const input = { platform: "instagram", externalAccountId: "acc-1", asOf, months: 12 };
    const history = await a.social.fetchHistory(input);
    expect(history).toEqual(await b.social.fetchHistory(input));
    expect(history).toHaveLength(12);
    expect(history[11]!.capturedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    const bureau = (pan: string) => a.bureau.fetchSummary({ subjectRef: pan, consentReceiptId: "r1" });
    const { retrievedAt: _r1, ...first } = await bureau("ABCPE1234F");
    const { retrievedAt: _r2, ...second } = await b.bureau.fetchSummary({
      subjectRef: "ABCPE1234F",
      consentReceiptId: "r1",
    });
    expect(first).toEqual(second);
  });

  it("mock bureau outcomes are driven by the PAN digits", async () => {
    const { bureau } = createMockProviderRegistry();
    const get = (pan: string) => bureau.fetchSummary({ subjectRef: pan, consentReceiptId: "r" });
    expect(await get("ABCPE1230F")).toMatchObject({ scoreBand: "no_hit", activeTradelines: 0 });
    expect(await get("ABCPE1238F")).toMatchObject({ scoreBand: "high", delinquentTradelines12m: 0, enquiries6m: 2 });
    expect(await get("ABCPE1295F")).toMatchObject({ scoreBand: "medium", delinquentTradelines12m: 1 });
    await expect(get("not-a-pan")).rejects.toThrow();
  });

  it("mock Account Aggregator: accounts per number, selection, retries and line items", async () => {
    const { financialData } = createMockProviderRegistry();
    const asOf = new Date("2026-10-03T10:00:00Z");
    const base = { subjectRef: "u1", consentReceiptId: "r1", monthsRequested: 12, dataLifeDays: 90 };
    const start = (mobile: string) =>
      financialData.requestConsent({ ...base, mobile, redirectUri: "https://app.test/cb", asOf });
    expect(financialData.capabilities()).toMatchObject({
      multiAccountSelection: true,
      additionalNumberInJourney: true,
    });

    const { reference, redirectUrl } = await start("9876543215");
    expect(redirectUrl).toContain("/connect/aa-mock?reference=");
    expect(reference).not.toContain("98765"); // only the last four digits travel
    expect(mockAccountsFor("3215")).toHaveLength(3);
    expect(mockAccountsFor("3210")).toHaveLength(0);

    const r = await financialData.fetchData({ reference, params: { accounts: "3215-0,3215-1" }, asOf });
    expect(r.status).toBe("completed");
    expect(r.accounts.map((a) => a.status)).toEqual(["delivered", "delivered"]);
    const main = r.accounts[0]!.transactions!;
    expect(main[0]!.bookedOn >= "2025-10-01").toBe(true);
    expect(main.at(-1)!.bookedOn < "2026-10-01").toBe(true);
    expect(r.dataLifeUntil.toISOString()).toBe("2027-01-01T10:00:00.000Z");
    const again = await financialData.fetchData({ reference, params: { accounts: "3215-0,3215-1" }, asOf });
    expect(again).toEqual(r);

    // Ends in 9: the second account times out on the first attempt; a retry delivers it.
    const nine = await start("9876543219");
    const first = await financialData.fetchData({
      reference: nine.reference,
      params: { accounts: "3219-0,3219-1" },
      asOf,
    });
    expect(first.status).toBe("partial");
    expect(first.accounts[1]).toMatchObject({ status: "timeout", transactions: null });
    const retry = await financialData.requestConsent({ ...base, retryOf: nine.reference, redirectUri: "x", asOf });
    const second = await financialData.fetchData({ reference: retry.reference, params: { accounts: "3219-1" }, asOf });
    expect(second).toMatchObject({ status: "completed" });

    expect(financialData.interpretReturn({ reference, status: "approved" })).toEqual({
      reference,
      outcome: "approved",
    });
    expect(financialData.interpretReturn({ reference: "nope", status: "x" })).toEqual({
      reference: null,
      outcome: "failed",
    });
  });

  it("social connection round-trips through begin/complete", async () => {
    const { social } = createMockProviderRegistry();
    const { authorizationUrl } = await social.beginConnection({
      platform: "youtube",
      state: "s1",
      redirectUri: "https://app.test/cb",
    });
    expect(authorizationUrl).toContain("state=s1");
    const code = encodeMockCode({ platform: "youtube", handle: "maya.makes", nonce: "n" });
    const account = await social.completeConnection({ platform: "youtube", code });
    expect(account).toMatchObject({ platform: "youtube", handle: "maya.makes" });
    expect(account.externalAccountId).toMatch(/^mock-youtube-/);
    expect(await social.completeConnection({ platform: "youtube", code })).toEqual(account);
    await expect(social.completeConnection({ platform: "instagram", code })).rejects.toThrow();
  });

  it("the simulated RE is clearly a mock and refuses unknown proposal formats", async () => {
    const { lender } = createMockProviderRegistry();
    expect(lender.descriptor.mode).toBe("mock");
    await expect(lender.submitProposal({ proposalId: "p1", payload: {} as never })).rejects.toMatchObject({
      errorClass: "rejected",
    });
  });
});

describe("adapter catalog", () => {
  it("has a mock adapter for every capability, running only in mock mode", () => {
    for (const kind of PROVIDER_KINDS) {
      const mock = findAdapter(kind, "mock");
      expect(mock?.modes).toEqual(["mock"]);
      expect(adaptersFor(kind).length).toBeGreaterThan(0);
    }
    expect(ADAPTERS.every((a) => a.secrets.every((s) => /^[a-zA-Z]+$/.test(s)))).toBe(true);
  });

  it("settings are strict, so a pasted secret is rejected", () => {
    const mock = findAdapter("bureau", "mock")!;
    expect(mock.settings.safeParse({ timeoutMs: 2000, simulateOutage: true }).success).toBe(true);
    expect(mock.settings.safeParse({ apiKey: "sk_live" }).success).toBe(false);
    expect(mock.settings.safeParse({ timeoutMs: 10 }).success).toBe(false);
  });

  it("a simulated outage fails async calls as unavailable and reports down", async () => {
    const bureau = findAdapter("bureau", "mock")!.create({ settings: { simulateOutage: true }, secrets: {} });
    await expect(bureau.fetchSummary({ subjectRef: "ABCPE1236F", consentReceiptId: "r" })).rejects.toMatchObject({
      errorClass: "unavailable",
    });
    await expect(bureau.health()).resolves.toMatchObject({ status: "down" });
    const social = findAdapter("social", "mock")!.create({ settings: { simulateOutage: true }, secrets: {} });
    expect(social.supportedPlatforms().length).toBeGreaterThan(0);
  });

  it("classifies errors: unknown failures count as outages, rejections don't", () => {
    expect(classifyProviderError(new TypeError("fetch failed"))).toBe("unavailable");
    expect(classifyProviderError(new ProviderError("rejected", "bad code"))).toBe("rejected");
    expect(isProviderOutage(new ProviderRoutingError("paused", "bureau"))).toBe(true);
    expect(isProviderOutage(new ProviderError("rejected", "bad"))).toBe(false);
  });
});
