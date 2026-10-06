import { and, desc, eq } from "drizzle-orm";

import { isUniqueViolation } from "@/db/errors";
import { consentDefinitions, consentReceipts } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";

import type { ConsentKey, ConsentSource } from "./domain";
import { hasValidConsentFor, isDefinitionActive, selectActiveDefinition } from "./rules";

export type ConsentDefinition = typeof consentDefinitions.$inferSelect;
export type ConsentReceipt = typeof consentReceipts.$inferSelect;

export class ConsentError extends Error {
  constructor(
    readonly code: "definition_not_found" | "definition_not_active" | "definition_key_mismatch" | "receipt_not_found",
    message: string,
  ) {
    super(message);
    this.name = "ConsentError";
  }
}

export async function getActiveDefinition(db: DbExecutor, key: ConsentKey, now = new Date()) {
  const defs = await db.select().from(consentDefinitions).where(eq(consentDefinitions.key, key));
  return selectActiveDefinition(defs, key, now);
}

export interface GrantConsentInput {
  userId: string;
  key: ConsentKey;
  /** The definition the user was shown. Must still be the active version. */
  consentDefinitionId: string;
  source: ConsentSource;
  metadata?: Record<string, string | number | boolean>;
  now?: Date;
}

/**
 * Records a consent grant against an exact definition version. Idempotent: a
 * repeated grant for the same version returns the existing receipt.
 */
export async function grantConsent(db: DbExecutor, input: GrantConsentInput): Promise<ConsentReceipt> {
  const now = input.now ?? new Date();
  const [def] = await db
    .select()
    .from(consentDefinitions)
    .where(eq(consentDefinitions.id, input.consentDefinitionId))
    .limit(1);

  if (!def) throw new ConsentError("definition_not_found", "Consent definition not found");
  if (def.key !== input.key)
    throw new ConsentError("definition_key_mismatch", "Consent definition is for a different purpose");
  if (!isDefinitionActive(def, now)) {
    throw new ConsentError("definition_not_active", "This consent version is no longer current");
  }

  const existing = await findActiveGrant(db, input.userId, def.id);
  if (existing) return existing;

  try {
    const [receipt] = await db
      .insert(consentReceipts)
      .values({
        userId: input.userId,
        consentDefinitionId: def.id,
        status: "granted",
        grantedAt: now,
        source: input.source,
        metadata: input.metadata ?? {},
      })
      .returning();
    if (!receipt) throw new Error("consent receipt insert returned no row");

    await recordAuditEvent(db, {
      actorType: "user",
      actorId: input.userId,
      eventType: "consent.granted",
      entityType: "consent_receipt",
      entityId: receipt.id,
      metadata: { consent_key: def.key, definition_version: def.version, source: input.source },
    });
    return receipt;
  } catch (error) {
    // Concurrent double-submit: the partial unique index guarantees a single active grant.
    if (isUniqueViolation(error, "consent_receipts_one_active_grant_key")) {
      const raced = await findActiveGrant(db, input.userId, def.id);
      if (raced) return raced;
    }
    throw error;
  }
}

async function findActiveGrant(db: DbExecutor, userId: string, definitionId: string) {
  const [row] = await db
    .select()
    .from(consentReceipts)
    .where(
      and(
        eq(consentReceipts.userId, userId),
        eq(consentReceipts.consentDefinitionId, definitionId),
        eq(consentReceipts.status, "granted"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The user's granted receipt for the currently active version of `key`, if any. */
export async function findValidReceipt(db: DbExecutor, userId: string, key: ConsentKey, now = new Date()) {
  const active = await getActiveDefinition(db, key, now);
  if (!active) return null;
  return findActiveGrant(db, userId, active.id);
}

/** True when the user holds a granted receipt for the currently active version of `key`. */
export async function hasValidConsent(db: DbExecutor, userId: string, key: ConsentKey, now = new Date()) {
  const active = await getActiveDefinition(db, key, now);
  if (!active) return false;
  const receipts = await db
    .select({ consentDefinitionId: consentReceipts.consentDefinitionId, status: consentReceipts.status })
    .from(consentReceipts)
    .where(and(eq(consentReceipts.userId, userId), eq(consentReceipts.consentDefinitionId, active.id)));
  return hasValidConsentFor(receipts, active.id);
}

/**
 * Withdraws a granted receipt. (Stage 08 adds the creator-facing withdrawal
 * journey and downstream effects; this is the audited primitive.)
 */
export async function withdrawConsent(
  db: DbExecutor,
  input: { userId: string; receiptId: string; now?: Date },
): Promise<ConsentReceipt> {
  const now = input.now ?? new Date();
  const [updated] = await db
    .update(consentReceipts)
    .set({ status: "withdrawn", withdrawnAt: now })
    .where(
      and(
        eq(consentReceipts.id, input.receiptId),
        eq(consentReceipts.userId, input.userId),
        eq(consentReceipts.status, "granted"),
      ),
    )
    .returning();
  if (!updated) throw new ConsentError("receipt_not_found", "No active consent receipt to withdraw");

  await recordAuditEvent(db, {
    actorType: "user",
    actorId: input.userId,
    eventType: "consent.withdrawn",
    entityType: "consent_receipt",
    entityId: updated.id,
  });
  return updated;
}

/** The user's consent receipts with their definitions, newest first (for consent history views). */
export async function listUserConsents(db: DbExecutor, userId: string) {
  return db
    .select({
      receiptId: consentReceipts.id,
      key: consentDefinitions.key,
      title: consentDefinitions.title,
      version: consentDefinitions.version,
      status: consentReceipts.status,
      grantedAt: consentReceipts.grantedAt,
      withdrawnAt: consentReceipts.withdrawnAt,
    })
    .from(consentReceipts)
    .innerJoin(consentDefinitions, eq(consentDefinitions.id, consentReceipts.consentDefinitionId))
    .where(eq(consentReceipts.userId, userId))
    .orderBy(desc(consentReceipts.grantedAt));
}
