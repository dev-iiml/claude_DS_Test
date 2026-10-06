import { cn } from "@/lib/cn";

export interface ProgressStep {
  key: string;
  label: string;
}

/**
 * Step indicator for multi-step journeys. The current step carries
 * aria-current="step"; completed steps are announced as such.
 */
export function ProgressSteps({
  steps,
  currentKey,
  label = "Onboarding progress",
  className,
}: {
  steps: readonly ProgressStep[];
  currentKey: string;
  label?: string;
  className?: string;
}) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.key === currentKey),
  );
  return (
    <nav aria-label={label} className={className}>
      <p className="mb-2.5 text-footnote font-medium text-ink-subtle">
        Step {currentIndex + 1} of {steps.length}
      </p>
      <ol className="flex gap-1.5">
        {steps.map((step, i) => {
          const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
          return (
            <li key={step.key} className="flex-1" aria-current={state === "current" ? "step" : undefined}>
              <span
                aria-hidden="true"
                className={cn(
                  "block h-1 rounded-full",
                  state === "done" && "bg-ink",
                  state === "current" && "bg-gold",
                  state === "upcoming" && "bg-input-border",
                )}
              />
              <span className="sr-only">
                {step.label}
                {state === "done" ? " (completed)" : state === "current" ? " (current step)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Linear completion meter (e.g. profile completeness). */
export function ProgressMeter({ value, label, className }: { value: number; label: string; className?: string }) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div className={className}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-1.5 w-full overflow-hidden rounded-full bg-line-strong/60"
      >
        <div
          className="h-full rounded-full bg-gold transition-[width] duration-(--motion-slow)"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
