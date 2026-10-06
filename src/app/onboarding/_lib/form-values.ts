import type { FormState } from "@/lib/forms";

/** Prefer values echoed back after a failed submit; otherwise the saved value. */
export function textValue(state: FormState, key: string, saved: string | null | undefined): string {
  const v = state.values?.[key];
  return typeof v === "string" ? v : (saved ?? "");
}

export function listValue(state: FormState, key: string, saved: readonly string[] | null | undefined): string[] {
  const v = state.values?.[key];
  return Array.isArray(v) ? v : [...(saved ?? [])];
}

export function boolValue(state: FormState, key: string, saved: boolean | null | undefined): boolean {
  const v = state.values?.[key];
  return typeof v === "boolean" ? v : Boolean(saved);
}
