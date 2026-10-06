import * as React from "react";

import { cn } from "@/lib/cn";

export function Eyebrow({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "text-footnote font-semibold tracking-[var(--tracking-eyebrow)] text-ink-subtle uppercase",
        className,
      )}
      {...props}
    />
  );
}

/** Hero headline (landing, welcome). */
export function DisplayHeading({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      className={cn(
        "text-[40px] leading-[1.04] font-bold tracking-[-0.035em] text-balance sm:text-[56px] lg:text-[64px]",
        className,
      )}
      {...props}
    />
  );
}

/** iOS Large Title. */
export function PageHeading({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      className={cn("text-large-title leading-[1.15] font-bold tracking-[-0.025em] text-balance", className)}
      {...props}
    />
  );
}

export function SectionHeading({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("text-title-2 leading-tight font-bold tracking-[-0.02em]", className)} {...props} />;
}

/** Grouped-list section header (iOS footnote caps). */
export function GroupLabel({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn("px-4 pb-2 text-footnote font-medium tracking-[0.02em] text-ink-subtle uppercase", className)}
      {...props}
    />
  );
}

export function Lede({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("max-w-prose text-body leading-snug text-pretty text-ink-muted", className)} {...props} />;
}
