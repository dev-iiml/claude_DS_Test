import { Alert } from "@/components/ui/alert";
import type { FormState } from "@/lib/forms";

/** Form-level error summary, announced to assistive tech. */
export function FormMessage({ state }: { state: FormState }) {
  if (state.status !== "error" || !state.message) return null;
  return <Alert tone="danger">{state.message}</Alert>;
}
