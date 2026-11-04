/**
 * Small-cell suppression for aggregate dashboards (Stage 15). Pure.
 *
 * Any count of people below MIN_CELL is shown as "fewer than 5", never as the
 * number, so an aggregate can't single out an individual creator. Percentages
 * are computed only from unsuppressed counts.
 */
export const MIN_CELL = 5;

export interface Suppressed {
  /** The count, or null when suppressed. */
  value: number | null;
  suppressed: boolean;
}

export function suppress(n: number): Suppressed {
  return n > 0 && n < MIN_CELL ? { value: null, suppressed: true } : { value: n, suppressed: false };
}

export function formatSuppressed(s: Suppressed): string {
  return s.suppressed ? `<${MIN_CELL}` : new Intl.NumberFormat("en-IN").format(s.value ?? 0);
}

export function formatPct(p: number | null): string {
  return p === null ? "—" : `${p}%`;
}
