import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import {
  brandAliases,
  brandDirectory,
  brandWorkDocuments,
  brandWorkReasons,
  brandWorkRecords,
  consentReceipts,
  creatorProfiles,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordEvent } from "@/modules/analytics";
import { recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, findValidReceipt, grantConsent, hasValidConsent } from "@/modules/consent";
import type { ConsentSource } from "@/modules/consent/domain";

import type {
  BilledPartyType,
  ConfirmationMethod,
  DeliverableType,
  DocumentKind,
  PaymentStatus,
  ScanStatus,
  VerificationStatus,
  Visibility,
} from "./domain";
import { BrandWorkError } from "./errors";
import { BRAND_WORK_RULES_VERSION, normaliseBrandName, recordFlags, type BrandWorkFlag } from "./rules";
import type { RecordInput } from "./schemas";

/**
 * Verified brand work — the creator's side (Stage 18). Creators see their own
 * records only, with neutral wording: never review notes, flag names or fraud
 * language. Nothing here is a credit product.
 */

const istToday = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

async function activeProfile(db: DbExecutor, userId: string) {
  const [p] = await db
    .select({ id: creatorProfiles.id, status: creatorProfiles.profileStatus })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId))
    .limit(1);
  if (!p || p.status !== "completed") throw new BrandWorkError("profile_inactive", "Your membership isn't active.");
  return p;
}

/** The creator's `brand_work_records` receipt, granting it from the text they agreed to on this screen if needed. */
async function ensureConsent(
  tx: DbExecutor,
  input: { userId: string; consentDefinitionId?: string | null; source: ConsentSource; now: Date },
) {
  if (!(await hasValidConsent(tx, input.userId, CONSENT_KEYS.brandWorkRecords, input.now))) {
    if (!input.consentDefinitionId)
      throw new BrandWorkError("consent_required", "Agree to the verified brand work consent to add a record.");
    try {
      await grantConsent(tx, {
        userId: input.userId,
        key: CONSENT_KEYS.brandWorkRecords,
        consentDefinitionId: input.consentDefinitionId,
        source: input.source,
        metadata: { surface: "brand_work" },
        now: input.now,
      });
    } catch {
      throw new BrandWorkError("consent_required", "The consent text has been updated. Reload and review it.");
    }
  }
  const receipt = await findValidReceipt(tx, input.userId, CONSENT_KEYS.brandWorkRecords, input.now);
  if (!receipt) throw new BrandWorkError("consent_required");
  // Hold the receipt (still granted) so a concurrent withdrawal either commits first or waits for us.
  const [held] = await tx
    .select({ id: consentReceipts.id })
    .from(consentReceipts)
    .where(and(eq(consentReceipts.id, receipt.id), eq(consentReceipts.status, "granted")))
    .for("share");
  if (!held) throw new BrandWorkError("consent_required", "Your verified brand work consent was withdrawn.");
  return receipt;
}

/** Alias lookup for the brand name the creator typed (an exact normalised match only). */
async function resolveAlias(tx: DbExecutor, name: string) {
  const alias = normaliseBrandName(name);
  if (!alias) return null;
  const [row] = await tx
    .select({
      id: brandDirectory.id,
      industry: brandDirectory.industryCode,
      status: brandDirectory.status,
      mergedInto: brandDirectory.mergedInto,
    })
    .from(brandAliases)
    .innerJoin(brandDirectory, eq(brandDirectory.id, brandAliases.directoryId))
    .where(eq(brandAliases.alias, alias))
    .limit(1);
  if (!row) return null;
  return { id: row.status === "merged" && row.mergedInto ? row.mergedInto : row.id, industry: row.industry };
}

function valuesFor(input: RecordInput) {
  return {
    endBrandName: input.endBrandName,
    billedPartyType: input.billedPartyType,
    billedPartyName: input.billedPartyName,
    industryCode: input.industryCode ?? null,
    platforms: input.platforms,
    deliverables: input.deliverables,
    visibility: input.visibility,
    description: input.description,
    deliverablesSummary: input.deliverablesSummary || null,
    workDate: input.workDate,
    invoiceDate: input.invoiceDate ?? null,
    invoiceAmountPaise: input.invoiceAmountRupees !== undefined ? input.invoiceAmountRupees * 100 : null,
  };
}

