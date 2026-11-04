import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import {
  brandDirectory,
  brandWorkDocuments,
  brandWorkReasons,
  brandWorkRecords,
  brandWorkReversals,
  brandWorkReviews,
  creatorPointsLedger,
  creatorProfiles,
  users,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { restrictedTextKinds } from "@/lib/restricted-text";
import { recordEvent } from "@/modules/analytics";
import { recordAuditEvent } from "@/modules/audit";
import type { DocumentStorageProvider } from "@/providers/document-storage/types";

import {
  ASSIGNMENT_TIMEOUT_MINUTES,
  REVIEW_SLA_HOURS,
  type ConfirmationMethod,
  type ReviewAction,
  type VerificationStatus,
} from "./domain";
import { BrandWorkError } from "./errors";
import { syncBrandWorkPoints } from "./points";
import { computeFlags } from "./records-service";
import { BRAND_WORK_RULES_VERSION, needsSecondReview, type BrandWorkFlag } from "./rules";

/**
 * Staff verification (Stage 18, `/brand-work`). Reviewers see creator-
 * professional data and documents (short-lived signed URLs, every issue
 * audited) — never `fin` data. Flags route a record to a second reviewer; a
 * reviewer never reviews their own account, second-reviews their own review
 * or approves their own reversal. Points move only through earn rules and
 * approved reversals.
 */

const SIGNED_URL_TTL_SECONDS = 120;

function checkNote(note: string | null | undefined): string | null {
  const n = note?.trim() || null;
  if (n && (n.length > 280 || restrictedTextKinds(n).length))
    throw new BrandWorkError(
      "invalid",
      "Keep the note short and free of identifiers (numbers, e-mail addresses, phone numbers).",
    );
  return n;
}

async function lockRecord(tx: DbExecutor, recordId: string) {
  const [r] = await tx.select().from(brandWorkRecords).where(eq(brandWorkRecords.id, recordId)).for("update");
  if (!r) throw new BrandWorkError("not_found");
  return r;
}

async function revisionOf(tx: DbExecutor, recordId: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(brandWorkReviews)
    .where(eq(brandWorkReviews.recordId, recordId));
  return Number(row?.n ?? 0) + 1;
}

async function logReview(
  tx: DbExecutor,
  input: {
    recordId: string;
    reviewerId: string;
    action: ReviewAction;
    reasonCode?: string | null;
    note?: string | null;
    now: Date;
  },
) {
  await tx.insert(brandWorkReviews).values({
    recordId: input.recordId,
    reviewerId: input.reviewerId,
    action: input.action,
    reasonCode: input.reasonCode ?? null,
    note: input.note ?? null,
    revision: await revisionOf(tx, input.recordId),
    createdAt: input.now,
  });
  await recordAuditEvent(tx, {
    actorType: "user",
    actorId: input.reviewerId,
    eventType: `brand_work.${input.action}`,
    entityType: "brand_work_record",
    entityId: input.recordId,
    metadata: input.reasonCode ? { reason: input.reasonCode } : {},
  });
}

function notOwn(r: { userId: string }, reviewerId: string) {
  if (r.userId === reviewerId) throw new BrandWorkError("own_record", "You can't review your own records.");
}

function lockState(r: { assignedTo: string | null; assignedUntil: Date | null }, viewerId: string, now: Date) {
  const live = Boolean(r.assignedTo && r.assignedUntil && r.assignedUntil.getTime() > now.getTime());
  return { live, byOther: live && r.assignedTo !== viewerId };
}

function holdsLock(r: { assignedTo: string | null; assignedUntil: Date | null }, reviewerId: string, now: Date) {
  if (r.assignedTo && r.assignedTo !== reviewerId && r.assignedUntil && r.assignedUntil.getTime() > now.getTime())
    throw new BrandWorkError("locked", "Another reviewer has this record open.");
}

// ── Queue ───────────────────────────────────────────────────────────────────

export const QUEUE_FILTERS = [
  "to_review",
  "second_review",
  "waiting_scan",
  "needs_info",
  "verified",
  "rejected",
] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export interface QueueRow {
  id: string;
  creatorName: string;
  endBrandName: string;
  status: VerificationStatus;
  flags: BrandWorkFlag[];
  needsSecondReview: boolean;
  awaitingSecond: boolean;
  submittedAt: Date | null;
  ageHours: number | null;
  overSla: boolean;
  assignedToOther: boolean;
  brandResolved: boolean;
}

export async function listQueue(
  db: DbExecutor,
  input: { reviewerId: string; filter: QueueFilter; flaggedOnly?: boolean; now?: Date },
): Promise<QueueRow[]> {
  const now = input.now ?? new Date();
  const status: Record<QueueFilter, VerificationStatus[]> = {
    to_review: ["in_review"],
    second_review: ["in_review"],
    waiting_scan: ["submitted"],
    needs_info: ["needs_info"],
    verified: ["verified"],
    rejected: ["rejected"],
  };
  const rows = await db
    .select({ r: brandWorkRecords, creatorName: creatorProfiles.displayName })
    .from(brandWorkRecords)
    .innerJoin(creatorProfiles, eq(creatorProfiles.id, brandWorkRecords.creatorId))
    .where(
      and(
        inArray(brandWorkRecords.verificationStatus, status[input.filter]),
        input.filter === "second_review" ? sql`${brandWorkRecords.firstReviewerId} is not null` : undefined,
        input.filter === "to_review" ? isNull(brandWorkRecords.firstReviewerId) : undefined,
        input.flaggedOnly ? sql`cardinality(${brandWorkRecords.flags}) > 0` : undefined,
      ),
    )
    .orderBy(
      input.filter === "verified" || input.filter === "rejected"
        ? desc(brandWorkRecords.updatedAt)
        : asc(brandWorkRecords.submittedAt),
    )
    .limit(200);
  return rows.map(({ r, creatorName }) => {
    const age = r.submittedAt ? (now.getTime() - r.submittedAt.getTime()) / 3_600_000 : null;
    return {
      id: r.id,
      creatorName: creatorName ?? "Creator",
      endBrandName: r.endBrandName,
      status: r.verificationStatus,
      flags: r.flags as BrandWorkFlag[],
      needsSecondReview: needsSecondReview(r.flags),
      awaitingSecond: Boolean(r.firstReviewerId) && r.verificationStatus === "in_review",
      submittedAt: r.submittedAt,
      ageHours: age === null ? null : Math.floor(age),
      overSla:
        age !== null &&
        age > REVIEW_SLA_HOURS &&
        (r.verificationStatus === "in_review" || r.verificationStatus === "submitted"),
      assignedToOther:
        Boolean(r.assignedTo) && r.assignedTo !== input.reviewerId && Boolean(r.assignedUntil && r.assignedUntil > now),
      brandResolved: Boolean(r.brandDirectoryId),
    };
  });
}

/** Opens a record for review: locks it to this reviewer for 30 minutes (re-entrant), unless someone else holds it. */
export async function assignRecord(db: Database, input: { reviewerId: string; recordId: string; now?: Date }) {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const r = await lockRecord(tx, input.recordId);
    notOwn(r, input.reviewerId);
    holdsLock(r, input.reviewerId, now);
    if (r.verificationStatus !== "in_review") return;
    await tx
      .update(brandWorkRecords)
      .set({
        assignedTo: input.reviewerId,
        assignedUntil: new Date(now.getTime() + ASSIGNMENT_TIMEOUT_MINUTES * 60_000),
      })
      .where(eq(brandWorkRecords.id, r.id));
    if (r.assignedTo !== input.reviewerId)
      await logReview(tx, { recordId: r.id, reviewerId: input.reviewerId, action: "assign", now });
  });
}

