import { Badge } from "@/components/ui/badge";
import { CREATOR_STATUS_LABELS, type CreatorStatusTier } from "@/modules/creator-status/status";

const TONE: Record<CreatorStatusTier, "neutral" | "ink" | "brand"> = {
  member: "neutral",
  onyx: "ink",
  icon: "brand",
};

/** Creator Status tier badge. Status reflects professional standing — never credit. */
export function CreatorStatusBadge({ tier }: { tier: CreatorStatusTier }) {
  return (
    <Badge tone={TONE[tier]} className="px-3 py-1 text-[0.8rem] tracking-wide">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-70" />
      <span>
        <span className="sr-only">Creator Status: </span>
        {CREATOR_STATUS_LABELS[tier]}
      </span>
    </Badge>
  );
}

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

/** Generic workflow status (e.g. "Declared", "Connected", "Coming soon"). */
export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}
