import { and, asc, count, eq, ilike, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { brandAliases, brandDirectory, brandDirectoryMerges, brandIndustries, brandWorkRecords } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";

import { BrandWorkError } from "./errors";
import { normaliseBrandName } from "./rules";

/**
 * Brand directory (entity resolution). Brand names and industries are
 * business data, not personal data — but they stay out of analytics events
 * and audit metadata all the same (ids only). Merges need a second reviewer;
 * a brand that records point to is merged, never deleted.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listIndustries(db: DbExecutor) {
  return db.select().from(brandIndustries).orderBy(asc(brandIndustries.sortOrder));
}

export async function searchDirectory(db: DbExecutor, q: string | undefined) {
  const term = q?.trim();
  const rows = await db
    .select({
      id: brandDirectory.id,
      name: brandDirectory.canonicalName,
      industryCode: brandDirectory.industryCode,
      status: brandDirectory.status,
      records: sql<number>`(select count(*)::int from ${brandWorkRecords} r where r.brand_directory_id = ${brandDirectory.id})`,
      aliases: sql<
        string[]
      >`coalesce((select array_agg(a.alias order by a.alias) from ${brandAliases} a where a.directory_id = ${brandDirectory.id}), '{}')`,
    })
    .from(brandDirectory)
    .where(
      and(
        eq(brandDirectory.status, "active"),
        term ? ilike(brandDirectory.canonicalName, `%${term.replace(/[%_]/g, "")}%`) : undefined,
      ),
    )
    .orderBy(asc(brandDirectory.canonicalName))
    .limit(100);
  return rows.map((r) => ({ ...r, records: Number(r.records) }));
}

async function assertIndustry(tx: DbExecutor, code: string) {
  const [i] = await tx
    .select({ code: brandIndustries.code })
    .from(brandIndustries)
    .where(eq(brandIndustries.code, code));
  if (!i) throw new BrandWorkError("invalid", "Choose an industry.");
}

async function addAliasTx(tx: DbExecutor, directoryId: string, name: string, staffId: string) {
  const alias = normaliseBrandName(name);
  if (!alias) return;
  await tx.insert(brandAliases).values({ alias, directoryId, createdBy: staffId }).onConflictDoNothing();
}

export async function createBrand(db: Database, input: { staffId: string; name: string; industryCode: string }) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new BrandWorkError("invalid", "Brand names are 2–80 characters.");
  return db.transaction(async (tx) => {
    await assertIndustry(tx, input.industryCode);
    const alias = normaliseBrandName(name);
    const [taken] = alias
      ? await tx.select({ id: brandAliases.directoryId }).from(brandAliases).where(eq(brandAliases.alias, alias))
      : [];
    if (taken) throw new BrandWorkError("invalid", "A brand with that name is already in the directory.");
    const [b] = await tx
      .insert(brandDirectory)
      .values({ canonicalName: name, industryCode: input.industryCode, createdBy: input.staffId })
      .returning({ id: brandDirectory.id });
    await addAliasTx(tx, b!.id, name, input.staffId);
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffId,
      eventType: "brand_directory.created",
      entityType: "brand_directory",
      entityId: b!.id,
    });
    return b!.id;
  });
}

export async function addAlias(db: Database, input: { staffId: string; directoryId: string; alias: string }) {
  await db.transaction(async (tx) => {
    const alias = normaliseBrandName(input.alias);
    if (!alias) throw new BrandWorkError("invalid", "Enter an alias.");
    const [existing] = await tx.select().from(brandAliases).where(eq(brandAliases.alias, alias));
    if (existing && existing.directoryId !== input.directoryId)
      throw new BrandWorkError("invalid", "That alias already points to another brand.");
    await addAliasTx(tx, input.directoryId, input.alias, input.staffId);
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffId,
      eventType: "brand_directory.alias_added",
      entityType: "brand_directory",
      entityId: input.directoryId,
    });
  });
}

export async function setIndustry(db: Database, input: { staffId: string; directoryId: string; industryCode: string }) {
  await db.transaction(async (tx) => {
    await assertIndustry(tx, input.industryCode);
    await tx
      .update(brandDirectory)
      .set({ industryCode: input.industryCode })
      .where(eq(brandDirectory.id, input.directoryId));
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffId,
      eventType: "brand_directory.industry_set",
      entityType: "brand_directory",
      entityId: input.directoryId,
    });
  });
}

/**
 * Resolves a record's end brand to a directory entry (existing, or created
 * now) and confirms its industry. The creator's spelling becomes an alias.
 */
export async function resolveRecordBrand(
  db: Database,
  input: {
    staffId: string;
    recordId: string;
    directoryId?: string | null;
    newBrandName?: string | null;
    industryCode: string;
  },
) {
  const directoryId =
    input.directoryId ||
    (input.newBrandName
      ? await createBrand(db, { staffId: input.staffId, name: input.newBrandName, industryCode: input.industryCode })
      : null);
  if (!directoryId || !UUID.test(directoryId))
    throw new BrandWorkError("invalid", "Pick a brand from the directory or add a new one.");
  await db.transaction(async (tx) => {
    await assertIndustry(tx, input.industryCode);
    const [r] = await tx.select().from(brandWorkRecords).where(eq(brandWorkRecords.id, input.recordId)).for("update");
    if (!r) throw new BrandWorkError("not_found");
    if (r.userId === input.staffId) throw new BrandWorkError("own_record", "You can't review your own records.");
    if (r.verificationStatus !== "in_review")
      throw new BrandWorkError("wrong_state", "Only records in review can be resolved.");
    const [b] = await tx.select().from(brandDirectory).where(eq(brandDirectory.id, directoryId));
    if (!b || b.status !== "active") throw new BrandWorkError("invalid", "Pick an active brand.");
    await tx
      .update(brandWorkRecords)
      .set({ brandDirectoryId: b.id, industryCode: input.industryCode, industryConfirmed: true })
      .where(eq(brandWorkRecords.id, r.id));
    if (b.industryCode !== input.industryCode)
      await tx.update(brandDirectory).set({ industryCode: input.industryCode }).where(eq(brandDirectory.id, b.id));
    await addAliasTx(tx, b.id, r.endBrandName, input.staffId);
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffId,
      eventType: "brand_work.resolve_brand",
      entityType: "brand_work_record",
      entityId: r.id,
      metadata: { directory_id: b.id },
    });
  });
}

