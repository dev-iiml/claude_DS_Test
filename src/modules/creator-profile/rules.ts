import {
  GST_STATUSES,
  ONBOARDING_STEPS,
  PILOT_SUPPORTED_LEGAL_FORMS,
  type GstStatus,
  type LegalForm,
  type OnboardingStep,
} from "./domain";

/** Whether the legal form is accepted in the current Cohort A0 pilot. */
export function isPilotSupportedLegalForm(form: LegalForm): boolean {
  return (PILOT_SUPPORTED_LEGAL_FORMS as readonly LegalForm[]).includes(form);
}

/**
 * Applies the GST declaration rule: a GSTIN is kept only when the creator says
 * they are registered. No obligation is inferred from any other attribute.
 */
export function normaliseGstDeclaration(gstStatus: GstStatus, gstin: string | null | undefined) {
  if (!(GST_STATUSES as readonly string[]).includes(gstStatus)) throw new Error("unknown GST status");
  return { gstStatus, gstin: gstStatus === "registered" && gstin ? gstin : null };
}

export type Cohort = "A0" | "A1" | "B" | "requires_review";

/**
 * Descriptive cohort derived from what the creator declared. This is a
 * routing/segmentation label only — not a tax or legal determination.
 */
export function classifyCohort(legalForm: LegalForm, gstStatus: GstStatus): Cohort {
  if (!isPilotSupportedLegalForm(legalForm)) return "B";
  if (gstStatus === "registered") return "A1";
  if (gstStatus === "not_registered") return "A0";
  return "requires_review";
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

/** The step the creator should do next, given the last one they completed (null = none). */
export function nextOnboardingStep(lastCompleted: OnboardingStep | null): OnboardingStep | "done" {
  if (lastCompleted === null) return "about";
  const next = ONBOARDING_STEPS[stepIndex(lastCompleted) + 1];
  return next ?? "done";
}

/** A step may be (re)visited once every earlier step is complete. */
export function canAccessStep(step: OnboardingStep, lastCompleted: OnboardingStep | null): boolean {
  const reached = lastCompleted === null ? -1 : stepIndex(lastCompleted);
  return stepIndex(step) <= reached + 1;
}

/** Monotonic progress: going back to edit an earlier step never regresses progress. */
export function advanceProgress(current: OnboardingStep | null, saved: OnboardingStep): OnboardingStep {
  if (current === null) return saved;
  return stepIndex(saved) > stepIndex(current) ? saved : current;
}

/** "YYYY-MM" (from <input type="month">) → "YYYY-MM-01". */
export function monthToDate(month: string): string {
  return `${month}-01`;
}

export interface CompletionInput {
  displayName: string | null;
  legalName: string | null;
  city: string | null;
  state: string | null;
  languages: readonly string[];
  primaryCreatorHandle: string | null;
  creatorCategory: string | null;
  creatorSince: string | null;
  declaredPlatforms: number;
  connectedAccounts: number;
  legalForm: string | null;
  gstStatus: string | null;
  hasInterests: boolean;
  hasCreatorProfileConsent: boolean;
}

export interface CompletionItem {
  key: string;
  label: string;
  done: boolean;
  weight: number;
}

/**
 * Creator Professional Profile completeness — a UX indicator only. It is not
 * an input to Creator Status or to any financial decision.
 */
export function computeProfileCompletion(input: CompletionInput): { percent: number; items: CompletionItem[] } {
  const items: CompletionItem[] = [
    { key: "identity", label: "Name", weight: 10, done: Boolean(input.legalName && input.displayName) },
    { key: "location", label: "City and state", weight: 5, done: Boolean(input.city && input.state) },
    { key: "languages", label: "Languages", weight: 5, done: input.languages.length > 0 },
    { key: "handle", label: "Primary handle", weight: 10, done: Boolean(input.primaryCreatorHandle) },
    { key: "category", label: "Category", weight: 10, done: Boolean(input.creatorCategory) },
    { key: "creator_since", label: "Creating since", weight: 5, done: Boolean(input.creatorSince) },
    { key: "platforms", label: "Platforms you use", weight: 10, done: input.declaredPlatforms > 0 },
    { key: "business", label: "Business status", weight: 10, done: Boolean(input.legalForm && input.gstStatus) },
    { key: "interests", label: "Professional interests", weight: 5, done: input.hasInterests },
    { key: "consent", label: "Creator Profile consent", weight: 10, done: input.hasCreatorProfileConsent },
    { key: "connected", label: "Connect a creator account", weight: 20, done: input.connectedAccounts > 0 },
  ];
  const total = items.reduce((s, i) => s + i.weight, 0);
  const done = items.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  return { percent: Math.round((done / total) * 100), items };
}
