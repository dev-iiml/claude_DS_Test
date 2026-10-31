import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  auditEvents,
  brandWorkDocuments,
  brandWorkRecords,
  brandWorkReversals,
  brandWorkReviews,
  creatorPointsLedger,
  creatorProfessionalFeatures,
  featureSwitches,
  fiTransactions,
  jobs,
  professionalGraphRuns,
} from "@/db/schema";
import {
  assignRecord,
  chooseConfirmation,
  createRecord,
  decideReversal,
  issueDocumentUrl,
  proposeReversal,
  refreshGraphForRecord,
  recordStaffPaymentConfirmation,
  rejectRecord,
  resolveRecordBrand,
  scanDocument,
  submitRecord,
  uploadDocument,
  verifyRecord,
} from "@/modules/brand-work";
import { brandWorkInsights } from "@/modules/brand-work/insights";
import { recordInputSchema } from "@/modules/brand-work/schemas";
import { CONSENT_KEYS, grantConsent, hasValidConsent } from "@/modules/consent";
import { currentDefinitionSeed } from "@/modules/consent/definitions";
import { openFiText } from "@/modules/financial-eligibility/fi-data-protection";
import {
  runBureauCheck,
  saveApplicationDetails,
  startApplication,
} from "@/modules/financial-eligibility/application-service";
import { applicationDetailsSchema } from "@/modules/financial-eligibility/schemas";
import { withdrawPurpose } from "@/modules/privacy";
import { BRAND_FEATURE_KEYS } from "@/modules/professional-graph/engine";
import { pointsBalance } from "@/modules/rewards/ledger-service";
import { MockCreditBureauProvider } from "@/providers/bureau/mock-credit-bureau-provider";
import { MockDocumentStorageProvider } from "@/providers/document-storage/mock-document-storage-provider";
import { MockFileScanProvider } from "@/providers/file-scan/mock-file-scan-provider";

import { connectTestDb } from "../support/db";
import { shareAndConfirm } from "../support/eligibility";
import { completedMember, consentDef, staffUser } from "../support/members";

const { db } = connectTestDb();
const storage = new MockDocumentStorageProvider();
const scanner = new MockFileScanProvider();
const deps = { db, storage, storageKey: "mock" };
const BW_CONSENT = consentDef(CONSENT_KEYS.brandWorkRecords);
const PM_CONSENT = consentDef(CONSENT_KEYS.brandPaymentMatch);

let seq = 0;
/** A small but valid PDF, unique per call so hashes don't collide across tests. */
const pdf = (tag = `${Date.now()}-${++seq}-${Math.random()}`) =>
  new TextEncoder().encode(`%PDF-1.4\n% ${tag}\n%%EOF\n`);

const values = (over: Record<string, unknown> = {}) =>
  recordInputSchema.parse({
    endBrandName: `Lumen Test ${++seq}`,
    billedPartyType: "brand",
    platforms: ["instagram"],
    deliverables: ["reel"],
    description: "Two reels for a skincare launch",
    workDate: "2026-06-01",
    invoiceDate: "2026-06-05",
    invoiceAmountRupees: 40000,
    ...over,
  });

/** A creator record with one clean invoice, submitted, in review. */
async function recordInReview(userId: string, opts: { bytes?: Uint8Array; over?: Record<string, unknown> } = {}) {
  const recordId = await createRecord(db, {
    userId,
    values: values(opts.over),
    consentDefinitionId: BW_CONSENT,
    source: "onboarding",
  });
  const up = await uploadDocument(deps, {
    userId,
    recordId,
    kind: "invoice",
    bytes: opts.bytes ?? pdf(),
    declaredType: "application/pdf",
  });
  await submitRecord(db, { userId, recordId });
  return { recordId, documentId: up.documentId, scanJobId: up.scanJobId };
}

async function scanAndResolve(recordId: string, documentId: string, reviewer: string) {
  await scanDocument({ db, storage, scanner }, documentId);
  await resolveRecordBrand(db, {
    staffId: reviewer,
    recordId,
    newBrandName: `Lumen Brand ${++seq}`,
    industryCode: "beauty_personal_care",
  });
}

