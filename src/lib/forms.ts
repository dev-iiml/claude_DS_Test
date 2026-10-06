import type { z } from "zod";

/**
 * Shared shape for server-action form state (used with React `useActionState`).
 * `values` echoes back non-sensitive input so fields are not wiped on error —
 * never echo passwords or restricted fields.
 */
export interface FormState {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string | string[] | boolean>;
}

export const initialFormState: FormState = { status: "idle" };

export function fieldErrorsFromZod(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function formError(message: string, extra: Omit<FormState, "status" | "message"> = {}): FormState {
  return { status: "error", message, ...extra };
}

/** Reads a single text field. Missing fields become undefined so schemas can apply defaults. */
export function readText(form: FormData, name: string): string | undefined {
  const v = form.get(name);
  return typeof v === "string" ? v : undefined;
}

/** Reads a multi-value field (checkbox group). */
export function readList(form: FormData, name: string): string[] {
  return form.getAll(name).filter((v): v is string => typeof v === "string");
}

/** A checkbox is "on" when present. */
export function readCheckbox(form: FormData, name: string): boolean {
  return form.get(name) !== null;
}
