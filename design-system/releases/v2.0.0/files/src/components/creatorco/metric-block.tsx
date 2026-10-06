import * as React from "react";

import { cn } from "@/lib/cn";

export interface MetricBlockProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}

/** A labelled figure. <dl> semantics keep label and value associated for VoiceOver. */
export function MetricBlock({ label, value, hint, className }: MetricBlockProps) {
  return (
    <dl className={cn("flex flex-col gap-1", className)}>
      <dt className="text-footnote font-medium text-ink-subtle">{label}</dt>
      <dd className="text-title-1 leading-none font-bold tracking-tight tabular-nums">{value}</dd>
      {hint ? <dd className="text-footnote text-ink-muted">{hint}</dd> : null}
    </dl>
  );
}
