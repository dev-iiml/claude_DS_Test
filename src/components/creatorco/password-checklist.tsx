"use client";

import { cn } from "@/lib/cn";

export interface ChecklistItem {
  key: string;
  label: string;
  met: boolean;
}

/**
 * Live requirement checklist. Each item announces its state to screen readers
 * ("met" / "not yet met"); updates are polite so typing isn't interrupted.
 */
export function RequirementChecklist({
  id,
  items,
  className,
}: {
  id: string;
  items: ChecklistItem[];
  className?: string;
}) {
  return (
    <ul id={id} aria-live="polite" className={cn("grid gap-1.5 text-footnote sm:grid-cols-2", className)}>
      {items.map((item) => (
        <li key={item.key} className={cn("flex items-center gap-2", item.met ? "text-success" : "text-ink-muted")}>
          <span
            aria-hidden="true"
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full border text-[0.65rem] leading-none",
              item.met ? "border-success bg-success text-paper" : "border-input-border bg-elevated",
            )}
          >
            {item.met ? "✓" : ""}
          </span>
          <span>
            {item.label}
            <span className="sr-only">{item.met ? " — met" : " — not yet met"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