// ── Record detail ───────────────────────────────────────────────────────────

export async function getRecordForReviewer(db: DbExecutor, input: { reviewerId: string; recordId: string }) {
  const [row] = await db
    .select({
      r: brandWorkRecords,
      creatorName: creatorProfiles.displayName,
      handle: creatorProfiles.primaryCreatorHandle,
      brandName: brandDirectory.canonicalName,
      brandIndustry: brandDirectory.industryCode,
    })
    .from(brandWorkRecords)
    .innerJoin(creatorProfiles, eq(creatorProfiles.id, brandWorkRecords.creatorId))
    .leftJoin(brandDirectory, eq(brandDirectory.id, brandWorkRecords.brandDirectoryId))
    .where(eq(brandWorkRecords.id, input.recordId));
  if (!row) return null;
  const [documents, reviews, reversals, points] = await Promise.all([
    db
      .select({
        id: brandWorkDocuments.id,
        kind: brandWorkDocuments.kind,
        mimeType: brandWorkDocuments.mimeType,
        sizeBytes: brandWorkDocuments.sizeBytes,
        scanStatus: brandWorkDocuments.scanStatus,
        uploadedAt: brandWorkDocuments.uploadedAt,
      })
      .from(brandWorkDocuments)
      .where(eq(brandWorkDocuments.recordId, row.r.id))
      .orderBy(asc(brandWorkDocuments.uploadedAt)),
    db
      .select({
        id: brandWorkReviews.id,
        action: brandWorkReviews.action,
        reasonCode: brandWorkReviews.reasonCode,
        note: brandWorkReviews.note,
        revision: brandWorkReviews.revision,
        createdAt: brandWorkReviews.createdAt,
        reviewerEmail: users.email,
        reviewerId: brandWorkReviews.reviewerId,
      })
      .from(brandWorkReviews)
      .leftJoin(users, eq(users.id, brandWorkReviews.reviewerId))
      .where(eq(brandWorkReviews.recordId, row.r.id))
      .orderBy(asc(brandWorkReviews.createdAt)),
    db
      .select()
      .from(brandWorkReversals)
      .where(eq(brandWorkReversals.recordId, row.r.id))
      .orderBy(desc(brandWorkReversals.proposedAt)),
    // Brand-work milestone points for this creator (rule codes and points only).
    db
      .select({
        type: creatorPointsLedger.entryType,
        rule: creatorPointsLedger.rule,
        amount: creatorPointsLedger.amount,
        at: creatorPointsLedger.occurredAt,
      })
      .from(creatorPointsLedger)
      .where(and(eq(creatorPointsLedger.creatorId, row.r.creatorId), sql`${creatorPointsLedger.rule} like 'brand_%'`))
      .orderBy(asc(creatorPointsLedger.occurredAt)),
  ]);
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: input.reviewerId,
    eventType: "brand_work.record_viewed",
    entityType: "brand_work_record",
    entityId: row.r.id,
  });
  return {
    record: row.r,
    creator: { name: row.creatorName ?? "Creator", handle: row.handle },
    brand: row.brandName ? { name: row.brandName, industry: row.brandIndustry } : null,
    documents,
    reviews,
    reversals,
    points,
    isOwn: row.r.userId === input.reviewerId,
    /** Someone holds the record right now (assignment locks last 30 minutes). */
    lock: lockState(row.r, input.reviewerId, new Date()),
  };
}

