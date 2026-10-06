import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditEvents,
  creditApplications,
  creditProposals,
  lenderDecisions,
  simulatedLenderPolicies,
} from "@/db/schema";
import { CONSENT_KEYS } from "@/modules/consent";
import { closeApplication, saveApplicationDetails } from "@/modules/financial-eligibility/application-service";
import {
  decidePolicy,
  getActivePolicy,
  getCreatorLenderView,
  getProposalDetail,
  processLenderProposals,
  proposeIfShared,
  proposePolicy,
  releaseHeldProposal,
  retryProposal,
  reviewDecision,
  sendProposal,
  type LendingDeps,
} from "@/modules/lending";
import { withdrawPurpose } from "@/modules/privacy";
import { ProviderError } from "@/providers/errors";
import { MockLenderProvider } from "@/providers/lender/mock-lender-provider";
import { MINIMUM_PROPOSAL_PROFILE } from "@/providers/lender/proposal";
import type { LenderProvider } from "@/providers/lender/types";

import { connectTestDb } from "../support/db";
import { lendingFixtures } from "../support/lending";

const { db } = connectTestDb();
const lender = new MockLenderProvider();
const deps = (over: Partial<LendingDeps> = {}): LendingDeps => ({ db, lender, ...over });
const { confirmedCheck, staff, details, uniquePan } = lendingFixtures(db);
/** The latest decision revision's id (what the reviewer sees). */
const decisionIdOf = async (proposalId: string) => (await getProposalDetail(db, proposalId))!.decision!.id;

const failing = (base: LenderProvider = lender): LenderProvider =>
  new Proxy(base, {
    get: (t, p, r) =>
      p === "submitProposal"
        ? async () => {
            throw new ProviderError("unavailable", "down");
          }
        : Reflect.get(t, p, r),
  });

