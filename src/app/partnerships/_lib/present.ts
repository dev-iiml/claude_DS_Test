import type { AccessRequestStatus, OpportunityStatus } from "@/modules/access/domain";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

export const istDateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

/** A Date as an IST `datetime-local` value ("YYYY-MM-DDTHH:mm"). */
export function toIstLocal(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

export const REQUEST_TONE: Record<AccessRequestStatus, Tone> = {
  requested: "warning",
  approved: "success",
  declined: "neutral",
  cancelled: "neutral",
  expired: "neutral",
};

export const OPPORTUNITY_TONE: Record<OpportunityStatus, Tone> = {
  draft: "neutral",
  live: "success",
  closed: "neutral",
};
