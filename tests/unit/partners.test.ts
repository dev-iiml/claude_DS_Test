import { describe, expect, it } from "vitest";

import { canonicalDecision, partnerDecisionSchema } from "@/modules/lending/partner-schemas";
import { reviewActionsFor } from "@/modules/lending/domain";
import { illustrativeOffer } from "@/providers/lender/offer";
import {
  apiKeyMatches,
  deriveWebhookSecret,
  generateApiKey,
  hashApiKey,
  signatureHeader,
  verifyWebhookSignature,
} from "@/modules/partners/credentials";
import {
  deliveryRetryDelayMs,
  isNonPublicAddress,
  eventEnvelope,
  keyIsUsable,
  parseApiKey,
  pendingExpired,
  validateWebhookUrl,
} from "@/modules/partners/domain";

describe("partner API keys", () => {
  it("generates environment-tagged keys and stores only a hash", () => {
    const k = generateApiKey("sandbox");
    expect(k.key).toMatch(/^cck_test_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(k.key.startsWith(`${k.prefix}_`)).toBe(true);
    expect(k.hash).toBe(hashApiKey(k.key));
    expect(k.hash).not.toContain(k.key.slice(-43));
    expect(apiKeyMatches(k.key, k.hash)).toBe(true);
    expect(apiKeyMatches(`${k.key.slice(0, -1)}${k.key.endsWith("A") ? "B" : "A"}`, k.hash)).toBe(false);
    expect(generateApiKey("live").prefix).toMatch(/^cck_live_/);
    expect(generateApiKey("sandbox").key).not.toBe(k.key);
  });

  it("parses only well-formed keys", () => {
    const k = generateApiKey("live");
    expect(parseApiKey(k.key)).toEqual({ environment: "live", prefix: k.prefix });
    for (const bad of ["", "cck_prod_abcdefgh_" + "x".repeat(43), k.key + "x", k.key.toUpperCase(), "Bearer " + k.key])
      expect(parseApiKey(bad)).toBeNull();
  });

  it("is usable only while active, unexpired and the partner is active", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const later = new Date("2026-12-01T00:00:00Z");
    const active = { status: "active" as const, expiresAt: later };
    expect(keyIsUsable(active, { status: "active" }, now)).toBe(true);
    expect(keyIsUsable(active, { status: "suspended" }, now)).toBe(false);
    expect(keyIsUsable({ ...active, expiresAt: now }, { status: "active" }, now)).toBe(false);
    for (const status of ["pending", "revoked", "rejected", "expired"] as const)
      expect(keyIsUsable({ status, expiresAt: later }, { status: "active" }, now)).toBe(false);
  });

  it("pending approvals lapse after 48 hours", () => {
    const t = new Date("2026-10-01T00:00:00Z");
    expect(pendingExpired(t, new Date(t.getTime() + 47 * 3_600_000))).toBe(false);
    expect(pendingExpired(t, new Date(t.getTime() + 49 * 3_600_000))).toBe(true);
  });
});

