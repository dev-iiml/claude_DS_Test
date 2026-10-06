import type { creditApplications } from "@/db/schema";

type App = Pick<
  typeof creditApplications.$inferSelect,
  "id" | "status" | "detailsCompletedAt" | "bureauStatus" | "cashflowStatus" | "accountsCompleteDeclared"
>;

export const ELIGIBILITY_STEPS = [
  { key: "consent", label: "Consent" },
  { key: "details", label: "Your details" },
  { key: "credit-check", label: "Credit check" },
  { key: "bank", label: "Bank accounts" },
  { key: "review", label: "Review" },
  { key: "summary", label: "Check complete" },
] as const;
export type EligibilityStep = (typeof ELIGIBILITY_STEPS)[number]["key"];

const ORDER = ELIGIBILITY_STEPS.map((s) => s.key) as EligibilityStep[];

/** Bank step is settled: skipped, or data received and the coverage question answered. */
export function bankSettled(app: App) {
  return (
    app.cashflowStatus === "skipped" || (app.cashflowStatus === "completed" && app.accountsCompleteDeclared !== null)
  );
}

export function currentStep(app: App): EligibilityStep {
  if (app.status !== "draft") return "summary";
  if (!app.detailsCompletedAt) return "details";
  if (app.bureauStatus !== "completed") return "credit-check";
  if (!bankSettled(app)) return "bank";
  return "review";
}

export function stepPath(app: App, step: EligibilityStep = currentStep(app)): string {
  return step === "summary" ? `/eligibility/${app.id}` : `/eligibility/${app.id}/${step}`;
}

/**
 * A step is reachable once every earlier step is done. After confirming,
 * the creator can still revisit details and bank accounts (a change sends the
 * check back to Review); Review itself redirects to the summary.
 */
export function canOpen(app: App, step: EligibilityStep): boolean {
  if (app.status === "inputs_ready") return step !== "review" && step !== "consent";
  return ORDER.indexOf(step) <= ORDER.indexOf(currentStep(app));
}

/** Where the back link on a step goes. */
export function backFor(app: App, step: EligibilityStep): { href: string; label: string } {
  if (step === "summary" || step === "consent" || (step === "details" && app.status === "draft")) {
    return { href: "/eligibility", label: "Financial eligibility" };
  }
  if (app.status === "inputs_ready") return { href: stepPath(app, "summary"), label: "Check complete" };
  const previous = ORDER[ORDER.indexOf(step) - 1]!;
  return { href: stepPath(app, previous), label: ELIGIBILITY_STEPS.find((s) => s.key === previous)!.label };
}
