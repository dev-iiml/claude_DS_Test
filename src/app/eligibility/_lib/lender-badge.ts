import type { CreatorLenderView } from "@/modules/lending";
import { OFFER_STATE_LABELS } from "@/modules/lending/presentation";

/** The badge for a check that was shared with a partner lender (list, dashboard). */
export function lenderBadge(view: CreatorLenderView): {
  tone: "brand" | "success" | "info" | "neutral";
  label: string;
  /** Something for the creator to do or read. */
  actionable: boolean;
} {
  if (view.stage === "decided") {
    if (view.offer) {
      const s = view.offer.state;
      return {
        tone: s === "open" ? "brand" : s === "accepted" ? "success" : "neutral",
        label: OFFER_STATE_LABELS[s],
        actionable: s === "open",
      };
    }
    return view.outcome === "declined"
      ? { tone: "neutral", label: "Not approved", actionable: true }
      : { tone: "success", label: "Decision ready", actionable: true };
  }
  if (view.stage === "closed") return { tone: "neutral", label: "Closed", actionable: false };
  if (view.stage === "with_lender") return { tone: "brand", label: "With a partner lender", actionable: false };
  return { tone: "info", label: "Preparing", actionable: false };
}