const statusOf = async (recordId: string) =>
  (await db.select().from(brandWorkRecords).where(eq(brandWorkRecords.id, recordId)))[0];

describe("Verified brand work (Stage 18)", () => {
  it("create → upload → scan → review → verify, then milestone points once", async () => {
    const m = await completedMember(db);
    const reviewer = await staffUser(db, "brand_work_reviewer");
    const before = await pointsBalance(db, m.creatorId);

    const { recordId, documentId, scanJobId } = await recordInReview(m.userId);
    expect(scanJobId).toBeTruthy();
    expect(await hasValidConsent(db, m.userId, CONSENT_KEYS.brandWorkRecords)).toBe(true);
    // Documents must pass scanning before review starts.
    expect((await statusOf(recordId))!.verificationStatus).toBe("submitted");
    await scanDocument({ db, storage, scanner }, documentId);
    expect((await statusOf(recordId))!.verificationStatus).toBe("in_review");

    // The brand and industry must be confirmed first.
    await expect(verifyRecord(db, { reviewerId: reviewer, recordId })).rejects.toMatchObject({ code: "invalid" });
    await assignRecord(db, { reviewerId: reviewer, recordId });
    await resolveRecordBrand(db, {
      staffId: reviewer,
      recordId,
      newBrandName: `Lumen Brand ${++seq}`,
      industryCode: "beauty_personal_care",
    });
    expect(await verifyRecord(db, { reviewerId: reviewer, recordId })).toEqual({ status: "verified" });

    expect(await pointsBalance(db, m.creatorId)).toBe(before + 250);
    // Re-syncing (e.g. a staff payment confirmation) grants the payment milestone, never the record milestone twice.
    await recordStaffPaymentConfirmation(db, {
      reviewerId: reviewer,
      recordId,
      method: "agency_confirmation",
      month: "2026-07",
      note: "Confirmed by the brand's finance team on a call",
    });
    expect(await pointsBalance(db, m.creatorId)).toBe(before + 250 + 200);
    const rules = (
      await db
        .select({ rule: creatorPointsLedger.rule })
        .from(creatorPointsLedger)
        .where(and(eq(creatorPointsLedger.creatorId, m.creatorId), like(creatorPointsLedger.rule, "brand_%")))
    ).map((r) => r.rule);
    expect(rules.sort()).toEqual(["brand_payment_confirmed_1", "brand_work_verified_1"]);
  });

  it("rejects disguised files, too many documents and uploads without consent", async () => {
    const m = await completedMember(db);
    const recordId = await createRecord(db, {
      userId: m.userId,
      values: values(),
      consentDefinitionId: BW_CONSENT,
      source: "onboarding",
    });
    await expect(
      uploadDocument(deps, {
        userId: m.userId,
        recordId,
        kind: "invoice",
        bytes: new TextEncoder().encode("<html>"),
        declaredType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "file_rejected" });
    await expect(
      uploadDocument(deps, { userId: m.userId, recordId, kind: "invoice", bytes: pdf(), declaredType: "image/png" }),
    ).rejects.toMatchObject({ code: "file_rejected" });
    for (let i = 0; i < 5; i++)
      await uploadDocument(deps, {
        userId: m.userId,
        recordId,
        kind: "invoice",
        bytes: pdf(),
        declaredType: "application/pdf",
      });
    await expect(
      uploadDocument(deps, {
        userId: m.userId,
        recordId,
        kind: "invoice",
        bytes: pdf(),
        declaredType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "too_many_documents" });
    // Another creator can't touch this record.
    const other = await completedMember(db);
    await expect(
      uploadDocument(deps, {
        userId: other.userId,
        recordId,
        kind: "invoice",
        bytes: pdf(),
        declaredType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("an infected file is rejected, queued for deletion and keeps the record out of review", async () => {
    const m = await completedMember(db);
    const eicar = new TextEncoder().encode(
      "%PDF-1.4\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n",
    );
    const { recordId, documentId } = await recordInReview(m.userId, { bytes: eicar });
    const res = await scanDocument({ db, storage, scanner }, documentId);
    expect(res.rejected).toBe(1);
    const [doc] = await db.select().from(brandWorkDocuments).where(eq(brandWorkDocuments.id, documentId));
    expect(doc!.scanStatus).toBe("rejected");
    const queued = await db.select().from(jobs).where(eq(jobs.type, "brand_work_erase_documents"));
    expect(queued.some((j) => (j.payload as { key?: string }).key === doc!.storageKey)).toBe(true);
    expect((await statusOf(recordId))!.verificationStatus).not.toBe("in_review");
  });

  it("the same document on two creators' records flags the second for a four-eyes review", async () => {
    const a = await completedMember(db);
    const b = await completedMember(db);
    const r1 = await staffUser(db, "brand_work_reviewer");
    const r2 = await staffUser(db, "brand_work_reviewer");
    const shared = pdf("shared-invoice");
    await recordInReview(a.userId, { bytes: shared });
    const second = await recordInReview(b.userId, { bytes: shared });
    expect((await statusOf(second.recordId))!.flags).toContain("duplicate_document");

    await scanAndResolve(second.recordId, second.documentId, r1);
    expect(await verifyRecord(db, { reviewerId: r1, recordId: second.recordId })).toEqual({
      status: "awaiting_second_review",
    });
    await expect(verifyRecord(db, { reviewerId: r1, recordId: second.recordId })).rejects.toMatchObject({
      code: "four_eyes",
    });
    expect(await verifyRecord(db, { reviewerId: r2, recordId: second.recordId })).toEqual({ status: "verified" });
    const rec = (await statusOf(second.recordId))!;
    expect([rec.firstReviewerId, rec.secondReviewerId]).toEqual([r1, r2]);
  });

  it("reviewers can't act on their own records, and another reviewer's lock is respected", async () => {
    const reviewer = await staffUser(db, "brand_work_reviewer");
    // A staff account that also has creator data (contrived) must not review itself.
    const m = await completedMember(db);
    const { recordId, documentId } = await recordInReview(m.userId);
    await scanDocument({ db, storage, scanner }, documentId);
    await expect(assignRecord(db, { reviewerId: m.userId, recordId })).rejects.toMatchObject({ code: "own_record" });
    await expect(issueDocumentUrl({ db, storage }, { reviewerId: m.userId, documentId })).rejects.toMatchObject({
      code: "own_record",
    });
    const other = await staffUser(db, "brand_work_reviewer");
    await assignRecord(db, { reviewerId: other, recordId });
    await expect(
      rejectRecord(db, { reviewerId: reviewer, recordId, reasonCode: "documents_unreadable" }),
    ).rejects.toMatchObject({ code: "locked" });
  });

  it("every signed document link is audited, with ids only", async () => {
    const m = await completedMember(db);
    const reviewer = await staffUser(db, "brand_work_reviewer");
    const { documentId } = await recordInReview(m.userId);
    await expect(issueDocumentUrl({ db, storage }, { reviewerId: reviewer, documentId })).rejects.toMatchObject({
      code: "wrong_state",
    }); // not scanned yet
    await scanDocument({ db, storage, scanner }, documentId);
    const signed = await issueDocumentUrl({ db, storage }, { reviewerId: reviewer, documentId });
    expect(signed.url).toMatch(/^\/brand-work\/documents\/view\?key=bw%2F[0-9a-f]{32}/);
    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.eventType, "brand_work.document_url_issued"), eq(auditEvents.entityId, documentId)));
    expect(audit!.actorId).toBe(reviewer);
    expect(JSON.stringify(audit!.metadata)).not.toMatch(/bw\//);
  });

  it("a reversal needs a second reviewer and takes back only the milestone that record reached", async () => {
    const m = await completedMember(db);
    const r1 = await staffUser(db, "brand_work_reviewer");
    const r2 = await staffUser(db, "brand_work_reviewer");
    const before = await pointsBalance(db, m.creatorId);
    const { recordId, documentId } = await recordInReview(m.userId);
    await scanAndResolve(recordId, documentId, r1);
    await verifyRecord(db, { reviewerId: r1, recordId });
    expect(await pointsBalance(db, m.creatorId)).toBe(before + 250);

    await proposeReversal(db, { reviewerId: r1, recordId, reasonCode: "suspected_fraud" });
    const [rev] = await db.select().from(brandWorkReversals).where(eq(brandWorkReversals.recordId, recordId));
    await expect(
      decideReversal(db, { reviewerId: r1, reversalId: rev!.id, decision: "approve" }),
    ).rejects.toMatchObject({
      code: "four_eyes",
    });
    await decideReversal(db, { reviewerId: r2, reversalId: rev!.id, decision: "approve" });
    expect((await statusOf(recordId))!.verificationStatus).toBe("rejected");
    expect(await pointsBalance(db, m.creatorId)).toBe(before);
    // Idempotent: reconciling again changes nothing.
    await decideReversal(db, { reviewerId: r2, reversalId: rev!.id, decision: "approve" }).catch(() => undefined);
    expect(await pointsBalance(db, m.creatorId)).toBe(before);
  });

  it("withdrawing brand_work_records erases records, documents and reviews; points stay", async () => {
    const m = await completedMember(db);
    const reviewer = await staffUser(db, "brand_work_reviewer");
    const { recordId, documentId } = await recordInReview(m.userId);
    await scanAndResolve(recordId, documentId, reviewer);
    await verifyRecord(db, { reviewerId: reviewer, recordId });
    const balance = await pointsBalance(db, m.creatorId);
    const [doc] = await db.select().from(brandWorkDocuments).where(eq(brandWorkDocuments.id, documentId));

    const result = await withdrawPurpose(
      { db },
      { userId: m.userId, key: CONSENT_KEYS.brandWorkRecords, source: "settings" },
    );
    expect(result.erasures).toEqual([expect.objectContaining({ scope: "brand_work_records", status: "completed" })]);
    expect(await db.select().from(brandWorkRecords).where(eq(brandWorkRecords.userId, m.userId))).toEqual([]);
    expect(await db.select().from(brandWorkDocuments).where(eq(brandWorkDocuments.recordId, recordId))).toEqual([]);
    expect(await db.select().from(brandWorkReviews).where(eq(brandWorkReviews.recordId, recordId))).toEqual([]);
    expect(await pointsBalance(db, m.creatorId)).toBe(balance);
    // The stored object is removed by a queued job (payload: the opaque key only).
    const queued = await db.select().from(jobs).where(eq(jobs.type, "brand_work_erase_documents"));
    expect(queued.some((j) => (j.payload as { key?: string }).key === doc!.storageKey)).toBe(true);
  });

  it("the bank-data check is off by default, returns only an enum and a month, and resets on withdrawal", async () => {
    const m = await completedMember(db);
    const reviewer = await staffUser(db, "brand_work_reviewer");

    // A financial check with shared (mock) AA data.
    const app = await startApplication(
      { db },
      {
        userId: m.userId,
        consentDefinitionId: currentDefinitionSeed(CONSENT_KEYS.financialEligibility)!.id,
        source: "settings",
      },
    );
    await saveApplicationDetails(
      { db },
      {
        userId: m.userId,
        applicationId: app.id,
        details: applicationDetailsSchema.parse({
          purposes: ["equipment"],
          requestedAmount: "1,00,000",
          declaredMonthlyIncome: "90,000",
          declaredMonthlyEmi: "0",
          incomeSources: ["brand_deals"],
        }),
      },
    );
    await runBureauCheck(
      { db, bureau: new MockCreditBureauProvider() },
      { userId: m.userId, applicationId: app.id, pan: "ABCPE1238F" },
    );
    // Shared and confirmed on Review: a draft check's data is never used.
    await shareAndConfirm(db, { userId: m.userId, applicationId: app.id, mobile: "9876543219" });

    // A real brand credit from the mock feed, to build a matching record around.
    const credits = await db
      .select()
      .from(fiTransactions)
      .where(and(eq(fiTransactions.applicationId, app.id), eq(fiTransactions.direction, "credit")));
    const brand = credits.find(
      (c) => c.counterpartySealed && /Northlight|Tidal|Kite/.test(openFiText(c.counterpartySealed, app.id)),
    )!;
    const payer = openFiText(brand.counterpartySealed!, app.id);
    const credited = Number(brand.amount);
    const invoiceDate = new Date(Date.parse(`${brand.bookedOn}T00:00:00Z`) - 10 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const { recordId, documentId } = await recordInReview(m.userId, {
      over: {
        endBrandName: `Glow Test ${++seq}`,
        billedPartyType: "agency",
        billedPartyName: payer,
        workDate: invoiceDate,
        invoiceDate,
        invoiceAmountRupees: Math.round(credited / 0.9),
      },
    });
    await scanAndResolve(recordId, documentId, reviewer);
    await verifyRecord(db, { reviewerId: reviewer, recordId });

    // Off by default: the option isn't available.
    await db.delete(featureSwitches).where(eq(featureSwitches.key, "brand_payment_match"));
    await expect(
      chooseConfirmation(db, {
        userId: m.userId,
        recordId,
        method: "aa_match",
        consentDefinitionId: PM_CONSENT,
        source: "settings",
      }),
    ).rejects.toMatchObject({ code: "feature_off" });

    await db.insert(featureSwitches).values({ key: "brand_payment_match", enabled: true });
    try {
      await expect(
        chooseConfirmation(db, { userId: m.userId, recordId, method: "aa_match", source: "settings" }),
      ).rejects.toMatchObject({ code: "consent_required" });
      const out = await chooseConfirmation(db, {
        userId: m.userId,
        recordId,
        method: "aa_match",
        consentDefinitionId: PM_CONSENT,
        source: "settings",
      });
      expect(out).toEqual({ method: "aa_match", match: "seen" });
      const rec = (await statusOf(recordId))!;
      expect(rec.paymentStatus).toBe("confirmed");
      expect(rec.paymentConfirmedMonth).toBe(`${brand.bookedOn.slice(0, 7)}-01`);
      // Nothing about the bank line leaves fin: not the amount, the payer or the date.
      const audits = JSON.stringify(await db.select().from(auditEvents).where(eq(auditEvents.entityId, recordId)));
      expect(audits).not.toContain(payer);
      expect(audits).not.toContain(brand.bookedOn);
      expect(audits).not.toContain(String(credited));
      const balance = await pointsBalance(db, m.creatorId);

      // Withdrawing the bank-data consent un-confirms that payment; points stay.
      await withdrawPurpose({ db }, { userId: m.userId, key: CONSENT_KEYS.brandPaymentMatch, source: "settings" });
      const after = (await statusOf(recordId))!;
      expect(after.paymentStatus).toBe("unconfirmed");
      expect(after.paymentConfirmationMethod).toBeNull();
      expect(await pointsBalance(db, m.creatorId)).toBe(balance);
    } finally {
      await db.delete(featureSwitches).where(eq(featureSwitches.key, "brand_payment_match"));
    }
  });

  it("a file already on another record is reused only once it scanned clean", async () => {
    const m = await completedMember(db);
    const bytes = pdf();
    const first = await recordInReview(m.userId, { bytes });
    // Still pending on the first record: the second gets its own object and scan job.
    const second = await recordInReview(m.userId, { bytes });
    expect(second.scanJobId).toBeTruthy();
    await scanDocument({ db, storage, scanner }, second.documentId);
    expect((await statusOf(second.recordId))!.verificationStatus).toBe("in_review");
    await scanDocument({ db, storage, scanner }, first.documentId);
    // Clean now: a third copy reuses the object and starts clean.
    const third = await recordInReview(m.userId, { bytes });
    expect(third.scanJobId).toBeNull();
    expect((await statusOf(third.recordId))!.verificationStatus).toBe("in_review");
  });

  it("free text the creator types can't carry tax IDs, bank or contact details", () => {
    for (const description of ["Invoice for GSTIN 27ABCDE1234F1Z5", "Paid to account 123456789012", "Call 9876543210"])
      expect(recordInputSchema.safeParse({ ...values(), description }).success, description).toBe(false);
    expect(
      recordInputSchema.safeParse({
        endBrandName: "ABCDE1234F",
        billedPartyType: "brand",
        platforms: ["instagram"],
        deliverables: ["reel"],
        description: "Two reels",
        workDate: "2026-06-01",
      }).success,
    ).toBe(false);
    expect(recordInputSchema.safeParse({ ...values(), workDate: "2026-02-31" }).success).toBe(false);
  });

  it("withdrawal also erases brand features from earlier Professional Graph runs", async () => {
    const m = await completedMember(db);
    const reviewer = await staffUser(db, "brand_work_reviewer");
    const { recordId, documentId } = await recordInReview(m.userId);
    await scanAndResolve(recordId, documentId, reviewer);
    await verifyRecord(db, { reviewerId: reviewer, recordId });
    await grantConsent(db, {
      userId: m.userId,
      key: CONSENT_KEYS.professionalAnalytics,
      consentDefinitionId: currentDefinitionSeed(CONSENT_KEYS.professionalAnalytics)!.id,
      source: "settings",
    });
    await refreshGraphForRecord(db, recordId);
    const brandRows = () =>
      db
        .select({ key: creatorProfessionalFeatures.featureKey })
        .from(creatorProfessionalFeatures)
        .innerJoin(professionalGraphRuns, eq(professionalGraphRuns.id, creatorProfessionalFeatures.runId))
        .where(
          and(
            eq(professionalGraphRuns.creatorId, m.creatorId),
            inArray(creatorProfessionalFeatures.featureKey, [...BRAND_FEATURE_KEYS]),
          ),
        );
    expect((await brandRows()).length).toBeGreaterThan(0);
    await withdrawPurpose({ db }, { userId: m.userId, key: CONSENT_KEYS.brandWorkRecords, source: "settings" });
    // Only the fresh run's (empty-evidence) brand features remain — none carry an amount.
    const left = await db
      .select({ value: creatorProfessionalFeatures.valueNumeric })
      .from(creatorProfessionalFeatures)
      .innerJoin(professionalGraphRuns, eq(professionalGraphRuns.id, creatorProfessionalFeatures.runId))
      .where(
        and(
          eq(professionalGraphRuns.creatorId, m.creatorId),
          inArray(creatorProfessionalFeatures.featureKey, ["highest_verified_deal", "verified_brand_billings_12m"]),
        ),
      );
    expect(left.every((f) => f.value === null)).toBe(true);
  });

  it("insights are cross-creator aggregates with small cells suppressed", async () => {
    const out = await brandWorkInsights(db);
    const cells = [
      ...out.funnel.map((f) => f.creators),
      ...out.methods.map((f) => f.creators),
      ...out.reasons.map((f) => f.creators),
      ...out.flags.map((f) => f.creators),
      ...out.pointsByMilestone.map((f) => f.creators),
      ...out.industries.map((f) => f.creators),
      ...out.verifiedBrandCount.map((f) => f.creators),
    ];
    for (const c of cells) if (!c.suppressed && c.value) expect(c.value).toBeGreaterThanOrEqual(5);
    for (const c of cells) if (c.suppressed) expect(c.value).toBeNull();
    for (const i of out.industries) if (i.creators.suppressed) expect(i.medianDealBand).toBeNull();
    expect(JSON.stringify(out)).not.toMatch(/"(userId|creatorId|recordId|amountPaise)"/);
  });
});

afterAll(async () => {
  await db.delete(featureSwitches).where(eq(featureSwitches.key, "brand_payment_match"));
});
