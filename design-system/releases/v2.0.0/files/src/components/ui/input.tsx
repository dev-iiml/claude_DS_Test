import * as React from "react";

import { cn } from "@/lib/cn";

/** 17px text (iOS body) — never below 16px, so iOS Safari doesn't zoom on focus. */
export const fieldClasses =
  "flex h-control w-full min-w-0 rounded-control border border-input bg-elevated px-4 text-body text-ink placeholder:text-ink-subtle " +
  "transition-colors focus-visible:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(fieldClasses, className)} {...props} />;
}
