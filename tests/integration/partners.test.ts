import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditEvents,
  creditProposals,
  partnerApiKeys,
  partnerEvents,
  partnerWebhookDeliveries,
  partners,
  providerConfigs,
} from "@/db/schema";
import {
  LendingError,
  getCreatorLenderView,
  getPartnerProposal,
  getProposalDetail,
  listPartnerProposals,
  processLenderProposals,
  proposeIfShared,
  raiseDecisionQuery,
  recordPartnerDecision,
  reviewDecision,
  withdrawDecisionQuery,
  type PartnerDecisionInput,
} from "@/modules/lending";
import {
  MAX_DELIVERY_ATTEMPTS,
  authenticateApiKey,
  cancelApiKey,
  createPartner,
  decideApiKey,
  decideWebhookEndpoint,
  deliverPartnerWebhooks,
  listPartnerEvents,
  proposeApiKey,
  proposeWebhookEndpoint,
  redeliver,
  retireWebhookEndpoint,
  revokeApiKey,
  rotateWebhookSecret,
  setPartnerStatus,
  type WebhookRequest,
  type WebhookTransport,
} from "@/modules/partners";
import { verifyWebhookSignature } from "@/modules/partners/credentials";
import { MockLenderProvider } from "@/providers/lender/mock-lender-provider";
import { illustrativeOffer } from "@/providers/lender/offer";
import { PartnerApiLenderProvider } from "@/providers/lender/partner-api-lender-provider";
import type { LenderProvider } from "@/providers/lender/types";

import { connectTestDb } from "../support/db";
import { lendingFixtures } from "../support/lending";

const { db } = connectTestDb();
const { confirmedCheck, staff } = lendingFixtures(db, { panSeed: 500 });
const decisionIdOf = async (proposalId: string) => (await getProposalDetail(db, proposalId))!.decision!.id;

let seq = 0;
const uniqueKey = (label: string) => `p_${label}_${Date.now().toString(36)}_${(seq += 1)}`.slice(0, 40);

/** A partner-API lender reporting the given config key (as the router does). */
function partnerLender(lenderKey: string): LenderProvider {
  const base = new PartnerApiLenderProvider("sandbox");
  return new Proxy(base, {
    get: (t, p, r) => (p === "descriptor" ? { key: lenderKey, kind: "lender", mode: "sandbox" } : Reflect.get(t, p, r)),
  });
}

/** Records every request; answers with the queued statuses (default 204), or throws for "network". */
function fakeTransport(statuses: (number | "network")[] = []) {
  const requests: WebhookRequest[] = [];
  const transport: WebhookTransport = async (req) => {
    requests.push(req);
    const next = statuses.shift() ?? 204;
    if (next === "network") throw new Error("ECONNREFUSED");
    return { status: next };
  };
  return { requests, transport };
}

/** The partner-API lender config a partner must be bound to. */
async function partnerConfig(key: string, mode: "sandbox" | "live" = "sandbox") {
  await db.insert(providerConfigs).values({ kind: "lender", key, adapter: "partner_api", mode, enabled: true });
  return key;
}

async function opsPair() {
  return { maker: await staff("ops.maker", "ops_admin"), checker: await staff("ops.checker", "ops_admin") };
}

/** A partner with an approved key (all scopes) and, optionally, an approved webhook URL. */
async function setupPartner(label: string, opts: { webhook?: boolean; environment?: "sandbox" | "live" } = {}) {
  const { maker, checker } = await opsPair();
  const key = await partnerConfig(uniqueKey(label), opts.environment ?? "sandbox");
  const partner = await createPartner(db, {
    staffId: maker,
    key,
    name: "Partner Bank", // matches offerFor()'s lenderName
    environment: opts.environment ?? "sandbox",
    lenderKey: key,
  });
  const issued = await proposeApiKey(db, {
    staffId: maker,
    partnerId: partner.id,
    label: "Decision service",
    scopes: ["proposals:read", "decisions:write", "events:read"],
  });
  await decideApiKey(db, { staffId: checker, keyId: issued.id, approve: true });
  let webhook: { id: string; secret: string } | null = null;
  if (opts.webhook) {
    webhook = await proposeWebhookEndpoint(db, {
      staffId: maker,
      partnerId: partner.id,
      url: `https://${key.replace(/_/g, "-")}.partner.example/hooks`,
      production: false,
    });
    await decideWebhookEndpoint(db, { staffId: checker, endpointId: webhook.id, approve: true });
  }
  const auth = (await authenticateApiKey(db, issued.key))!;
  return { partner, maker, checker, apiKey: issued.key, keyId: issued.id, auth, webhook };
}