describe("webhook signing", () => {
  const body = JSON.stringify({ id: "evt_1", type: "ping", data: {} });
  const now = new Date("2026-10-01T10:00:00Z");
  const t = Math.floor(now.getTime() / 1000);

  it("derives a stable secret per endpoint and version", () => {
    const a = deriveWebhookSecret("e1", 1);
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(deriveWebhookSecret("e1", 1)).toBe(a);
    expect(deriveWebhookSecret("e1", 2)).not.toBe(a);
    expect(deriveWebhookSecret("e2", 1)).not.toBe(a);
  });

  it("verifies the HMAC over timestamp and raw body, within the tolerance", () => {
    const secret = deriveWebhookSecret("e1", 1);
    const header = signatureHeader([secret], t, body);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature({ header, body, secret, now })).toBe(true);
    expect(verifyWebhookSignature({ header, body: body + " ", secret, now })).toBe(false);
    expect(verifyWebhookSignature({ header, body, secret: deriveWebhookSecret("e1", 2), now })).toBe(false);
    expect(verifyWebhookSignature({ header, body, secret, now: new Date(now.getTime() + 301_000) })).toBe(false);
    expect(verifyWebhookSignature({ header: null, body, secret, now })).toBe(false);
    expect(verifyWebhookSignature({ header: "v1=abc", body, secret, now })).toBe(false);
  });

  it("signs with both secrets during a rotation, so either verifies", () => {
    const [v1, v2] = [deriveWebhookSecret("e1", 1), deriveWebhookSecret("e1", 2)];
    const header = signatureHeader([v2, v1], t, body);
    expect(header.split(",")).toHaveLength(3);
    expect(verifyWebhookSignature({ header, body, secret: v1, now })).toBe(true);
    expect(verifyWebhookSignature({ header, body, secret: v2, now })).toBe(true);
  });

  it("thin envelopes carry identifiers only", () => {
    const e = eventEnvelope({
      id: "11111111-1111-4111-8111-111111111111",
      type: "decision.queried",
      createdAt: now,
      proposalId: "p1",
      queryId: "q1",
    });
    expect(e).toEqual({
      id: "evt_11111111-1111-4111-8111-111111111111",
      type: "decision.queried",
      createdAt: now.toISOString(),
      data: { proposalId: "p1", queryId: "q1" },
    });
    expect(eventEnvelope({ id: "x", type: "ping", createdAt: now, proposalId: null, queryId: null }).data).toEqual({});
  });

  it("backs off 1m, 2m, 4m … capped at 2h", () => {
    expect([1, 2, 3, 4].map(deliveryRetryDelayMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(deliveryRetryDelayMs(20)).toBe(7_200_000);
  });
});

describe("webhook URL validation", () => {
  const prod = { production: true };
  const dev = { production: false };
  it("production: HTTPS to public hosts only", () => {
    expect(validateWebhookUrl("https://partner.example/hooks", prod)).toBeNull();
    for (const bad of [
      "http://partner.example/hooks",
      "https://localhost/hooks",
      "https://127.0.0.1/hooks",
      "https://10.1.2.3/hooks",
      "https://192.168.0.5/hooks",
      "https://172.20.0.1/hooks",
      "https://169.254.169.254/latest",
      "https://[::1]/hooks",
      "https://svc.internal/hooks",
      "https://localhost./hooks",
      "https://metadata.google.internal./x",
      "https://[::ffff:127.0.0.1]/x",
      "https://[::ffff:169.254.169.254]/x",
      "https://[::]/x",
      "https://0.0.0.1/x",
      "https://100.64.1.1/x",
      "https://8.8.8.8/x",
      "https://intranet/x",
      "https://user:pw@partner.example/hooks",
      "https://partner.example/hooks#x",
      "not a url",
    ])
      expect(validateWebhookUrl(bad, prod)).not.toBeNull();
  });
  it("classifies resolved addresses for the delivery-time SSRF check", () => {
    for (const a of [
      "127.0.0.1",
      "10.2.3.4",
      "172.31.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.100.1.1",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:10.0.0.1",
      "::",
    ])
      expect(isNonPublicAddress(a)).toBe(true);
    for (const a of ["8.8.8.8", "13.235.1.1", "2606:4700::1111"]) expect(isNonPublicAddress(a)).toBe(false);
  });
  it("elsewhere: plain HTTP only for localhost", () => {
    expect(validateWebhookUrl("http://localhost:4010/", dev)).toBeNull();
    expect(validateWebhookUrl("http://127.0.0.1:4010/", dev)).toBeNull();
    expect(validateWebhookUrl("http://partner.example/", dev)).not.toBeNull();
  });
});

describe("partner decisions", () => {
  const offer = (amount = 100_000, tenor = 12) => ({
    expiresAt: "2026-10-10T10:00:00Z",
    terms: illustrativeOffer({
      lenderName: "Partner Bank",
      amount,
      tenorMonths: tenor,
      annualInterestRatePct: 18,
      processingFeePct: 2,
      coolingOffDays: 3,
      kfsReference: "KFS-1",
    }),
  });
  const approved = { outcome: "approved", approvedExposure: 100_000, approvedTenorMonths: 12 };

  it("requires amount, tenor and a matching offer unless declined, within the review bounds", () => {
    expect(partnerDecisionSchema.safeParse({ ...approved, offer: offer() }).success).toBe(true);
    expect(partnerDecisionSchema.safeParse({ outcome: "declined", reasonCodes: ["POLICY"] }).success).toBe(true);
    for (const bad of [
      { outcome: "approved" },
      approved, // no offer
      { ...approved, offer: offer(90_000) }, // terms don't match the amount
      { ...approved, offer: offer(100_000, 6) }, // or the tenor
      { outcome: "declined", offer: offer() },
      { outcome: "approved", approvedExposure: 5_000, approvedTenorMonths: 12 },
      { outcome: "modified", approvedExposure: 100_000, approvedTenorMonths: 120 },
      { outcome: "declined", approvedExposure: 100_000 },
      { ...approved, offer: offer(), extra: 1 },
      { ...approved, offer: offer(), reasonCodes: ["lower case"] },
      { outcome: "maybe" },
    ])
      expect(partnerDecisionSchema.safeParse(bad).success).toBe(false);
  });

  it("canonical form ignores key order and normalises timestamps", () => {
    const o = offer();
    const a = partnerDecisionSchema.parse({ ...approved, offer: o, decidedAt: "2026-10-01T15:30:00+05:30" });
    const b = partnerDecisionSchema.parse({
      offer: { terms: { ...o.terms }, expiresAt: "2026-10-10T15:30:00+05:30" },
      decidedAt: "2026-10-01T10:00:00Z",
      approvedTenorMonths: 12,
      approvedExposure: 100_000,
      outcome: "approved",
    });
    expect(canonicalDecision(a)).toBe(canonicalDecision(b));
    const c = partnerDecisionSchema.parse({ ...approved, offer: { ...o, terms: { ...o.terms, coolingOffDays: 5 } } });
    expect(canonicalDecision(c)).not.toBe(canonicalDecision(a));
  });

  it("staff may override only the simulated lender; partner decisions are confirmed or queried", () => {
    expect(reviewActionsFor(true)).toEqual(["confirm", "override"]);
    expect(reviewActionsFor(false)).toEqual(["confirm", "query"]);
  });
});