export async function createRecord(
  db: Database,
  input: {
    userId: string;
    values: RecordInput;
    consentDefinitionId?: string | null;
    source: ConsentSource;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  if (input.values.workDate > istToday(now))
    throw new BrandWorkError("invalid", "The work date can't be in the future.");
  return db.transaction(async (tx) => {
    const profile = await activeProfile(tx, input.userId);
    const receipt = await ensureConsent(tx, {
      userId: input.userId,
      consentDefinitionId: input.consentDefinitionId,
      source: input.source,
      now,
    });
    const alias = await resolveAlias(tx, input.values.endBrandName);
    const [row] = await tx
      .insert(brandWorkRecords)
      .values({
        ...valuesFor(input.values),
        creatorId: profile.id,
        userId: input.userId,
        brandDirectoryId: alias?.id ?? null,
        consentReceiptId: receipt.id,
      })
      .returning({ id: brandWorkRecords.id });
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "brand_work.record_created",
      entityType: "brand_work_record",
      entityId: row!.id,
    });
    await recordEvent(tx, { event: "brand_work_record_created", userId: input.userId, now });
    return row!.id;
  });
}

async function ownRecord(tx: DbExecutor, userId: string, recordId: string, lock = false) {
  const q = tx
    .select()
    .from(brandWorkRecords)
    .where(and(eq(brandWorkRecords.id, recordId), eq(brandWorkRecords.userId, userId)));
  const [r] = lock ? await q.for("update") : await q;
  if (!r) throw new BrandWorkError("not_found");
  return r;
}

const EDITABLE: VerificationStatus[] = ["draft", "needs_info"];

export async function updateRecord(
  db: Database,
  input: { userId: string; recordId: string; values: RecordInput; now?: Date },
) {
  const now = input.now ?? new Date();
  if (input.values.workDate > istToday(now))
    throw new BrandWorkError("invalid", "The work date can't be in the future.");
  await db.transaction(async (tx) => {
    const r = await ownRecord(tx, input.userId, input.recordId, true);
    if (!EDITABLE.includes(r.verificationStatus))
      throw new BrandWorkError("wrong_state", "This record is being reviewed or is already decided.");
    if (!(await hasValidConsent(tx, input.userId, CONSENT_KEYS.brandWorkRecords, now)))
      throw new BrandWorkError("consent_required");
    const alias = r.brandDirectoryId ? null : await resolveAlias(tx, input.values.endBrandName);
    await tx
      .update(brandWorkRecords)
      .set({ ...valuesFor(input.values), brandDirectoryId: r.brandDirectoryId ?? alias?.id ?? null })
      .where(eq(brandWorkRecords.id, r.id));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "brand_work.record_updated",
      entityType: "brand_work_record",
      entityId: r.id,
    });
  });
}

/** Only drafts can be deleted by the creator (anything submitted goes with a consent withdrawal). Returns storage keys to erase. */
export async function deleteDraft(db: Database, input: { userId: string; recordId: string }) {
  return db.transaction(async (tx) => {
    const r = await ownRecord(tx, input.userId, input.recordId, true);
    if (r.verificationStatus !== "draft") throw new BrandWorkError("wrong_state", "Only drafts can be deleted.");
    const docs = await tx
      .select({ key: brandWorkDocuments.storageKey, provider: brandWorkDocuments.storageProvider })
      .from(brandWorkDocuments)
      .where(eq(brandWorkDocuments.recordId, r.id));
    await tx.execute(sql`set local creatorco.erasure = 'on'`);
    await tx.delete(brandWorkRecords).where(eq(brandWorkRecords.id, r.id));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "brand_work.draft_deleted",
      entityType: "brand_work_record",
      entityId: r.id,
      metadata: { documents: docs.length },
    });
    return docs;
  });
}

