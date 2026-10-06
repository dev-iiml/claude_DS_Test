import { CircleAlert, CircleCheck, CircleDashed, CircleDot } from "lucide-react";

import { cn } from "@/lib/cn";

export type VerificationState = "verified" | "declared" | "attention" | "missing";

const MARKS = {
  verified: { Icon: CircleCheck, className: "text-success", label: "Verified" },
  declared: { Icon: CircleDot, className: "text-ink-subtle", label: "Self-declared" },
  attention: { Icon: CircleAlert, className: "text-warning", label: "Needs attention" },
  missing: { Icon: CircleDashed, className: "text-ink-subtle", label: "Not provided" },
} as const;

/** Verification state glyph with a text equivalent for VoiceOver (never colour alone). */
export function VerificationMark({ state, className }: { state: VerificationState; className?: string }) {
  const { Icon, className: tone, label } = MARKS[state];
  return (
    <span className={cn("inline-flex items-center", tone, className)}>
      <Icon aria-hidden="true" className="size-indicator" strokeWidth={2} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export const VERIFICATION_LABELS: Record<VerificationState, string> = {
  verified: MARKS.verified.label,
  declared: MARKS.declared.label,
  attention: MARKS.attention.label,
  missing: MARKS.missing.label,
};