/** A short-lived link to view one document. Every issue is audited (who viewed which document, when). */
export async function issueDocumentUrl(
  deps: { db: DbExecutor; storage: DocumentStorageProvider },
  input: { reviewerId: string; documentId: string },
) {
  const [doc] = await deps.db
    .select({
      key: brandWorkDocuments.storageKey,
      recordId: brandWorkDocuments.recordId,
      scan: brandWorkDocuments.scanStatus,
      userId: brandWorkRecords.userId,
    })
    .from(brandWorkDocuments)
    .innerJoin(brandWorkRecords, eq(brandWorkRecords.id, brandWorkDocuments.recordId))
    .where(eq(brandWorkDocuments.id, input.documentId));
  if (!doc) throw new BrandWorkError("not_found");
  notOwn(doc, input.reviewerId);
  if (doc.scan !== "clean") throw new BrandWorkError("wrong_state", "This document hasn't passed scanning.");
  const signed = await deps.storage.getSignedReadUrl({
    key: doc.key,
    ttlSeconds: SIGNED_URL_TTL_SECONDS,
    viewerId: input.reviewerId,
  });
  await recordAuditEvent(deps.db, {
    actorType: "user",
    actorId: input.reviewerId,
    eventType: "brand_work.document_url_issued",
    entityType: "brand_work_document",
    entityId: input.documentId,
    metadata: { record: doc.recordId, ttl_seconds: SIGNED_URL_TTL_SECONDS },
  });
  return signed;
}

