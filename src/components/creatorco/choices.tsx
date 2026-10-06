import * as React from "react";

import { cn } from "@/lib/cn";

/**
 * iOS-style choice controls built on native inputs, so keyboard behaviour,
 * form submission and VoiceOver semantics stay intact.
 */
const rowBase =
  "group relative flex min-h-choice-row cursor-pointer items-start gap-3 rounded-control bg-surface px-4 py-3.5 ring-1 ring-line ring-inset transition-[background-color,box-shadow] " +
  "hover:bg-elevated has-[:checked]:bg-elevated has-[:checked]:ring-ink/50 " +
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold " +
  "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45 has-[:disabled]:hover:bg-surface";

/**
 * Selection indicator. The real native input is stretched transparently over the
 * whole row, so taps, keyboard, VoiceOver and test automation all hit the control.
 */
function Indicator({ shape }: { shape: "radio" | "checkbox" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 flex size-indicator shrink-0 items-center justify-center ring-[1.5px] ring-ink-subtle transition-colors",
        shape === "radio" ? "rounded-full" : "rounded-[7px]",
        "group-has-[:checked]:bg-gold group-has-[:checked]:ring-gold",
      )}
    >
      <svg viewBox="0 0 16 16" className="size-3.5 text-paper opacity-0 group-has-[:checked]:opacity-100">
        <path
          d="M3.5 8.5l3 3 6-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function RadioRow({
  label,
  description,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label className={cn(rowBase, className)}>
      <input
        type="radio"
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-[inherit] opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <Indicator shape="radio" />
      <span className="flex flex-col gap-0.5">
        <span className="text-body leading-snug font-medium">{label}</span>
        {description ? <span className="text-subhead leading-snug text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}

export function CheckboxRow({
  label,
  description,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label className={cn(rowBase, className)}>
      <input
        type="checkbox"
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-[inherit] opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <Indicator shape="checkbox" />
      <span className="flex flex-col gap-0.5">
        <span className="text-body leading-snug font-medium">{label}</span>
        {description ? <span className="text-subhead leading-snug text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}

/** Multi-select chips for longer lists (categories, languages). Selected chips invert. */
export function CheckboxChip({
  label,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { label: string }) {
  return (
    <label
      className={cn(
        "relative inline-flex min-h-chip cursor-pointer items-center gap-2 rounded-full bg-elevated px-4 text-subhead font-medium ring-1 ring-line transition-colors select-none ring-inset",
        "hover:ring-line-strong has-[:checked]:bg-ink has-[:checked]:text-paper has-[:checked]:ring-ink",
        "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold",
        className,
      )}
    >
      <input
        type="checkbox"
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-[inherit] opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * iOS toggle switch. A native checkbox with role="switch", so it submits with
 * forms and VoiceOver announces "switch, on/off".
 */
export function SwitchRow({
  label,
  description,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "role"> & { label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label
      className={cn(
        "group relative flex min-h-choice-row cursor-pointer items-center justify-between gap-4 py-2",
        className,
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-body leading-snug">{label}</span>
        {description ? <span className="text-subhead leading-snug text-ink-muted">{description}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-[inherit] opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          "relative h-switch-h w-switch-w shrink-0 rounded-full bg-input-border transition-colors duration-(--motion-base)",
          "peer-checked:bg-success peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold",
          "after:absolute after:top-[2px] after:left-[2px] after:size-switch-thumb after:rounded-full after:bg-thumb after:shadow-thumb after:transition-transform after:duration-(--motion-base)",
          "peer-disabled:opacity-40 peer-checked:after:translate-x-[20px]",
        )}
      />
    </label>
  );
}

/** iOS segmented control (radio group). */
export function SegmentedControl({
  name,
  legend,
  options,
  value,
  defaultValue,
  onChange,
  className,
}: {
  name: string;
  legend: string;
  options: { value: string; label: string }[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  className?: string;
}) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="sr-only">{legend}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-[11px] bg-elevated p-0.5 ring-1 ring-line ring-inset">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "relative flex min-h-segment cursor-pointer items-center justify-center rounded-[9px] px-3 text-subhead font-medium text-ink-muted transition-colors select-none",
              "has-[:checked]:bg-ink has-[:checked]:text-paper has-[:checked]:shadow-thumb",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-[inherit] opacity-0 disabled:cursor-not-allowed"
              {...(value !== undefined ? { checked: value === o.value } : { defaultChecked: defaultValue === o.value })}
              onChange={() => onChange?.(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
