import { and, eq } from "drizzle-orm";

import { creatorProfiles } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";

/**
 * Membership pause/resume, driven by the Creator Profile consent. A paused
 * profile keeps its data but nothing is processed until the creator resumes.
 */
export async function pauseMembership(db: DbExecutor, input: { userId: string; now: Date }): Promise<boolean> {
  const [row] = await db
    .update(creatorProfiles)
    .set({ profileStatus: "paused", pausedAt: input.now })
    .where(and(eq(creatorProfiles.userId, input.userId), eq(creatorProfiles.profileStatus, "completed")))
    .returning({ id: creatorProfiles.id });
  if (!row) return false;
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: input.userId,
    eventType: "membership.paused",
    entityType: "creator_profile",
    entityId: row.id,
  });
  return true;
}

export async function resumeMembership(db: DbExecutor, input: { userId: string }): Promise<boolean> {
  const [row] = await db
    .update(creatorProfiles)
    .set({ profileStatus: "completed", pausedAt: null })
    .where(and(eq(creatorProfiles.userId, input.userId), eq(creatorProfiles.profileStatus, "paused")))
    .returning({ id: creatorProfiles.id });
  if (!row) return false;
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: input.userId,
    eventType: "membership.resumed",
    entityType: "creator_profile",
    entityId: row.id,
  });
  return true;
}