// ── Decisions ───────────────────────────────────────────────────────────────

/**
 * Verify. Unflagged records are verified by one reviewer. Flagged ones need a
 * second, different reviewer: the first verify records the review, the
 * second completes it. The brand must be resolved and its industry confirmed.
 */
export async function verifyRecord(
  db: Database,
  input: { reviewerId: string; recordId: string; documentCounterparties?: string[]; note?: string | null; now?: Date },
): Promise<{ status: "verified" | "awaiting_second_review" }> {
  const now = input.now ?? new Date();
  const note = checkNote(input.note);
  const outcome = await db.transaction(async (tx) => {
    const r = await lockRecord(tx, input.recordId);
    notOwn(r, input.reviewerId);
    holdsLock(r, input.reviewerId, now);
    if (r.verificationStatus !== "in_review")
      throw new BrandWorkError("wrong_state", "Only records in review can be verified.");
    if (!r.brandDirectoryId || !r.industryConfirmed)
      throw new BrandWorkError("invalid", "Confirm the brand and its industry first.");
    const flags = r.firstReviewerId
      ? (r.flags as BrandWorkFlag[])
      : await computeFlags(tx, r, now, (input.documentCounterparties ?? []).filter(Boolean));
    if (r.firstReviewerId) {
      if (r.firstReviewerId === input.reviewerId)
        throw new BrandWorkError("four_eyes", "A different reviewer has to complete the second review.");
      await tx
        .update(brandWorkRecords)
        .set({
          verificationStatus: "verified",
          secondReviewerId: input.reviewerId,
          verifiedAt: now,
          assignedTo: null,
          assignedUntil: null,
        })
        .where(eq(brandWorkRecords.id, r.id));
      await logReview(tx, { recordId: r.id, reviewerId: input.reviewerId, action: "second_verify", note, now });
    } else if (needsSecondReview(flags)) {
      await tx
        .update(brandWorkRecords)
        .set({
          flags,
          rulesVersion: BRAND_WORK_RULES_VERSION,
          firstReviewerId: input.reviewerId,
          assignedTo: null,
          assignedUntil: null,
        })
        .where(eq(brandWorkRecords.id, r.id));
      await logReview(tx, { recordId: r.id, reviewerId: input.reviewerId, action: "verify", note, now });
      return "awaiting_second_review" as const;
    } else {
      await tx
        .update(brandWorkRecords)
        .set({
          verificationStatus: "verified",
          flags,
          rulesVersion: BRAND_WORK_RULES_VERSION,
          firstReviewerId: input.reviewerId,
          verifiedAt: now,
          assignedTo: null,
          assignedUntil: null,
        })
        .where(eq(brandWorkRecords.id, r.id));
      await logReview(tx, { recordId: r.id, reviewerId: input.reviewerId, action: "verify", note, now });
    }
    await syncBrandWorkPoints(tx, r.creatorId, now);
    await recordEvent(tx, { event: "brand_work_verified", userId: r.userId, now });
    return "verified" as const;
  });
  return { status: outcome };
}

export async function requestInfo(
  db: Database,
  input: { reviewerId: string; recordId: string; reasonCode: string; note?: string | null; now?: Date },
) {
  return decideNegative(db, { ...input, to: "needs_info", action: "request_info" });
}

export async function rejectRecord(
  db: Database,
  input: { reviewerId: string; recordId: string; reasonCode: string; note?: string | null; now?: Date },
) {
  return decideNegative(db, { ...input, to: "rejected", action: "reject" });
}

