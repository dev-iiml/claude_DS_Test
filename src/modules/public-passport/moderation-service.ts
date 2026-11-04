import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import { creatorProfiles, passportReports, passportTakedowns, publicPassports } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";

import { REPORT_REASON_CODES, type ReportReason } from "./domain";
import { PassportError } from "./errors";

/**
 * "Report this page" and takedowns (Stage 19). Reports carry the passport id
 * and a reason code only. Partnerships admins can take a passport offline at
 * once pending review; making a takedown permanent needs a second admin.
 * Staff never change a creator's field settings and never see unlocked
 * content through this desk.
 */

export async function reportPassport(db: DbExecutor, input: { passportId: string; reason: string }) {
  if (!(REPORT_REASON_CODES as readonly string[]).includes(input.reason))
    throw new PassportError("invalid", "Choose a reason.");
  const [row] = await db
    .insert(passportReports)
    .values({ passportId: input.passportId, reason: input.reason as ReportReason })
    .returning({ id: passportReports.id });
  await recordAuditEvent(db, {
    actorType: "system",
    eventType: "public_passport.reported",
    entityType: "public_passport",
    entityId: input.passportId,
    metadata: { report: row!.id, reason: input.reason },
  });
}

export async function listReports(db: DbExecutor, status: "open" | "dismissed" | "actioned" = "open") {
  return db
    .select({
      id: passportReports.id,
      passportId: passportReports.passportId,
      reason: passportReports.reason,
      status: passportReports.status,
      createdAt: passportReports.createdAt,
      slug: publicPassports.slug,
    })
    .from(passportReports)
    .innerJoin(publicPassports, eq(publicPassports.id, passportReports.passportId))
    .where(eq(passportReports.status, status))
    .orderBy(desc(passportReports.createdAt))
    .limit(200);
}

export async function listTakedowns(db: DbExecutor) {
  return db
    .select({ t: passportTakedowns, slug: publicPassports.slug })
    .from(passportTakedowns)
    .innerJoin(publicPassports, eq(publicPassports.id, passportTakedowns.passportId))
    .where(inArray(passportTakedowns.status, ["offline", "permanent_proposed", "permanent"]))
    .orderBy(desc(passportTakedowns.createdAt));
}

/** Staff view of one passport: ids, link, status, reports and takedowns. No creator content. */
export async function passportForStaff(db: DbExecutor, passportId: string) {
  const [p] = await db
    .select({
      id: publicPassports.id,
      slug: publicPassports.slug,
      status: publicPassports.status,
      publishedAt: publicPassports.publishedAt,
      displayName: creatorProfiles.displayName,
    })
    .from(publicPassports)
    .innerJoin(creatorProfiles, eq(creatorProfiles.id, publicPassports.creatorId))
    .where(eq(publicPassports.id, passportId));
  if (!p) return null;
  const [reports, takedowns] = await Promise.all([
    db
      .select()
      .from(passportReports)
      .where(eq(passportReports.passportId, passportId))
      .orderBy(desc(passportReports.createdAt)),
    db
      .select()
      .from(passportTakedowns)
      .where(eq(passportTakedowns.passportId, passportId))
      .orderBy(desc(passportTakedowns.createdAt)),
  ]);
  return { passport: p, reports, takedowns };
}

async function bumpCache(tx: DbExecutor, passportId: string) {
  await tx
    .update(publicPassports)
    .set({ cacheVersion: sql`${publicPassports.cacheVersion} + 1` })
    .where(eq(publicPassports.id, passportId));
}

export async function handleReport(
  db: Database,
  input: { staffId: string; reportId: string; outcome: "dismissed" | "actioned"; now?: Date },
) {
  await db
    .update(passportReports)
    .set({ status: input.outcome, handledBy: input.staffId, handledAt: input.now ?? new Date() })
    .where(and(eq(passportReports.id, input.reportId), eq(passportReports.status, "open")));
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: input.staffId,
    eventType: `public_passport.report_${input.outcome}`,
    entityType: "passport_report",
    entityId: input.reportId,
  });
}

/** Takes a passport offline immediately, pending review. */
export async function takePassportOffline(
  db: Database,
  input: { staffId: string; passportId: string; reason: string },
) {
  if (!(REPORT_REASON_CODES as readonly string[]).includes(input.reason))
    throw new PassportError("invalid", "Choose a reason.");
  await db.transaction(async (tx) => {
    const [active] = await tx
      .select({ id: passportTakedowns.id })
      .from(passportTakedowns)
      .where(
        and(
          eq(passportTakedowns.passportId, input.passportId),
          inArray(passportTakedowns.status, ["offline", "permanent_proposed", "permanent"]),
        ),
      );
    if (active) throw new PassportError("wrong_state", "This passport is already offline.");
    await tx.insert(passportTakedowns).values({
      passportId: input.passportId,
      reason: input.reason as ReportReason,
      status: "offline",
      takenBy: input.staffId,
    });
    await bumpCache(tx, input.passportId);
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffId,
      eventType: "public_passport.taken_offline",
      entityType: "public_passport",
      entityId: input.passportId,
      metadata: { reason: input.reason },
    });
  });
}

export async function decideTakedown(
  db: Database,
  input: { staffId: string; takedownId: string; step: "propose_permanent" | "approve_permanent" | "lift" },
) {
  await db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(passportTakedowns)
      .where(eq(passportTakedowns.id, input.takedownId))
      .for("update");
    if (!t) throw new PassportError("not_found");
    if (input.step === "propose_permanent") {
      if (t.status !== "offline") throw new PassportError("wrong_state");
      await tx
        .update(passportTakedowns)
        .set({ status: "permanent_proposed", proposedBy: input.staffId })
        .where(eq(passportTakedowns.id, t.id));
    } else if (input.step === "approve_permanent") {
      if (t.status !== "permanent_proposed") throw new PassportError("wrong_state");
      if (t.proposedBy === input.staffId)
        throw new PassportError("four_eyes", "A different admin has to approve a permanent takedown.");
      await tx
        .update(passportTakedowns)
        .set({ status: "permanent", approvedBy: input.staffId })
        .where(eq(passportTakedowns.id, t.id));
    } else {
      if (t.status === "permanent")
        throw new PassportError("wrong_state", "A permanent takedown can't be lifted here.");
      if (t.status === "lifted") return;
      await tx
        .update(passportTakedowns)
        .set({ status: "lifted", liftedBy: input.staffId })
        .where(eq(passportTakedowns.id, t.id));
    }
    await bumpCache(tx, t.passportId);
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: input.staffId,
      eventType: `public_passport.takedown_${input.step}`,
      entityType: "public_passport",
      entityId: t.passportId,
    });
  });
}

/** Passports under an active takedown (the creator sees why their page is offline, without staff detail). */
export async function activeTakedownFor(db: DbExecutor, passportId: string) {
  const [t] = await db
    .select({ status: passportTakedowns.status })
    .from(passportTakedowns)
    .where(
      and(
        eq(passportTakedowns.passportId, passportId),
        inArray(passportTakedowns.status, ["offline", "permanent_proposed", "permanent"]),
      ),
    )
    .limit(1);
  return t?.status ?? null;
}
