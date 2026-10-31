import { and, eq, notInArray, sql } from "drizzle-orm";

import { creatorNotices } from "@/db/schema";
import type { DbExecutor } from "@/db/types";

export type NoticeKind = "aa_consent_ending" | "aa_data_life_ended";

/**
 * Neutral in-app notices (Stage 18). Replaced wholesale by the daily job:
 * no points, no streaks, no urgency language, no badges.
 */
export async function storeNotices(
  db: DbExecutor,
  notices: { userId: string; kind: NoticeKind; onDate: string }[],
): Promise<{ notices: number }> {
  const keys = notices.map((n) => `${n.userId}:${n.kind}`);
  await db
    .delete(creatorNotices)
    .where(
      keys.length ? notInArray(sql`${creatorNotices.userId}::text || ':' || ${creatorNotices.kind}`, keys) : undefined,
    );
  for (const n of notices) {
    await db
      .insert(creatorNotices)
      .values(n)
      .onConflictDoUpdate({ target: [creatorNotices.userId, creatorNotices.kind], set: { onDate: n.onDate } });
  }
  return { notices: notices.length };
}

export async function noticesFor(db: DbExecutor, userId: string) {
  return db
    .select({ kind: creatorNotices.kind, onDate: creatorNotices.onDate })
    .from(creatorNotices)
    .where(and(eq(creatorNotices.userId, userId)));
}

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

/** The notice text: plain, no urgency, no reward. */
export function noticeText(n: { kind: NoticeKind; onDate: string }): string {
  return n.kind === "aa_consent_ending"
    ? `The bank data you shared can be used until ${dayLabel(n.onDate)}. After that, brand payment checks won't run; your agency or a remittance advice can still confirm payments.`
    : `The bank data you shared reached the end of its permitted period on ${dayLabel(n.onDate)}, so brand payment checks can't run. Your agency or a remittance advice can still confirm payments.`;
}