async function decideNegative(
  db: Database,
  input: {
    reviewerId: string;
    recordId: string;
    reasonCode: string;
    note?: string | null;
    now?: Date;
    to: "needs_info" | "rejected";
    action: "request_info" | "reject";
  },
) {
  const now = input.now ?? new Date();
  const note = checkNote(input.note);
  await db.transaction(async (tx) => {
    const [reason] = await tx
      .select({ code: brandWorkReasons.code })
      .from(brandWorkReasons)
      .where(eq(brandWorkReasons.code, input.reasonCode));
    if (!reason) throw new BrandWorkError("invalid", "Choose a reason.");
    const r = await lockRecord(tx, input.recordId);
    notOwn(r, input.reviewerId);
    holdsLock(r, input.reviewerId, now);
    if (r.verificationStatus !== "in_review")
      throw new BrandWorkError("wrong_state", "Only records in review can be decided.");
    await tx
      .update(brandWorkRecords)
      .set({
        verificationStatus: input.to,
        reasonCode: input.reasonCode,
        firstReviewerId: null,
        assignedTo: null,
        assignedUntil: null,
      })
      .where(eq(brandWorkRecords.id, r.id));
    await logReview(tx, {
      recordId: r.id,
      reviewerId: input.reviewerId,
      action: input.action,
      reasonCode: input.reasonCode,
      note,
      now,
    });
  });
}

/**
 * Payment confirmed by staff: the agency confirmed it (contact noted, checked
 * for identifiers) or a remittance advice on the record was checked. The
 * same points whatever the method.
 */
export async function recordStaffPaymentConfirmation(
  db: Database,
  input: {
    reviewerId: string;
    recordId: string;
    method: Extract<ConfirmationMethod, "agency_confirmation" | "remittance_advice">;
    month: string; // YYYY-MM
    note?: string | null;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const note = checkNote(input.note);
  const thisMonth = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 7); // India time
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month) || input.month > thisMonth)
    throw new BrandWorkError("invalid", "Choose the month the payment arrived.");
  await db.transaction(async (tx) => {
    const r = await lockRecord(tx, input.recordId);
    notOwn(r, input.reviewerId);
    if (r.verificationStatus !== "verified") throw new BrandWorkError("wrong_state", "Verify the record first.");
    if (r.paymentStatus === "confirmed") throw new BrandWorkError("wrong_state", "This payment is already confirmed.");
    if (input.month < r.workDate.slice(0, 7))
      throw new BrandWorkError("invalid", "The payment month can't be before the work.");
    if (input.method === "remittance_advice") {
      const [doc] = await tx
        .select({ id: brandWorkDocuments.id })
        .from(brandWorkDocuments)
        .where(
          and(
            eq(brandWorkDocuments.recordId, r.id),
            eq(brandWorkDocuments.kind, "remittance_advice"),
            eq(brandWorkDocuments.scanStatus, "clean"),
          ),
        )
        .limit(1);
      if (!doc) throw new BrandWorkError("invalid", "There's no scanned remittance advice on this record.");
    }
    await tx
      .update(brandWorkRecords)
      .set({
        paymentStatus: "confirmed",
        paymentConfirmationMethod: input.method,
        paymentConfirmedMonth: `${input.month}-01`,
        paymentConfirmedAt: now,
      })
      .where(eq(brandWorkRecords.id, r.id));
    await logReview(tx, {
      recordId: r.id,
      reviewerId: input.reviewerId,
      action: input.method === "agency_confirmation" ? "record_agency_confirmation" : "record_remittance_advice",
      note,
      now,
    });
    await syncBrandWorkPoints(tx, r.creatorId, now);
    await recordEvent(tx, {
      event: "brand_work_payment_confirmed",
      userId: r.userId,
      now,
    });
  });
}

// ── Reversals (four eyes) ───────────────────────────────────────────────────

