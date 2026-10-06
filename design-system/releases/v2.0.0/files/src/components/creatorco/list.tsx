import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/cn";

import { GroupLabel } from "./heading";

/**
 * iOS inset-grouped list. A labelled section (`<section aria-labelledby>`)
 * containing rows separated by hairlines. Maps 1:1 to a SwiftUI `List` /
 * `Section` or a React Native `SectionList` in future native apps.
 */
export function ListGroup({
  id,
  label,
  footer,
  action,
  children,
  className,
}: {
  id?: string;
  label?: string;
  footer?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-label` : undefined;
  return (
    <section aria-labelledby={headingId} className={cn("flex flex-col", className)}>
      {label || action ? (
        <div className="flex items-end justify-between gap-3 pr-4">
          {label ? <GroupLabel id={headingId}>{label}</GroupLabel> : <span />}
          {action ? <div className="pb-1.5">{action}</div> : null}
        </div>
      ) : null}
      <ul
        className="divide-y divide-line overflow-hidden rounded-lg bg-surface ring-1 ring-line ring-inset"
        role="list"
      >
        {children}
      </ul>
      {footer ? <div className="px-4 pt-2 text-footnote leading-snug text-ink-subtle">{footer}</div> : null}
    </section>
  );
}

/**
 * A row: label (+ optional detail) on the left, value / accessory on the
 * right. With `href` the row becomes a navigation link with a chevron.
 */
export function ListRow({
  label,
  detail,
  value,
  accessory,
  href,
  leading,
  className,
}: {
  label: React.ReactNode;
  detail?: React.ReactNode;
  value?: React.ReactNode;
  accessory?: React.ReactNode;
  href?: string;
  leading?: React.ReactNode;
  className?: string;
}) {
  const body = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body leading-snug break-words">{label}</span>
        {detail ? <span className="text-footnote leading-snug break-words text-ink-muted">{detail}</span> : null}
      </span>
      {value !== undefined && value !== null ? (
        <span className="max-w-[55%] shrink-0 text-right text-body leading-snug break-words text-ink-muted">
          {value}
        </span>
      ) : null}
      {accessory ? <span className="shrink-0">{accessory}</span> : null}
      {href ? <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-ink-subtle" strokeWidth={2} /> : null}
    </>
  );
  const rowClass = cn("flex min-h-row items-center gap-3 px-4 py-2.5", className);
  return (
    <li>
      {href ? (
        <Link href={href} className={cn(rowClass, "transition-colors hover:bg-elevated active:bg-elevated")}>
          {body}
        </Link>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}
