import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  bureauSummaries,
  consentReceipts,
  creditApplications,
  creditProposals,
  offerResponses,
  partnerEvents,
  providerConfigs,
  underwritingRuns,
} from "@/db/schema";
import { CONSENT_KEYS } from "@/modules/consent";
import {
  acceptOffer,
  declineOffer,
  getCreatorLenderView,
  getPartnerProposal,
  getProposalDetail,
  heldLenderCheckIds,
  lenderRetentionHold,
  proposeIfShared,
  recordPartnerDecision,
  reviewDecision,
  type CreatorOffer,
} from "@/modules/lending";
import { authenticateApiKey, createPartner, decideApiKey, proposeApiKey } from "@/modules/partners";
import { processDeferredErasures, withdrawPurpose } from "@/modules/privacy";
import {
  runBureauCheck,
  saveApplicationDetails,
  startApplication,
} from "@/modules/financial-eligibility/application-service";
import { runUnderwriting } from "@/modules/underwriting/underwriting-service";
import { MockCreditBureauProvider } from "@/providers/bureau/mock-credit-bureau-provider";
import { MockLenderProvider } from "@/providers/lender/mock-lender-provider";
import { illustrativeOffer } from "@/providers/lender/offer";
import { PartnerApiLenderProvider } from "@/providers/lender/partner-api-lender-provider";
import type { LenderProvider } from "@/providers/lender/types";

import { connectTestDb } from "../support/db";
import { shareAndConfirm } from "../support/eligibility";
import { lendingFixtures } from "../support/lending";

const { db } = connectTestDb();
const { confirmedCheck, staff, seed, uniquePan, details } = lendingFixtures(db, { panSeed: 800 });
const mock = new MockLenderProvider();
const DAY = 86_400_000;
const HANDOFF = () => seed(CONSENT_KEYS.lenderHandoff);

const decisionIdOf = async (proposalId: string) => (await getProposalDetail(db, proposalId))!.decision!.id;

/** A creator with a reviewed simulated decision; returns the open offer. */
async function reviewedOffer(
  label: string,
  opts: {
    review?: "confirm" | "override";
    userCheck?: { userId: string; applicationId: string };
    reviewAt?: Date;
  } = {},
) {
  const c = opts.userCheck ?? (await confirmedCheck(label));
  const p = (await proposeIfShared({ db, lender: mock }, c))!;
  const reviewer = await staff(`${label}.rev`);
  const detail = (await getProposalDetail(db, p.id))!;
  if (detail.decision!.outcome === "declined") throw new Error("fixture expected an approval");
  const review = opts.review ?? "confirm";
  await reviewDecision(db, {
    staffId: reviewer,
    proposalId: p.id,
    decisionId: detail.decision!.id,
    action: review,
    now: opts.reviewAt,
    ...(review === "override"
      ? { outcome: "modified" as const, exposure: 20_000, tenorMonths: 6, reason: "Reduce for the pilot cohort." }
      : {}),
  });
  const view = await getCreatorLenderView(db, { ...c, now: opts.reviewAt });
  if (view.stage !== "decided" || !view.offer) throw new Error("no offer");
  return { ...c, proposalId: p.id, offer: view.offer as CreatorOffer, decision: detail.decision! };
}

const acceptInput = (o: { userId: string; applicationId: string; offer: CreatorOffer }) => ({
  userId: o.userId,
  applicationId: o.applicationId,
  termsHash: o.offer.termsHash,
  kfsAcknowledged: true,
  consentDefinitionId: HANDOFF(),
  source: "settings" as const,
});

async function handoffReceipts(userId: string) {
  return db
    .select()
    .from(consentReceipts)
    .where(and(eq(consentReceipts.userId, userId), eq(consentReceipts.consentDefinitionId, HANDOFF())));
}

