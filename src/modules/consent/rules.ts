/**
 * Pure consent rules. A consent is valid only for the definition version that
 * is active *now*; publishing a new version requires the user to consent again.
 */
export interface DefinitionWindow {
  id: string;
  key: string;
  version: number;
  activeFrom: Date;
  activeTo: Date | null;
}

export interface ReceiptState {
  consentDefinitionId: string;
  status: "granted" | "withdrawn";
}

export function isDefinitionActive(def: DefinitionWindow, now: Date): boolean {
  return def.activeFrom.getTime() <= now.getTime() && (def.activeTo === null || def.activeTo.getTime() > now.getTime());
}

/** The active definition for a purpose (highest version wins if windows overlap). */
export function selectActiveDefinition<T extends DefinitionWindow>(
  defs: readonly T[],
  key: string,
  now: Date,
): T | null {
  return (
    defs.filter((d) => d.key === key && isDefinitionActive(d, now)).sort((a, b) => b.version - a.version)[0] ?? null
  );
}

export function hasValidConsentFor(receipts: readonly ReceiptState[], activeDefinitionId: string | null): boolean {
  if (!activeDefinitionId) return false;
  return receipts.some((r) => r.consentDefinitionId === activeDefinitionId && r.status === "granted");
}