export async function proposeMerge(
  db: Database,
  input: { staffId: string; fromId: string; intoId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  if (!UUID.test(input.fromId) || !UUID.test(input.intoId)) throw new BrandWorkError("invalid", "Pick a brand.");
  if (input.fromId === input.intoId) throw new BrandWorkError("invalid", "Pick two different brands.");
  await db.transaction(async (tx) => {
    const [from] = await tx.select().from(brandDirectory).where(eq(brandDirectory.id, input.fromId));
    const [into] = await tx.select().from(brandDirectory).where(eq(brandDirectory.id, input.intoId));
    if (!from || !into || from.status !== "active" || into.status !== "active")
      throw new BrandWorkError("invalid", "Both brands must be active.");
    try {
      await tx
        .insert(brandDirectoryMerges)
        .values({ fromId: from.id, intoId: into.id, proposedBy: input.staffId, proposedAt: now });
    } catch {
      throw new BrandWorkError("wrong_state", "A merge for this brand is already waiting for approval.");
    }
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffId,
      eventType: "brand_directory.merge_proposed",
      entityType: "brand_directory",
      entityId: from.id,
      metadata: { into: into.id },
    });
  });
}

/** A different reviewer approves: records and aliases follow the merge; the old entry stays as `merged`. */
export async function decideMerge(
  db: Database,
  input: { staffId: string; mergeId: string; decision: "approve" | "decline"; now?: Date },
) {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(brandDirectoryMerges)
      .where(eq(brandDirectoryMerges.id, input.mergeId))
      .for("update");
    if (!m) throw new BrandWorkError("not_found");
    if (m.status !== "proposed") throw new BrandWorkError("wrong_state", "This merge has already been decided.");
    if (m.proposedBy === input.staffId)
      throw new BrandWorkError("four_eyes", "Another reviewer has to approve your merge.");
    await tx
      .update(brandDirectoryMerges)
      .set({ status: input.decision === "approve" ? "approved" : "declined", decidedBy: input.staffId, decidedAt: now })
      .where(eq(brandDirectoryMerges.id, m.id));
    if (input.decision === "approve") {
      const [into] = await tx.select().from(brandDirectory).where(eq(brandDirectory.id, m.intoId));
      if (!into || into.status !== "active")
        throw new BrandWorkError("invalid", "The brand to merge into is no longer active.");
      await tx
        .update(brandWorkRecords)
        .set({ brandDirectoryId: m.intoId })
        .where(eq(brandWorkRecords.brandDirectoryId, m.fromId));
      await tx.update(brandAliases).set({ directoryId: m.intoId }).where(eq(brandAliases.directoryId, m.fromId));
      await tx
        .update(brandDirectory)
        .set({ status: "merged", mergedInto: m.intoId })
        .where(eq(brandDirectory.id, m.fromId));
    }
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffId,
      eventType: input.decision === "approve" ? "brand_directory.merge_approved" : "brand_directory.merge_declined",
      entityType: "brand_directory",
      entityId: m.fromId,
      metadata: { into: m.intoId },
    });
  });
}

export async function listOpenMerges(db: DbExecutor) {
  const rows = await db
    .select({ m: brandDirectoryMerges, fromName: brandDirectory.canonicalName })
    .from(brandDirectoryMerges)
    .innerJoin(brandDirectory, eq(brandDirectory.id, brandDirectoryMerges.fromId))
    .where(eq(brandDirectoryMerges.status, "proposed"))
    .orderBy(asc(brandDirectoryMerges.proposedAt));
  const intoNames = new Map(
    (await db.select({ id: brandDirectory.id, name: brandDirectory.canonicalName }).from(brandDirectory)).map((b) => [
      b.id,
      b.name,
    ]),
  );
  return rows.map(({ m, fromName }) => ({
    id: m.id,
    fromName,
    intoName: intoNames.get(m.intoId) ?? "?",
    proposedBy: m.proposedBy,
    proposedAt: m.proposedAt,
  }));
}

export async function countRecordsForBrand(db: DbExecutor, directoryId: string) {
  const [n] = await db
    .select({ n: count() })
    .from(brandWorkRecords)
    .where(eq(brandWorkRecords.brandDirectoryId, directoryId));
  return Number(n?.n ?? 0);
}