describe("credit proposals (Stage 12)", () => {
  it("nothing is proposed without the 'Share with a partner lender' consent", async () => {
    const c = await confirmedCheck("noshare", { share: false });
    expect(await proposeIfShared(deps(), c)).toBeNull();
    expect(await getCreatorLenderView(db, c)).toEqual({ stage: "not_shared" });
  });

  it("sends the minimum proposal, records the simulated decision, and shows it only after review", async () => {
    const c = await confirmedCheck("send");
    const p = (await proposeIfShared(deps(), c))!;
    expect(p).toMatchObject({ status: "decided", policyVersion: 1, lender: "mock_re" });
    expect(p.lenderReference).toMatch(/^re_/);
    const [app] = await db.select().from(creditApplications).where(eq(creditApplications.id, c.applicationId));
    expect(app!.status).toBe("submitted");

    const detail = (await getProposalDetail(db, p.id))!;
    expect(detail.proposal.dataGroups).toEqual(MINIMUM_PROPOSAL_PROFILE);
    const payload = detail.proposal.payload;
    expect(payload.professionalFeatures).toBeUndefined();
    expect(payload.fraudFlags).toBeUndefined();
    expect(payload.models?.traditional?.grade).toBeTruthy();
    expect(payload.bankCoverage?.status).toBe("complete");
    expect(JSON.stringify(payload)).not.toMatch(/ira\.|Ira Sen|ABC|98765/);
    expect(detail.decision).toMatchObject({ decisionBasis: "traditional", policyVersion: 1 });

    // Idempotent.
    expect((await proposeIfShared(deps(), c))?.id ?? p.id).toBe(p.id);
    // Not visible to the creator until a CreatorCo reviewer has checked it.
    expect(await getCreatorLenderView(db, c)).toEqual({ stage: "with_lender" });
    const reviewer = await staff("reviewer");
    await reviewDecision(db, {
      staffId: reviewer,
      proposalId: p.id,
      decisionId: await decisionIdOf(p.id),
      action: "confirm",
    });
    const view = await getCreatorLenderView(db, c);
    expect(view).toMatchObject({ stage: "decided", simulated: true, outcome: detail.decision!.outcome });
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

    // What was sent can't be changed.
    await expect(
      db.update(creditProposals).set({ payload: {} }).where(eq(creditProposals.id, p.id)),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/immutable/) }),
    });
    await expect(db.delete(lenderDecisions).where(eq(lenderDecisions.proposalId, p.id))).rejects.toThrow();
  });

  it("holds fraud-review cases until a risk admin releases them with a reason", async () => {
    const pan = uniquePan();
    await confirmedCheck("dup1", { pan, share: false });
    const c = await confirmedCheck("dup2", { pan }); // same PAN on another account → high flag → review
    const p = (await proposeIfShared(deps(), c))!;
    expect(p).toMatchObject({ status: "held", holdReason: "fraud_review" });
    expect(await getCreatorLenderView(db, c)).toEqual({ stage: "preparing" }); // never reveals the review
    const admin = await staff("releaser");
    await expect(releaseHeldProposal(deps(), { staffId: admin, proposalId: p.id, reason: "" })).rejects.toMatchObject({
      code: "invalid",
    });
    const released = await releaseHeldProposal(deps(), {
      staffId: admin,
      proposalId: p.id,
      reason: "Checked: shared family PAN error",
    });
    expect(released.status).toBe("decided");
    expect(released.releasedBy).toBe(admin);
  });

  it("an override needs a reason and sets the final outcome the creator sees", async () => {
    const c = await confirmedCheck("override");
    const p = (await proposeIfShared(deps(), c))!;
    const admin = await staff("overrider");
    await expect(
      reviewDecision(db, {
        staffId: admin,
        proposalId: p.id,
        decisionId: await decisionIdOf(p.id),
        action: "override",
        outcome: "modified",
        exposure: 50_000,
        tenorMonths: 6,
        reason: "short",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await reviewDecision(db, {
      staffId: admin,
      proposalId: p.id,
      decisionId: await decisionIdOf(p.id),
      action: "override",
      outcome: "modified",
      exposure: 50_000,
      tenorMonths: 6,
      reason: "Policy exception agreed with the partner",
    });
    expect(await getCreatorLenderView(db, c)).toMatchObject({
      stage: "decided",
      outcome: "modified",
      amount: 50_000,
      tenorMonths: 6,
    });
  });

  it("an override can't be more favourable than the lender's decision", async () => {
    const c = await confirmedCheck("noupgrade");
    const p = (await proposeIfShared(deps(), c))!;
    const d = (await getProposalDetail(db, p.id))!.decision!;
    const admin = await staff("noupgrader");
    await expect(
      reviewDecision(db, {
        staffId: admin,
        proposalId: p.id,
        decisionId: await decisionIdOf(p.id),
        action: "override",
        outcome: "approved",
        exposure: (d.approvedExposure ?? 0) + 10_000,
        tenorMonths: 12,
        reason: "Trying to raise the amount",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("locks the check while sending: an edit or a consent withdrawal mid-flight can't lose the sent record", async () => {
    const c = await confirmedCheck("inflight");
    const edits: unknown[] = [];
    const meddling = new Proxy(lender, {
      get: (t, prop, r) =>
        prop === "submitProposal"
          ? async (cp: Parameters<LenderProvider["submitProposal"]>[0]) => {
              edits.push(
                await saveApplicationDetails(
                  { db },
                  { ...c, details: { ...details, declaredMonthlyEmi: 1_000 } },
                ).catch((e) => e.code),
              );
              edits.push(
                (
                  await withdrawPurpose(
                    { db },
                    { userId: c.userId, key: CONSENT_KEYS.lenderSharing, source: "settings" },
                  )
                ).effects,
              );
              return t.submitProposal(cp);
            }
          : Reflect.get(t, prop, r),
    });
    const p = (await proposeIfShared(deps({ lender: meddling }), c))!;
    expect(edits).toEqual(["wrong_step", { proposals_cancelled: 0 }]);
    expect(p).toMatchObject({ status: "decided" });
    expect(p.lenderReference).toBe(`re_${p.id}`);
    const [app] = await db.select().from(creditApplications).where(eq(creditApplications.id, c.applicationId));
    expect(app!.status).toBe("submitted"); // the lender has it: retention rules apply
  });

  it("an interrupted send is treated as a failed attempt and the check reopens", async () => {
    const c = await confirmedCheck("interrupted");
    const p = (await proposeIfShared(deps({ lender: failing() }), c))!;
    await db.update(creditProposals).set({ status: "sending" }).where(eq(creditProposals.id, p.id));
    await db.update(creditApplications).set({ status: "submitted" }).where(eq(creditApplications.id, c.applicationId));
    const later = new Date(Date.now() + 10 * 60_000);
    const r = await processLenderProposals(deps({ lender: failing(), now: later }));
    expect(r.interrupted).toBeGreaterThanOrEqual(1);
    const after = (await getProposalDetail(db, p.id))!.proposal;
    expect(after).toMatchObject({ lastError: "interrupted" });
    expect(["queued", "failed"]).toContain(after.status);
    const [app] = await db.select().from(creditApplications).where(eq(creditApplications.id, c.applicationId));
    expect(app!.status).toBe("inputs_ready");
  });

  it("retries sending with backoff, fails after the limit, and staff can retry", async () => {
    const c = await confirmedCheck("retry");
    let p = (await proposeIfShared(deps({ lender: failing() }), c))!;
    expect(p).toMatchObject({ status: "queued", attempts: 1, lastError: "unavailable" });
    for (let i = 0; i < 4; i++) {
      await db.update(creditProposals).set({ nextAttemptAt: null }).where(eq(creditProposals.id, p.id));
      p = await sendProposal(deps({ lender: failing() }), p.id);
    }
    expect(p).toMatchObject({ status: "failed", attempts: 5 });
    expect(
      (await db.select().from(creditApplications).where(eq(creditApplications.id, c.applicationId)))[0]!.status,
    ).toBe("inputs_ready");
    const admin = await staff("retrier");
    expect((await retryProposal(deps(), { staffId: admin, proposalId: p.id })).status).toBe("decided");
  });

  it("an unsent proposal is withdrawn when the creator changes the check", async () => {
    const c = await confirmedCheck("changed");
    const p = (await proposeIfShared(deps({ lender: failing() }), c))!;
    await saveApplicationDetails({ db }, { ...c, details: { ...details, declaredMonthlyEmi: 2_000 } });
    await db.update(creditProposals).set({ nextAttemptAt: null }).where(eq(creditProposals.id, p.id));
    expect(await sendProposal(deps(), p.id)).toMatchObject({ status: "withdrawn", withdrawnReason: "inputs_changed" });
  });

  it("withdrawing the sharing consent cancels unsent proposals; sent ones stay with the lender", async () => {
    const sent = await confirmedCheck("keepsent");
    const sentProposal = (await proposeIfShared(deps(), sent))!;
    const c = await confirmedCheck("cancel");
    const p = (await proposeIfShared(deps({ lender: failing() }), c))!;
    const result = await withdrawPurpose(
      { db },
      { userId: c.userId, key: CONSENT_KEYS.lenderSharing, source: "settings" },
    );
    expect(result.effects).toEqual({ proposals_cancelled: 1 });
    expect((await getProposalDetail(db, p.id))!.proposal).toMatchObject({
      status: "withdrawn",
      withdrawnReason: "consent_withdrawn",
    });
    expect(await getCreatorLenderView(db, c)).toEqual({ stage: "not_shared" });
    await withdrawPurpose({ db }, { userId: sent.userId, key: CONSENT_KEYS.lenderSharing, source: "settings" });
    expect((await getProposalDetail(db, sentProposal.id))!.proposal.status).toBe("decided");
  });

  it("discarding a check erases its unsent proposal", async () => {
    const c = await confirmedCheck("discard");
    const p = (await proposeIfShared(deps({ lender: failing() }), c))!;
    await closeApplication({ db }, c);
    expect(await getProposalDetail(db, p.id)).toBeNull();
  });

  it("the scheduled sweep prepares proposals for checks shared through the consent API", async () => {
    const c = await confirmedCheck("sweep");
    // Shared via grantPurpose (as the consent API does) — no proposal yet.
    expect(
      await db.select().from(creditProposals).where(eq(creditProposals.applicationId, c.applicationId)),
    ).toHaveLength(0);
    const r = await processLenderProposals(deps());
    expect(r.prepared).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(creditProposals).where(eq(creditProposals.applicationId, c.applicationId));
    expect(row!.status).toBe("decided");
  });

  it("never sends more than the creator's consent covers", async () => {
    const c = await confirmedCheck("scope");
    const broad = new MockLenderProvider([...MINIMUM_PROPOSAL_PROFILE, "fraud_flag_details"]);
    expect(await proposeIfShared(deps({ lender: broad }), c)).toBeNull();
    const [blocked] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, c.applicationId), eq(auditEvents.eventType, "lending.proposal_blocked")));
    expect(blocked).toBeTruthy();
  });
});

describe("simulated lender policy (maker-checker)", () => {
  it("a second risk admin approves a new version; later proposals use it", async () => {
    const maker = await staff("maker");
    const checker = await staff("checker");
    const active = await getActivePolicy(db);
    const proposed = await proposePolicy(db, {
      staffId: maker,
      rules: { ...active.rules, decisionBasis: "creator_enhanced", maxExposure: 75_000 },
      note: "Pilot: test creator-enhanced basis",
    });
    expect(proposed.status).toBe("proposed");
    await expect(
      proposePolicy(db, { staffId: maker, rules: { ...active.rules, maxExposure: 1 } }),
    ).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(decidePolicy(db, { staffId: maker, policyId: proposed.id, approve: true })).rejects.toMatchObject({
      code: "self_approval",
    });
    await decidePolicy(db, { staffId: checker, policyId: proposed.id, approve: true });
    const now = await getActivePolicy(db);
    expect(now).toMatchObject({ version: proposed.version, rules: { decisionBasis: "creator_enhanced" } });

    const c = await confirmedCheck("v2policy");
    const p = (await proposeIfShared(deps(), c))!;
    const detail = (await getProposalDetail(db, p.id))!;
    expect(detail.proposal.policyVersion).toBe(proposed.version);
    expect(detail.decision).toMatchObject({ decisionBasis: "creator_enhanced" });
    if (detail.decision!.outcome !== "declined") expect(detail.decision!.approvedExposure).toBeLessThanOrEqual(75_000);

    // Versions are kept and their rules never change.
    await expect(
      db.update(simulatedLenderPolicies).set({ rules: {} }).where(eq(simulatedLenderPolicies.id, proposed.id)),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/immutable/) }) });
    await expect(
      db.delete(simulatedLenderPolicies).where(eq(simulatedLenderPolicies.id, proposed.id)),
    ).rejects.toThrow();

    // Restore the default for other tests.
    const back = await proposePolicy(db, { staffId: checker, rules: active.rules, note: "restore" });
    await decidePolicy(db, { staffId: maker, policyId: back.id, approve: true });
    expect(
      (await db.execute(sql`select count(*)::int as n from ops.simulated_lender_policies where status = 'active'`))[0]!
        .n,
    ).toBe(1);
  });
});