describe("offers (Stage 13) — simulated lender", () => {
  it("the creator accepts exactly the terms shown, with KFS and consent given in the same step", async () => {
    const o = await reviewedOffer("accept");
    expect(o.offer).toMatchObject({ state: "open", respondedAt: null });
    expect(o.offer.terms.sanctionedAmount).toBe(o.decision.approvedExposure);
    expect(o.offer.terms.lenderName).toBe("Simulated partner lender");
    expect(await lenderRetentionHold(db, o.userId)).toBe(true);

    await expect(acceptOffer(db, { ...acceptInput(o), kfsAcknowledged: false })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(acceptOffer(db, { ...acceptInput(o), termsHash: "0".repeat(64) })).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(acceptOffer(db, { ...acceptInput(o), userId: await staff("intruder") })).rejects.toMatchObject({
      code: "not_found",
    });
    // A failed acceptance never leaves the handoff consent granted.
    expect(await handoffReceipts(o.userId)).toHaveLength(0);

    const row = await acceptOffer(db, acceptInput(o));
    expect(row).toMatchObject({ response: "accepted", kfsAcknowledged: true, termsHash: o.offer.termsHash });
    const [receipt] = await handoffReceipts(o.userId);
    expect(receipt).toMatchObject({ status: "granted", metadata: { surface: "offer" } });
    await expect(acceptOffer(db, acceptInput(o))).rejects.toMatchObject({ code: "wrong_state" });
    await expect(declineOffer(db, { userId: o.userId, applicationId: o.applicationId })).rejects.toMatchObject({
      code: "wrong_state",
    });

    expect(await getCreatorLenderView(db, o)).toMatchObject({ stage: "decided", offer: { state: "accepted" } });
    expect(await lenderRetentionHold(db, o.userId)).toBe(true);
    await expect(db.delete(offerResponses).where(eq(offerResponses.id, row.id))).rejects.toThrow();
    // No partner is registered for the simulated lender: nothing is announced.
    expect(await db.select().from(partnerEvents).where(eq(partnerEvents.proposalId, o.proposalId))).toHaveLength(0);
  });

  it("can't be accepted once financial-eligibility consent is withdrawn or membership paused", async () => {
    const a = await reviewedOffer("nofin");
    await withdrawPurpose({ db }, { userId: a.userId, key: CONSENT_KEYS.financialEligibility, source: "settings" });
    await expect(acceptOffer(db, acceptInput(a))).rejects.toMatchObject({ code: "consent_required" });

    const b = await reviewedOffer("paused");
    await withdrawPurpose({ db }, { userId: b.userId, key: CONSENT_KEYS.creatorProfile, source: "settings" });
    await expect(acceptOffer(db, acceptInput(b))).rejects.toMatchObject({ code: "wrong_state" });
    expect(await handoffReceipts(b.userId)).toHaveLength(0);
  });

  it("declined: data is kept until withdrawal, then really erased (inputs, runs and lender records)", async () => {
    const o = await reviewedOffer("decline");
    await declineOffer(db, { userId: o.userId, applicationId: o.applicationId, reason: "terms" });
    expect(await getCreatorLenderView(db, o)).toMatchObject({ offer: { state: "declined", declineReason: "terms" } });
    expect(await lenderRetentionHold(db, o.userId)).toBe(false);
    // Still all there before withdrawal.
    expect(
      await db.select().from(bureauSummaries).where(eq(bureauSummaries.applicationId, o.applicationId)),
    ).toHaveLength(1);

    const result = await withdrawPurpose(
      { db },
      { userId: o.userId, key: CONSENT_KEYS.financialEligibility, source: "settings" },
    );
    expect(result.erasures).toEqual([expect.objectContaining({ scope: "financial_inputs", status: "completed" })]);
    const [app] = await db.select().from(creditApplications).where(eq(creditApplications.id, o.applicationId));
    expect(app).toMatchObject({ status: "submitted", requestedAmount: null });
    expect(app!.inputsErasedAt).not.toBeNull();
    expect(
      await db.select().from(bureauSummaries).where(eq(bureauSummaries.applicationId, o.applicationId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(underwritingRuns).where(eq(underwritingRuns.applicationId, o.applicationId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(creditProposals).where(eq(creditProposals.applicationId, o.applicationId)),
    ).toHaveLength(0);
    expect(await getCreatorLenderView(db, o)).toEqual({ stage: "closed" });
  });

  it("holds per check: an open offer on one check doesn't keep a declined one", async () => {
    const pan = uniquePan();
    const first = await confirmedCheck("percheck", { pan });
    const declined = await reviewedOffer("percheck1", { userCheck: first });
    await declineOffer(db, { userId: declined.userId, applicationId: declined.applicationId });
    // A second check for the same creator (same PAN), reaching an open offer.
    const app2 = await startApplication(
      { db },
      { userId: first.userId, consentDefinitionId: seed(CONSENT_KEYS.financialEligibility), source: "settings" },
    );
    await saveApplicationDetails({ db }, { userId: first.userId, applicationId: app2.id, details });
    await runBureauCheck(
      { db, bureau: new MockCreditBureauProvider() },
      { userId: first.userId, applicationId: app2.id, pan },
    );
    await shareAndConfirm(db, { userId: first.userId, applicationId: app2.id, mobile: "9876543215" });
    await runUnderwriting(db, { userId: first.userId, applicationId: app2.id });
    await reviewedOffer("percheck2", { userCheck: { userId: first.userId, applicationId: app2.id } });

    expect(await heldLenderCheckIds(db, first.userId)).toEqual([app2.id]);
    const result = await withdrawPurpose(
      { db },
      { userId: first.userId, key: CONSENT_KEYS.financialEligibility, source: "settings" },
    );
    expect(result.erasures).toEqual([expect.objectContaining({ status: "deferred" })]);
    // The declined check is erased now; the open one waits for its offer.
    const [one] = await db.select().from(creditApplications).where(eq(creditApplications.id, first.applicationId));
    const [two] = await db.select().from(creditApplications).where(eq(creditApplications.id, app2.id));
    expect(one!.inputsErasedAt).not.toBeNull();
    expect(two!.inputsErasedAt).toBeNull();
  });

  it("an unanswered offer expires; the deferred erasure completes once it has", async () => {
    const o = await reviewedOffer("expire");
    const later = new Date(o.offer.expiresAt.getTime() + DAY);
    expect(await getCreatorLenderView(db, { ...o, now: later })).toMatchObject({ offer: { state: "expired" } });
    await expect(acceptOffer(db, { ...acceptInput(o), now: later })).rejects.toMatchObject({ code: "wrong_state" });

    const result = await withdrawPurpose(
      { db },
      { userId: o.userId, key: CONSENT_KEYS.financialEligibility, source: "settings" },
    );
    expect(result.erasures).toEqual([expect.objectContaining({ status: "deferred" })]);
    await processDeferredErasures({ db }); // still open: nothing more happens
    expect(
      await db.select().from(bureauSummaries).where(eq(bureauSummaries.applicationId, o.applicationId)),
    ).toHaveLength(1);
    await processDeferredErasures({ db, now: later });
    expect(
      await db.select().from(bureauSummaries).where(eq(bureauSummaries.applicationId, o.applicationId)),
    ).toHaveLength(0);
  });

  it("the simulated offer's validity starts at review, and an override re-prices it", async () => {
    const reviewAt = new Date(Date.now() + 10 * DAY); // e.g. after a long fraud hold
    const o = await reviewedOffer("validity", { reviewAt });
    expect(o.offer.state).toBe("open");
    expect(o.offer.expiresAt.getTime()).toBe(reviewAt.getTime() + 7 * DAY);

    const r = await reviewedOffer("override", { review: "override" });
    expect(r.offer.terms).toMatchObject({ sanctionedAmount: 20_000, tenorMonths: 6, emiCount: 6 });
    const lenderTerms = (await getProposalDetail(db, r.proposalId))!.decision!.offerTerms as {
      annualInterestRatePct: number;
    };
    expect(r.offer.terms.annualInterestRatePct).toBe(lenderTerms.annualInterestRatePct);
  });
});

describe("offers (Stage 13) — partner lender", () => {
  async function partnerSetup(label: string) {
    const maker = await staff(`${label}.m`, "ops_admin");
    const checker = await staff(`${label}.c`, "ops_admin");
    const key = `p_${label}_${Date.now().toString(36)}`.slice(0, 40);
    await db
      .insert(providerConfigs)
      .values({ kind: "lender", key, adapter: "partner_api", mode: "sandbox", enabled: true });
    const partner = await createPartner(db, {
      staffId: maker,
      key,
      name: "Offer Bank",
      environment: "sandbox",
      lenderKey: key,
    });
    const issued = await proposeApiKey(db, {
      staffId: maker,
      partnerId: partner.id,
      label: "svc",
      scopes: ["proposals:read", "decisions:write"],
    });
    await decideApiKey(db, { staffId: checker, keyId: issued.id, approve: true });
    const auth = (await authenticateApiKey(db, issued.key))!;
    const lender: LenderProvider = new Proxy(new PartnerApiLenderProvider("sandbox"), {
      get: (t, p, r) => (p === "descriptor" ? { key, kind: "lender", mode: "sandbox" } : Reflect.get(t, p, r)),
    });
    return { key, auth, lender };
  }
  const terms = (lenderName = "Offer Bank") =>
    illustrativeOffer({
      lenderName,
      amount: 80_000,
      tenorMonths: 9,
      annualInterestRatePct: 17,
      processingFeePct: 1.5,
      coolingOffDays: 5,
      kfsReference: "OB-KFS-77",
    });
  const postFor =
    (s: Awaited<ReturnType<typeof partnerSetup>>, proposalId: string) =>
    (offer: { terms: ReturnType<typeof illustrativeOffer>; expiresAt: Date } | null, idem: string, now?: Date) =>
      recordPartnerDecision(db, {
        lenderKey: s.key,
        apiKey: { id: s.auth.keyId, prefix: s.auth.keyPrefix },
        proposalId,
        idempotencyKey: idem,
        requestHash: idem
          .replace(/[^0-9a-f]/g, "a")
          .padEnd(64, "a")
          .slice(0, 64),
        now,
        decision: {
          outcome: "approved",
          approvedExposure: 80_000,
          approvedTenorMonths: 9,
          decisionBasis: "traditional",
          reasonCodes: [],
          decidedAt: null,
          lenderReference: null,
          offer,
        },
      });

  it("partner terms flow to the creator; acceptance reaches the partner with the applicant's details", async () => {
    const s = await partnerSetup("po");
    const c = await confirmedCheck("partneroffer");
    const p = (await proposeIfShared({ db, lender: s.lender }, c))!;
    const post = postFor(s, p.id);
    await expect(post(null, "offer-none-1")).rejects.toMatchObject({ code: "invalid" });
    await expect(post({ terms: terms(), expiresAt: new Date(Date.now() - DAY) }, "offer-old-01")).rejects.toMatchObject(
      {
        code: "invalid",
      },
    );
    await expect(
      post({ terms: terms(), expiresAt: new Date(Date.now() + 90 * DAY) }, "offer-long-1"),
    ).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(
      post({ terms: terms("CreatorCo Finance"), expiresAt: new Date(Date.now() + DAY) }, "offer-name-1"),
    ).rejects.toMatchObject({
      code: "invalid",
    });
    const expiresAt = new Date(Date.now() + 5 * DAY);
    await post({ terms: terms(), expiresAt }, "offer-good-1");
    // An idempotent retry after the offer lapsed still returns the recorded decision.
    const replay = await post({ terms: terms(), expiresAt }, "offer-good-1", new Date(Date.now() + 6 * DAY));
    expect(replay.replayed).toBe(true);

    const reviewer = await staff("partner.rev");
    // A lapsed partner offer can't be confirmed.
    await expect(
      reviewDecision(db, {
        staffId: reviewer,
        proposalId: p.id,
        decisionId: await decisionIdOf(p.id),
        action: "confirm",
        now: new Date(Date.now() + 6 * DAY),
      }),
    ).rejects.toMatchObject({ code: "wrong_state" });
    await reviewDecision(db, {
      staffId: reviewer,
      proposalId: p.id,
      decisionId: await decisionIdOf(p.id),
      action: "confirm",
    });
    const view = await getCreatorLenderView(db, c);
    if (view.stage !== "decided" || !view.offer) throw new Error("no offer");
    expect(view.simulated).toBe(false);
    expect(view.offer.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(view.offer.terms).toMatchObject({ lenderName: "Offer Bank", kfsReference: "OB-KFS-77", coolingOffDays: 5 });

    const before = (await getPartnerProposal(db, { lenderKey: s.key, proposalId: p.id, apiKeyId: s.auth.keyId }))!;
    expect(before).toMatchObject({ offerResponse: null, applicant: null });
    expect(before.decisions[0]!.offer).toMatchObject({ terms: { kfsReference: "OB-KFS-77" } });

    await acceptOffer(db, { ...acceptInput({ ...c, offer: view.offer }) });
    const events = await db
      .select({ type: partnerEvents.type })
      .from(partnerEvents)
      .where(and(eq(partnerEvents.proposalId, p.id), eq(partnerEvents.type, "offer.accepted")));
    expect(events).toHaveLength(1);
    const after = (await getPartnerProposal(db, { lenderKey: s.key, proposalId: p.id, apiKeyId: s.auth.keyId }))!;
    expect(after.offerResponse).toMatchObject({ response: "accepted", termsHash: view.offer.termsHash });
    expect(after.applicant).toMatchObject({ legalName: "Ira Sen", email: expect.stringContaining("@"), mobile: null });

    await withdrawPurpose({ db }, { userId: c.userId, key: CONSENT_KEYS.lenderHandoff, source: "settings" });
    const withdrawn = (await getPartnerProposal(db, { lenderKey: s.key, proposalId: p.id, apiKeyId: s.auth.keyId }))!;
    expect(withdrawn.applicant).toBeNull();
    expect(withdrawn.offerResponse).toMatchObject({ response: "accepted" });
  });
});