const offerFor = (amount: number, tenor: number) => ({
  expiresAt: new Date(Date.now() + 7 * 86_400_000),
  terms: illustrativeOffer({
    lenderName: "Partner Bank",
    amount,
    tenorMonths: tenor,
    annualInterestRatePct: 18,
    processingFeePct: 2,
    coolingOffDays: 3,
    kfsReference: "KFS-TEST-1",
  }),
});
const decision = (over: Partial<PartnerDecisionInput> = {}): PartnerDecisionInput => {
  const d = {
    outcome: "approved" as const,
    approvedExposure: 120_000,
    approvedTenorMonths: 12,
    decisionBasis: "traditional" as const,
    reasonCodes: [] as string[],
    decidedAt: null,
    lenderReference: "BANK-REF-1",
    ...over,
  };
  const offer =
    "offer" in over
      ? (over.offer ?? null)
      : d.outcome === "declined" || d.approvedExposure === null || d.approvedTenorMonths === null
        ? null
        : offerFor(d.approvedExposure, d.approvedTenorMonths);
  return { ...d, offer };
};

describe("partner API keys (maker-checker)", () => {
  it("a key works only after a second ops admin approves it; revocation is immediate", async () => {
    const { maker, checker } = await opsPair();
    const p = await createPartner(db, {
      staffId: maker,
      key: uniqueKey("keys"),
      name: "Key Partner",
      environment: "sandbox",
      lenderKey: await partnerConfig(uniqueKey("keys_lender")),
    });
    const issued = await proposeApiKey(db, {
      staffId: maker,
      partnerId: p.id,
      label: "Main",
      scopes: ["proposals:read"],
    });
    expect(issued.key).toMatch(/^cck_test_/);
    const [stored] = await db.select().from(partnerApiKeys).where(eq(partnerApiKeys.id, issued.id));
    expect(stored!.secretHash).not.toContain(issued.key.slice(-43));
    expect(await authenticateApiKey(db, issued.key)).toBeNull(); // pending

    await expect(decideApiKey(db, { staffId: maker, keyId: issued.id, approve: true })).rejects.toMatchObject({
      code: "self_approval",
    });
    await decideApiKey(db, { staffId: checker, keyId: issued.id, approve: true });
    const auth = await authenticateApiKey(db, issued.key);
    expect(auth).toMatchObject({ scopes: ["proposals:read"], partner: { id: p.id, environment: "sandbox" } });
    expect(await authenticateApiKey(db, issued.key.slice(0, -1) + (issued.key.endsWith("A") ? "B" : "A"))).toBeNull();

    await setPartnerStatus(db, { staffId: maker, partnerId: p.id, status: "suspended", reason: "incident drill" });
    expect(await authenticateApiKey(db, issued.key)).toBeNull();
    await setPartnerStatus(db, { staffId: maker, partnerId: p.id, status: "active", reason: "drill over" });
    expect(await authenticateApiKey(db, issued.key)).not.toBeNull();

    await revokeApiKey(db, { staffId: maker, keyId: issued.id, reason: "rotating out" });
    expect(await authenticateApiKey(db, issued.key)).toBeNull();
    // The database keeps keys and their hashes immutable.
    await expect(db.delete(partnerApiKeys).where(eq(partnerApiKeys.id, issued.id))).rejects.toThrow();
    await expect(
      db.update(partnerApiKeys).set({ status: "active" }).where(eq(partnerApiKeys.id, issued.id)),
    ).rejects.toThrow();
  });

  it("an approval can't happen after 48 hours; rotation retires the old key after the overlap", async () => {
    const { maker, checker, partner, keyId, apiKey } = await setupPartner("rotate");
    const old = new Date(Date.now() - 49 * 3_600_000);
    const stale = await proposeApiKey(db, {
      staffId: maker,
      partnerId: partner.id,
      label: "Late",
      scopes: ["events:read"],
      now: old,
    });
    await expect(decideApiKey(db, { staffId: checker, keyId: stale.id, approve: true })).rejects.toMatchObject({
      code: "expired",
    });
    expect(await authenticateApiKey(db, stale.key)).toBeNull();

    const next = await proposeApiKey(db, {
      staffId: maker,
      partnerId: partner.id,
      label: "Rotated",
      scopes: ["proposals:read"],
      replacesKeyId: keyId,
      overlapHours: 24,
    });
    const t = new Date();
    await decideApiKey(db, { staffId: checker, keyId: next.id, approve: true, now: t });
    expect(await authenticateApiKey(db, next.key)).not.toBeNull();
    expect(await authenticateApiKey(db, apiKey, new Date(t.getTime() + 23 * 3_600_000))).not.toBeNull();
    expect(await authenticateApiKey(db, apiKey, new Date(t.getTime() + 25 * 3_600_000))).toBeNull();
  });

  it("a key only authenticates for its own environment", async () => {
    const { apiKey } = await setupPartner("env");
    const forged = apiKey.replace("cck_test_", "cck_live_");
    expect(await authenticateApiKey(db, forged)).toBeNull();
  });
});