/** Flags from the pure rules, with the cross-creator and history facts looked up here. */
export async function computeFlags(
  tx: DbExecutor,
  r: typeof brandWorkRecords.$inferSelect,
  now: Date,
  documentCounterparties: string[] = [],
): Promise<BrandWorkFlag[]> {
  const docs = await tx
    .select({ sha: brandWorkDocuments.sha256 })
    .from(brandWorkDocuments)
    .where(eq(brandWorkDocuments.recordId, r.id));
  const shas = docs.map((d) => d.sha);
  const [dup] = shas.length
    ? await tx
        .select({ n: count() })
        .from(brandWorkDocuments)
        .where(and(inArray(brandWorkDocuments.sha256, shas), ne(brandWorkDocuments.creatorId, r.creatorId)))
    : [{ n: 0 }];
  const verified = await tx
    .select({
      amount: brandWorkRecords.invoiceAmountPaise,
      brand: brandWorkRecords.brandDirectoryId,
      verifiedAt: brandWorkRecords.verifiedAt,
    })
    .from(brandWorkRecords)
    .where(
      and(
        eq(brandWorkRecords.creatorId, r.creatorId),
        eq(brandWorkRecords.verificationStatus, "verified"),
        ne(brandWorkRecords.id, r.id),
      ),
    )
    .orderBy(asc(brandWorkRecords.verifiedAt));
  // First-time brands verified in the window: brands whose first verified record falls inside it.
  const windowStart = now.getTime() - 30 * 86_400_000;
  const firstSeen = new Map<string, number>();
  for (const v of verified) {
    if (v.brand && v.verifiedAt && !firstSeen.has(v.brand)) firstSeen.set(v.brand, v.verifiedAt.getTime());
  }
  const recentNewBrandCount = [...firstSeen.values()].filter((t) => t >= windowStart).length;
  let sameElsewhere = false;
  if (r.brandDirectoryId && r.invoiceAmountPaise !== null) {
    const [hit] = await tx
      .select({ n: count() })
      .from(brandWorkRecords)
      .where(
        and(
          eq(brandWorkRecords.brandDirectoryId, r.brandDirectoryId),
          eq(brandWorkRecords.invoiceAmountPaise, r.invoiceAmountPaise),
          sql`date_trunc('month', ${brandWorkRecords.workDate}) = date_trunc('month', ${r.workDate}::date)`,
          ne(brandWorkRecords.creatorId, r.creatorId),
        ),
      );
    sameElsewhere = Number(hit?.n ?? 0) > 0;
  }
  return recordFlags({
    today: istToday(now),
    workDate: r.workDate,
    invoiceDate: r.invoiceDate,
    amountPaise: r.invoiceAmountPaise,
    documentCounterparties,
    duplicateAcrossCreators: Number(dup?.n ?? 0) > 0,
    creatorVerifiedAmounts: verified.map((v) => v.amount).filter((a): a is number => a !== null),
    recentNewBrandCount,
    sameBrandAmountMonthElsewhere: sameElsewhere,
  });
}

/**
 * Sends a draft (or a record that needed more information) for verification.
 * It waits in `submitted` until every document has passed scanning, then
 * moves to `in_review`.
 */
export async function submitRecord(db: Database, input: { userId: string; recordId: string; now?: Date }) {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const r = await ownRecord(tx, input.userId, input.recordId, true);
    if (!EDITABLE.includes(r.verificationStatus))
      throw new BrandWorkError("wrong_state", "This record has already been sent.");
    if (!(await hasValidConsent(tx, input.userId, CONSENT_KEYS.brandWorkRecords, now)))
      throw new BrandWorkError("consent_required");
    const docs = await tx
      .select({ kind: brandWorkDocuments.kind, scan: brandWorkDocuments.scanStatus })
      .from(brandWorkDocuments)
      .where(eq(brandWorkDocuments.recordId, r.id));
    const evidence = docs.filter((d) => d.kind !== "remittance_advice" && d.scan !== "rejected");
    if (!evidence.length)
      throw new BrandWorkError("invalid", "Add an invoice, purchase order or agreement before you send this record.");
    const flags = await computeFlags(tx, r, now);
    const allClean = docs.every((d) => d.scan === "clean" || d.scan === "rejected");
    await tx
      .update(brandWorkRecords)
      .set({
        verificationStatus: allClean ? "in_review" : "submitted",
        submittedAt: now,
        flags,
        rulesVersion: BRAND_WORK_RULES_VERSION,
        reasonCode: null,
        firstReviewerId: null,
        secondReviewerId: null,
      })
      .where(eq(brandWorkRecords.id, r.id));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.userId,
      eventType: "brand_work.submitted",
      entityType: "brand_work_record",
      entityId: r.id,
      metadata: { flags: flags.length, resubmission: r.verificationStatus === "needs_info" },
    });
    await recordEvent(tx, { event: "brand_work_submitted", userId: input.userId, now });
  });
}

