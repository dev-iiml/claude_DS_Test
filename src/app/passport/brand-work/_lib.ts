import "server-only";

import { getDb } from "@/db";
import { type CONSENT_KEYS, getActiveDefinition, hasValidConsent } from "@/modules/consent";

/** India-time date for date inputs (`max` on the work date). */
export const istToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

/** The consent definition to show when the creator hasn't given it yet (null when already given). */
export async function pendingConsent(userId: string, key: (typeof CONSENT_KEYS)[keyof typeof CONSENT_KEYS]) {
  const db = getDb();
  if (await hasValidConsent(db, userId, key)) return null;
  const d = await getActiveDefinition(db, key);
  return d ? { id: d.id, title: d.title, purpose: d.purpose, body: d.body, version: d.version } : null;
}