describe("signed webhooks", () => {
  it("delivers a thin, signed event; retries with backoff; dead after the limit; redeliverable", async () => {
    const { partner, maker, webhook } = await setupPartner("hooks", { webhook: true });
    const ok = fakeTransport();
    const { sendTestPing } = await import("@/modules/partners");
    await sendTestPing(db, { staffId: maker, partnerId: partner.id });
    const now = new Date();
    expect(await deliverPartnerWebhooks({ db, now, transport: ok.transport })).toMatchObject({ delivered: 1 });
    const [req] = ok.requests;
    const envelope = JSON.parse(req!.body);
    expect(envelope).toMatchObject({ type: "ping", data: {} });
    expect(Object.keys(envelope).sort()).toEqual(["createdAt", "data", "id", "type"]);
    expect(req!.headers["creatorco-event-id"]).toBe(envelope.id);
    expect(
      verifyWebhookSignature({
        header: req!.headers["creatorco-signature"]!,
        body: req!.body,
        secret: webhook!.secret,
        now,
      }),
    ).toBe(true);

    // Failing receiver: backoff, then dead.
    await sendTestPing(db, { staffId: maker, partnerId: partner.id });
    const failing = fakeTransport(Array(MAX_DELIVERY_ATTEMPTS).fill(500));
    let at = new Date();
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i += 1) {
      await deliverPartnerWebhooks({ db, now: at, transport: failing.transport });
      // Nothing is due again before the backoff passes.
      expect(await deliverPartnerWebhooks({ db, now: at, transport: failing.transport })).toMatchObject({
        delivered: 0,
      });
      at = new Date(at.getTime() + 3 * 3_600_000);
    }
    expect(failing.requests).toHaveLength(MAX_DELIVERY_ATTEMPTS);
    const [dead] = await db
      .select()
      .from(partnerWebhookDeliveries)
      .where(and(eq(partnerWebhookDeliveries.endpointId, webhook!.id), eq(partnerWebhookDeliveries.status, "dead")));
    expect(dead).toMatchObject({ attempts: MAX_DELIVERY_ATTEMPTS, lastHttpStatus: 500, lastError: "http_500" });

    await redeliver(db, { staffId: maker, deliveryId: dead!.id });
    expect(await deliverPartnerWebhooks({ db, transport: ok.transport })).toMatchObject({ delivered: 1 });
  });

  it("a network failure or redirect is a failed attempt", async () => {
    const { partner, maker } = await setupPartner("hooks2", { webhook: true });
    const { sendTestPing } = await import("@/modules/partners");
    await sendTestPing(db, { staffId: maker, partnerId: partner.id });
    await sendTestPing(db, { staffId: maker, partnerId: partner.id });
    const t = fakeTransport(["network", 302]);
    expect(await deliverPartnerWebhooks({ db, transport: t.transport })).toMatchObject({ delivered: 0, retrying: 2 });
    const rows = await db
      .select({ lastError: partnerWebhookDeliveries.lastError })
      .from(partnerWebhookDeliveries)
      .innerJoin(partnerEvents, eq(partnerEvents.id, partnerWebhookDeliveries.eventId))
      .where(eq(partnerEvents.partnerId, partner.id));
    expect(rows.map((r) => r.lastError).sort()).toEqual(["http_302", "network"]);
  });

  it("rotation signs with both secrets for the overlap; a new URL needs approval and takes over pending deliveries", async () => {
    const { partner, maker, checker, webhook } = await setupPartner("hooks3", { webhook: true });
    const rotated = await rotateWebhookSecret(db, { staffId: maker, endpointId: webhook!.id });
    const { sendTestPing } = await import("@/modules/partners");
    await sendTestPing(db, { staffId: maker, partnerId: partner.id });
    const t = fakeTransport();
    const now = new Date();
    await deliverPartnerWebhooks({ db, now, transport: t.transport });
    const req = t.requests[0]!;
    for (const secret of [webhook!.secret, rotated.secret])
      expect(verifyWebhookSignature({ header: req.headers["creatorco-signature"]!, body: req.body, secret, now })).toBe(
        true,
      );

    // A pending event, then a new URL: the event moves to the new URL once approved.
    await sendTestPing(db, { staffId: maker, partnerId: partner.id });
    const next = await proposeWebhookEndpoint(db, {
      staffId: maker,
      partnerId: partner.id,
      url: "https://new-receiver.partner.example/hooks",
      production: false,
    });
    await expect(
      proposeWebhookEndpoint(db, {
        staffId: maker,
        partnerId: partner.id,
        url: "https://x.partner.example/h",
        production: false,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      decideWebhookEndpoint(db, { staffId: maker, endpointId: next.id, approve: true }),
    ).rejects.toMatchObject({
      code: "self_approval",
    });
    await decideWebhookEndpoint(db, { staffId: checker, endpointId: next.id, approve: true });
    const t2 = fakeTransport();
    expect(await deliverPartnerWebhooks({ db, transport: t2.transport })).toMatchObject({ delivered: 1 });
    expect(t2.requests[0]!.url).toBe("https://new-receiver.partner.example/hooks");

    await retireWebhookEndpoint(db, { staffId: maker, endpointId: next.id });
    await sendTestPing(db, { staffId: maker, partnerId: partner.id });
    expect(await deliverPartnerWebhooks({ db, transport: t2.transport })).toMatchObject({ delivered: 0 });
    // …but the feed still has every event.
    const feed = await listPartnerEvents(db, { partnerId: partner.id });
    expect(feed.data.length).toBeGreaterThanOrEqual(3);
    expect(feed.data.every((e) => e.type === "ping")).toBe(true);
    const page2 = await listPartnerEvents(db, { partnerId: partner.id, after: feed.data[0]!.seq });
    expect(page2.data[0]!.seq).toBe(feed.data[1]!.seq);
  });

  it("production rejects non-HTTPS and private webhook URLs", async () => {
    const { partner, maker } = await setupPartner("hooks4");
    for (const url of ["http://partner.example/h", "https://localhost/h", "https://10.0.0.1/h"])
      await expect(
        proposeWebhookEndpoint(db, { staffId: maker, partnerId: partner.id, url, production: true }),
      ).rejects.toMatchObject({
        code: "invalid",
      });
  });
});

describe("partner lender flow (pull + thin webhooks)", () => {
  it("sends, lets the partner fetch and decide, then a reviewer confirms", async () => {
    const s = await setupPartner("flow", { webhook: true });
    const lender = partnerLender(s.partner.lenderKey);
    const c = await confirmedCheck("partnerflow");
    const p = (await proposeIfShared({ db, lender }, c))!;
    // Sent, but no decision is polled: the partner posts it.
    expect(p).toMatchObject({ status: "submitted", lender: s.partner.lenderKey, policyVersion: null });
    await processLenderProposals({ db, lender });
    expect((await db.select().from(creditProposals).where(eq(creditProposals.id, p.id)))[0]!.status).toBe("submitted");

    // A thin, signed proposal.submitted webhook.
    const t = fakeTransport();
    const now = new Date();
    await deliverPartnerWebhooks({ db, now, transport: t.transport });
    const event = JSON.parse(t.requests.find((r) => r.body.includes(p.id))!.body);
    expect(event).toMatchObject({ type: "proposal.submitted", data: { proposalId: p.id } });
    expect(JSON.stringify(event)).not.toMatch(/requestedAmount|financialCapacity|grade/);

    // The partner lists and fetches it (audited); another partner can't see it.
    const list = await listPartnerProposals(db, { lenderKey: s.partner.lenderKey, status: "awaiting_decision" });
    expect(list.data.map((x) => x.id)).toContain(p.id);
    const other = await setupPartner("flow_other");
    expect((await listPartnerProposals(db, { lenderKey: other.partner.lenderKey })).data).toHaveLength(0);
    expect(
      await getPartnerProposal(db, { lenderKey: other.partner.lenderKey, proposalId: p.id, apiKeyId: other.keyId }),
    ).toBeNull();
    const fetched = (await getPartnerProposal(db, {
      lenderKey: s.partner.lenderKey,
      proposalId: p.id,
      apiKeyId: s.keyId,
    }))!;
    expect(fetched).toMatchObject({ status: "awaiting_decision", decisions: [], queries: [], confirmation: null });
    expect(fetched.payload.dataGroups).toEqual(p.dataGroups);
    expect(JSON.stringify(fetched)).not.toMatch(/policyVersion|simulat/);
    const [read] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, p.id), eq(auditEvents.eventType, "lending.proposal_fetched")));
    expect(read).toMatchObject({ actorType: "partner", actorId: s.keyId });

    // Decide, idempotently.
    const post = (over: Partial<PartnerDecisionInput> = {}, key = "decision-0001", hash = "a".repeat(64)) =>
      recordPartnerDecision(db, {
        lenderKey: s.partner.lenderKey,
        apiKey: { id: s.keyId, prefix: s.auth.keyPrefix },
        proposalId: p.id,
        idempotencyKey: key,
        requestHash: hash,
        decision: decision(over),
      });
    await expect(
      recordPartnerDecision(db, {
        lenderKey: other.partner.lenderKey,
        apiKey: { id: other.keyId, prefix: other.auth.keyPrefix },
        proposalId: p.id,
        idempotencyKey: "decision-9999",
        requestHash: "c".repeat(64),
        decision: decision(),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    const first = await post();
    expect(first).toMatchObject({
      replayed: false,
      decision: { revision: 1, source: "partner_api", outcome: "approved" },
    });
    expect((await post()).replayed).toBe(true);
    await expect(post({}, "decision-0001", "b".repeat(64))).rejects.toMatchObject({ code: "conflict" });
    await expect(post({}, "decision-0002", "b".repeat(64))).rejects.toMatchObject({ code: "wrong_state" });

    // The creator sees nothing until a reviewer acts; staff can't override a partner decision.
    expect(await getCreatorLenderView(db, c)).toEqual({ stage: "with_lender", simulated: false });
    const reviewer = await staff("reviewer");
    await expect(
      reviewDecision(db, {
        staffId: reviewer,
        proposalId: p.id,
        decisionId: await decisionIdOf(p.id),
        action: "override",
        outcome: "modified",
        exposure: 50_000,
        tenorMonths: 6,
        reason: "trying to reduce the amount",
      }),
    ).rejects.toBeInstanceOf(LendingError);

    // Query → partner revises → query resolved → confirm.
    const q = await raiseDecisionQuery(db, {
      staffId: reviewer,
      proposalId: p.id,
      decisionId: await decisionIdOf(p.id),
      message: "Please re-check: the bank coverage was partial.",
    });
    await expect(
      raiseDecisionQuery(db, {
        staffId: reviewer,
        proposalId: p.id,
        decisionId: await decisionIdOf(p.id),
        message: "A second query now",
      }),
    ).rejects.toMatchObject({
      code: "wrong_state",
    });
    await expect(
      reviewDecision(db, {
        staffId: reviewer,
        proposalId: p.id,
        decisionId: await decisionIdOf(p.id),
        action: "confirm",
      }),
    ).rejects.toMatchObject({
      code: "wrong_state",
    });
    expect(
      (await listPartnerProposals(db, { lenderKey: s.partner.lenderKey, status: "query_open" })).data.map((x) => x.id),
    ).toEqual([p.id]);
    const t2 = fakeTransport();
    await deliverPartnerWebhooks({ db, transport: t2.transport });
    expect(JSON.parse(t2.requests.at(-1)!.body)).toMatchObject({
      type: "decision.queried",
      data: { proposalId: p.id, queryId: q.id },
    });
    const queried = (await getPartnerProposal(db, {
      lenderKey: s.partner.lenderKey,
      proposalId: p.id,
      apiKeyId: s.keyId,
    }))!;
    expect(queried.queries).toEqual([
      expect.objectContaining({ id: q.id, onRevision: 1, message: q.message, answeredByRevision: null }),
    ]);
    expect(JSON.stringify(queried.queries)).not.toMatch(/@/); // no staff identity

    const revisionOneId = await decisionIdOf(p.id);
    const revised = await post(
      { outcome: "modified", approvedExposure: 90_000, reasonCodes: ["COVERAGE"] },
      "decision-0003",
      "d".repeat(64),
    );
    expect(revised.decision.revision).toBe(2);
    const detail = (await getProposalDetail(db, p.id))!;
    expect(detail).toMatchObject({ simulated: false, openQuery: null, reviewActions: ["confirm", "query"] });
    expect(detail.decision!.revision).toBe(2);

    // A reviewer still looking at revision 1 can't confirm revision 2 by accident.
    await expect(
      reviewDecision(db, { staffId: reviewer, proposalId: p.id, decisionId: revisionOneId, action: "confirm" }),
    ).rejects.toMatchObject({ code: "wrong_state" });
    await reviewDecision(db, {
      staffId: reviewer,
      proposalId: p.id,
      decisionId: await decisionIdOf(p.id),
      action: "confirm",
    });
    expect(await getCreatorLenderView(db, c)).toMatchObject({
      stage: "decided",
      outcome: "modified",
      amount: 90_000,
      simulated: false,
      adjusted: false,
    });
    const confirmed = (await getPartnerProposal(db, {
      lenderKey: s.partner.lenderKey,
      proposalId: p.id,
      apiKeyId: s.keyId,
    }))!;
    expect(confirmed).toMatchObject({ status: "confirmed", confirmation: { revision: 2 } });
    const t3 = fakeTransport();
    await deliverPartnerWebhooks({ db, transport: t3.transport });
    expect(t3.requests.map((r) => JSON.parse(r.body).type)).toContain("decision.confirmed");
    // After confirmation, no more revisions.
    await expect(post({}, "decision-0004", "e".repeat(64))).rejects.toMatchObject({ code: "wrong_state" });
  });

  it("the simulated lender keeps confirm/override and can't be queried", async () => {
    const c = await confirmedCheck("simquery");
    const p = (await proposeIfShared({ db, lender: new MockLenderProvider() }, c))!;
    expect(p.status).toBe("decided");
    const reviewer = await staff("simreviewer");
    await expect(
      raiseDecisionQuery(db, {
        staffId: reviewer,
        proposalId: p.id,
        decisionId: await decisionIdOf(p.id),
        message: "Can the simulated lender re-check?",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect((await getProposalDetail(db, p.id))!.reviewActions).toEqual(["confirm", "override"]);
    // No partner is registered for the simulated lender, so no events were recorded for it.
    const events = await db.select().from(partnerEvents).where(eq(partnerEvents.proposalId, p.id));
    expect(events).toHaveLength(0);
  });

  it("partner keys and lender configs are one-to-one", async () => {
    const s = await setupPartner("unique");
    await expect(
      createPartner(db, {
        staffId: s.maker,
        key: uniqueKey("dup"),
        name: "Dup",
        environment: "sandbox",
        lenderKey: s.partner.lenderKey,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      db.update(partners).set({ lenderKey: "other_x" }).where(eq(partners.id, s.partner.id)),
    ).rejects.toThrow();
  });
});

describe("Stage 12b review fixes", () => {
  it("a partner must be bound to a partner-API config in its own environment (live only in production)", async () => {
    const { maker } = await opsPair();
    const base = { staffId: maker, name: "Bound", environment: "sandbox" };
    await expect(
      createPartner(db, { ...base, key: uniqueKey("b1"), lenderKey: "no_such_config" }),
    ).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(createPartner(db, { ...base, key: uniqueKey("b2"), lenderKey: "mock_re" })).rejects.toMatchObject({
      code: "invalid",
    });
    const live = await partnerConfig(uniqueKey("b3"), "live");
    await expect(createPartner(db, { ...base, key: uniqueKey("b3"), lenderKey: live })).rejects.toMatchObject({
      code: "invalid",
    });
    const sandbox = await partnerConfig(uniqueKey("b4"));
    await expect(
      createPartner(db, { ...base, key: uniqueKey("b4"), lenderKey: sandbox, production: true }),
    ).rejects.toMatchObject({ code: "invalid" });
    // Partner reads never include simulated-lender proposals, whatever the key.
    expect((await listPartnerProposals(db, { lenderKey: "mock_re" })).data).toHaveLength(0);
  });

  it("an unanswered query can be withdrawn; queries need an active partner", async () => {
    const s = await setupPartner("withdraw", { webhook: true });
    const c = await confirmedCheck("withdrawq");
    const p = (await proposeIfShared({ db, lender: partnerLender(s.partner.lenderKey) }, c))!;
    await recordPartnerDecision(db, {
      lenderKey: s.partner.lenderKey,
      apiKey: { id: s.keyId, prefix: s.auth.keyPrefix },
      proposalId: p.id,
      idempotencyKey: "withdraw-0001",
      requestHash: "f".repeat(64),
      decision: decision(),
    });
    const reviewer = await staff("withdrawer");
    await setPartnerStatus(db, { staffId: s.maker, partnerId: s.partner.id, status: "suspended", reason: "paused" });
    await expect(
      raiseDecisionQuery(db, {
        staffId: reviewer,
        proposalId: p.id,
        decisionId: await decisionIdOf(p.id),
        message: "Please look at this again.",
      }),
    ).rejects.toMatchObject({ code: "wrong_state" });
    await setPartnerStatus(db, { staffId: s.maker, partnerId: s.partner.id, status: "active", reason: "resumed" });
    const q = await raiseDecisionQuery(db, {
      staffId: reviewer,
      proposalId: p.id,
      decisionId: await decisionIdOf(p.id),
      message: "Please look at this again.",
    });
    await expect(
      withdrawDecisionQuery(db, { staffId: reviewer, proposalId: p.id, reason: "short" }),
    ).rejects.toMatchObject({
      code: "invalid",
    });
    await withdrawDecisionQuery(db, {
      staffId: reviewer,
      proposalId: p.id,
      reason: "Partner unresponsive for a week.",
    });
    const events = await db.select().from(partnerEvents).where(eq(partnerEvents.queryId, q.id));
    expect(events.map((e) => e.type).sort()).toEqual(["decision.queried", "decision.query_withdrawn"]);
    const seen = (await getPartnerProposal(db, {
      lenderKey: s.partner.lenderKey,
      proposalId: p.id,
      apiKeyId: s.keyId,
    }))!;
    expect(seen.status).toBe("decided");
    expect(seen.queries[0]).toMatchObject({ answeredByRevision: null, withdrawnAt: expect.any(String) });
    expect(JSON.stringify(seen)).not.toContain("unresponsive"); // the reason stays internal
    // The partner can no longer revise; staff can confirm.
    await expect(
      recordPartnerDecision(db, {
        lenderKey: s.partner.lenderKey,
        apiKey: { id: s.keyId, prefix: s.auth.keyPrefix },
        proposalId: p.id,
        idempotencyKey: "withdraw-0002",
        requestHash: "0".repeat(64),
        decision: decision({ outcome: "declined", approvedExposure: null, approvedTenorMonths: null }),
      }),
    ).rejects.toMatchObject({ code: "wrong_state" });
    await reviewDecision(db, {
      staffId: reviewer,
      proposalId: p.id,
      decisionId: await decisionIdOf(p.id),
      action: "confirm",
    });
    expect(await getCreatorLenderView(db, c)).toMatchObject({ stage: "decided", outcome: "approved" });
  });

  it("the issuer can cancel their own pending key; nobody else can", async () => {
    const s = await setupPartner("cancel");
    const issued = await proposeApiKey(db, {
      staffId: s.maker,
      partnerId: s.partner.id,
      label: "Oops",
      scopes: ["events:read"],
    });
    await expect(cancelApiKey(db, { staffId: s.checker, keyId: issued.id })).rejects.toMatchObject({
      code: "wrong_state",
    });
    await cancelApiKey(db, { staffId: s.maker, keyId: issued.id });
    await expect(decideApiKey(db, { staffId: s.checker, keyId: issued.id, approve: true })).rejects.toMatchObject({
      code: "not_pending",
    });
    expect(await authenticateApiKey(db, issued.key)).toBeNull();
  });

  it("a key stops working if its lender config leaves the partner's environment", async () => {
    const s = await setupPartner("rebind");
    expect(await authenticateApiKey(db, s.apiKey)).not.toBeNull();
    await db
      .update(providerConfigs)
      .set({ mode: "live", version: 2 })
      .where(and(eq(providerConfigs.kind, "lender"), eq(providerConfigs.key, s.partner.lenderKey)));
    expect(await authenticateApiKey(db, s.apiKey)).toBeNull();
  });
});