// ── Creator views ───────────────────────────────────────────────────────────

export interface CreatorRecordView {
  id: string;
  endBrandName: string;
  brandName: string | null;
  billedPartyType: BilledPartyType;
  billedPartyName: string;
  industryCode: string | null;
  platforms: string[];
  deliverables: DeliverableType[];
  visibility: Visibility;
  description: string;
  deliverablesSummary: string | null;
  workDate: string;
  invoiceDate: string | null;
  invoiceAmountPaise: number | null;
  verificationStatus: VerificationStatus;
  paymentStatus: PaymentStatus;
  paymentConfirmationMethod: ConfirmationMethod | null;
  paymentConfirmedMonth: string | null;
  requestedConfirmation: ConfirmationMethod | null;
  /** Neutral message when more information is needed or the record wasn't verified. */
  message: string | null;
  submittedAt: Date | null;
  verifiedAt: Date | null;
  createdAt: Date;
  documents: { id: string; kind: DocumentKind; scanStatus: ScanStatus; sizeBytes: number; uploadedAt: Date }[];
}

export async function listRecordsForCreator(db: DbExecutor, userId: string): Promise<CreatorRecordView[]> {
  const rows = await db
    .select({ r: brandWorkRecords, brandName: brandDirectory.canonicalName, message: brandWorkReasons.creatorMessage })
    .from(brandWorkRecords)
    .leftJoin(brandDirectory, eq(brandDirectory.id, brandWorkRecords.brandDirectoryId))
    .leftJoin(brandWorkReasons, eq(brandWorkReasons.code, brandWorkRecords.reasonCode))
    .where(eq(brandWorkRecords.userId, userId))
    .orderBy(desc(brandWorkRecords.workDate), desc(brandWorkRecords.createdAt));
  const ids = rows.map((r) => r.r.id);
  const docs = ids.length
    ? await db
        .select({
          id: brandWorkDocuments.id,
          recordId: brandWorkDocuments.recordId,
          kind: brandWorkDocuments.kind,
          scanStatus: brandWorkDocuments.scanStatus,
          sizeBytes: brandWorkDocuments.sizeBytes,
          uploadedAt: brandWorkDocuments.uploadedAt,
        })
        .from(brandWorkDocuments)
        .where(inArray(brandWorkDocuments.recordId, ids))
        .orderBy(asc(brandWorkDocuments.uploadedAt))
    : [];
  return rows.map(({ r, brandName, message }) => ({
    id: r.id,
    endBrandName: r.endBrandName,
    brandName,
    billedPartyType: r.billedPartyType,
    billedPartyName: r.billedPartyName,
    industryCode: r.industryCode,
    platforms: r.platforms,
    deliverables: r.deliverables as DeliverableType[],
    visibility: r.visibility,
    description: r.description,
    deliverablesSummary: r.deliverablesSummary,
    workDate: r.workDate,
    invoiceDate: r.invoiceDate,
    invoiceAmountPaise: r.invoiceAmountPaise,
    verificationStatus: r.verificationStatus,
    paymentStatus: r.paymentStatus,
    paymentConfirmationMethod: r.paymentConfirmationMethod,
    paymentConfirmedMonth: r.paymentConfirmedMonth,
    requestedConfirmation: r.requestedConfirmation,
    message: r.verificationStatus === "needs_info" || r.verificationStatus === "rejected" ? message : null,
    submittedAt: r.submittedAt,
    verifiedAt: r.verifiedAt,
    createdAt: r.createdAt,
    documents: docs.filter((d) => d.recordId === r.id).map(({ recordId: _recordId, ...d }) => d),
  }));
}

export async function getRecordForCreator(db: DbExecutor, userId: string, recordId: string) {
  return (await listRecordsForCreator(db, userId)).find((r) => r.id === recordId) ?? null;
}

/** Record ids the creator owns (for API guards). */
export async function recordBelongsTo(db: DbExecutor, userId: string, recordId: string) {
  const [r] = await db
    .select({ id: brandWorkRecords.id })
    .from(brandWorkRecords)
    .where(and(eq(brandWorkRecords.id, recordId), eq(brandWorkRecords.userId, userId)));
  return Boolean(r);
}