export async function proposeReversal(
  db: Database,
  input: { reviewerId: string; recordId: string; reasonCode: string; now?: Date },
) {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const r = await lockRecord(tx, input.recordId);
    notOwn(r, input.reviewerId);
    if (r.verificationStatus !== "verified")
      throw new BrandWorkError("wrong_state", "Only verified records can be reversed.");
    const [reason] = await tx
      .select({ code: brandWorkReasons.code })
      .from(brandWorkReasons)
      .where(eq(brandWorkReasons.code, input.reasonCode));
    if (!reason) throw new BrandWorkError("invalid", "Choose a reason.");
    const [open] = await tx
      .select({ id: brandWorkReversals.id })
      .from(brandWorkReversals)
      .where(and(eq(brandWorkReversals.recordId, r.id), eq(brandWorkReversals.status, "proposed")));
    if (open) throw new BrandWorkError("wrong_state", "A reversal is already waiting for approval.");
    await tx
      .insert(brandWorkReversals)
      .values({ recordId: r.id, reasonCode: input.reasonCode, proposedBy: input.reviewerId, proposedAt: now });
    await logReview(tx, {
      recordId: r.id,
      reviewerId: input.reviewerId,
      action: "propose_reversal",
      reasonCode: input.reasonCode,
      now,
    });
  });
}

/** A different reviewer approves (status and points reversed in one transaction) or declines. */
export async function decideReversal(
  db: Database,
  input: { reviewerId: string; reversalId: string; decision: "approve" | "decline"; now?: Date },
) {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [rev] = await tx
      .select()
      .from(brandWorkReversals)
      .where(eq(brandWorkReversals.id, input.reversalId))
      .for("update");
    if (!rev) throw new BrandWorkError("not_found");
    if (rev.status !== "proposed") throw new BrandWorkError("wrong_state", "This reversal has already been decided.");
    if (rev.proposedBy === input.reviewerId)
      throw new BrandWorkError("four_eyes", "Another reviewer has to approve your reversal.");
    const r = await lockRecord(tx, rev.recordId);
    notOwn(r, input.reviewerId);
    await tx
      .update(brandWorkReversals)
      .set({
        status: input.decision === "approve" ? "approved" : "declined",
        decidedBy: input.reviewerId,
        decidedAt: now,
      })
      .where(eq(brandWorkReversals.id, rev.id));
    if (input.decision === "approve") {
      await tx
        .update(brandWorkRecords)
        .set({
          verificationStatus: "rejected",
          reasonCode: rev.reasonCode,
          reversedAt: now,
          paymentStatus: "unconfirmed",
          paymentConfirmationMethod: null,
          paymentConfirmedMonth: null,
          paymentConfirmedAt: null,
        })
        .where(eq(brandWorkRecords.id, r.id));
      await syncBrandWorkPoints(tx, r.creatorId, now, {
        reason: "brand_work_reversal",
        wasPaymentConfirmed: r.paymentStatus === "confirmed",
      });
    }
    await logReview(tx, {
      recordId: r.id,
      reviewerId: input.reviewerId,
      action: input.decision === "approve" ? "approve_reversal" : "decline_reversal",
      reasonCode: rev.reasonCode,
      now,
    });
  });
}

export async function listOpenReversals(db: DbExecutor) {
  return db
    .select({
      id: brandWorkReversals.id,
      recordId: brandWorkReversals.recordId,
      reasonCode: brandWorkReversals.reasonCode,
      proposedBy: brandWorkReversals.proposedBy,
      proposedAt: brandWorkReversals.proposedAt,
      endBrandName: brandWorkRecords.endBrandName,
      creatorName: creatorProfiles.displayName,
    })
    .from(brandWorkReversals)
    .innerJoin(brandWorkRecords, eq(brandWorkRecords.id, brandWorkReversals.recordId))
    .innerJoin(creatorProfiles, eq(creatorProfiles.id, brandWorkRecords.creatorId))
    .where(eq(brandWorkReversals.status, "proposed"))
    .orderBy(asc(brandWorkReversals.proposedAt));
}

export async function listReasons(db: DbExecutor) {
  return db.select().from(brandWorkReasons).orderBy(asc(brandWorkReasons.sortOrder));
}

/** Expired assignment locks are simply ignored (holdsLock checks the time); this clears them for tidiness. */
export async function clearExpiredLocks(db: DbExecutor, now = new Date()) {
  await db
    .update(brandWorkRecords)
    .set({ assignedTo: null, assignedUntil: null })
    .where(
      and(
        sql`${brandWorkRecords.assignedTo} is not null`,
        or(lt(brandWorkRecords.assignedUntil, now), isNull(brandWorkRecords.assignedUntil)),
      ),
    );
}
