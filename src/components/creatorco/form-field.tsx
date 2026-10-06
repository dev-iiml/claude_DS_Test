import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";

export interface FieldA11y {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
  "aria-required"?: true;
}

/**
 * Accessible field wrapper: wires label, description and error message to the
 * control via ids, so screen readers announce all three. The control is passed
 * as a render function receiving the a11y props.
 */
export function FormField({
  id,
  label,
  description,
  errors,
  required,
  optionalLabel = true,
  className,
  children,
}: {
  id: string;
  label: string;
  description?: React.ReactNode;
  errors?: string[];
  required?: boolean;
  optionalLabel?: boolean;
  className?: string;
  children: (a11y: FieldA11y) => React.ReactNode;
}) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = errors?.length ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>
        {label}
        {!required && optionalLabel ? <span className="ml-1.5 font-normal text-ink-subtle">Optional</span> : null}
      </Label>
      {description ? (
        <p id={descriptionId} className="-mt-1 text-footnote leading-snug text-ink-muted">
          {description}
        </p>
      ) : null}
      {children({
        id,
        ...(errorId ? { "aria-invalid": true as const } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(required ? { "aria-required": true as const } : {}),
      })}
      <FieldError id={errorId} errors={errors} />
    </div>
  );
}

export function FieldError({ id, errors }: { id?: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p id={id} className="text-footnote text-danger">
      {errors[0]}
    </p>
  );
}

/**
 * Fieldset for grouped choices (radio/checkbox). The legend names the group;
 * errors are linked via aria-describedby on the fieldset.
 */
export function ChoiceFieldset({
  id,
  legend,
  description,
  errors,
  required,
  className,
  children,
}: {
  id: string;
  legend: string;
  description?: React.ReactNode;
  errors?: string[];
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = errors?.length ? `${id}-error` : undefined;
  return (
    <fieldset
      id={id}
      className={cn("flex flex-col gap-3", className)}
      aria-describedby={[descriptionId, errorId].filter(Boolean).join(" ") || undefined}
      aria-invalid={errorId ? true : undefined}
    >
      <legend className="mb-1 text-subhead font-medium">
        {legend}
        {!required ? <span className="ml-1.5 font-normal text-ink-subtle">Optional</span> : null}
      </legend>
      {description ? (
        <p id={descriptionId} className="text-footnote leading-snug text-ink-muted">
          {description}
        </p>
      ) : null}
      {children}
      <FieldError id={errorId} errors={errors} />
    </fieldset>
  );
}
