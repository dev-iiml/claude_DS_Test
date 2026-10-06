import type { ProposalDataGroup, ProposalModelResult, ProposalPayload } from "@/providers/lender/proposal";

/**
 * Builds the credit proposal payload from the confirmed check (pure). Only the
 * data groups in the partnership's profile are included; `request` always is.
 * No creator identifiers: the check is referenced opaquely.
 */
export interface ProposalSource {
  proposalId: string;
  applicationRef: string;
  createdAt: Date;
  groups: readonly ProposalDataGroup[];
  versions: ProposalPayload["versions"];
  request: ProposalPayload["request"];
  financialCapacity: { key: string; value: number | string | null; unit: string; confidence: string }[];
  models: { traditional: ProposalModelResult | null; creatorEnhanced: ProposalModelResult | null };
  bankCoverage: NonNullable<ProposalPayload["bankCoverage"]>;
  fraud: { outcome: "clear" | "watch" | "review"; flags: NonNullable<ProposalPayload["fraudFlags"]> };
  professionalFeatures: Record<string, number | string | boolean | null>;
}

export function buildProposalPayload(src: ProposalSource): ProposalPayload {
  const groups = new Set<ProposalDataGroup>(["request", ...src.groups]);
  const payload: ProposalPayload = {
    schema: 1,
    proposalId: src.proposalId,
    applicationRef: src.applicationRef,
    createdAt: src.createdAt.toISOString(),
    dataGroups: [...groups],
    versions: src.versions,
    request: src.request,
  };
  if (groups.has("financial_capacity")) payload.financialCapacity = src.financialCapacity;
  if (groups.has("model_results")) {
    // Without the fraud summary, model reason codes mustn't reveal the fraud outcome either.
    const strip = (m: ProposalModelResult | null) =>
      m && !groups.has("fraud_summary")
        ? { ...m, reasonCodes: m.reasonCodes.filter((c) => !c.startsWith("FRAUD_")) }
        : m;
    payload.models = { traditional: strip(src.models.traditional), creatorEnhanced: strip(src.models.creatorEnhanced) };
  }
  if (groups.has("bank_coverage")) payload.bankCoverage = src.bankCoverage;
  if (groups.has("fraud_summary")) payload.fraud = { outcome: src.fraud.outcome };
  if (groups.has("professional_features")) payload.professionalFeatures = src.professionalFeatures;
  if (groups.has("fraud_flag_details")) payload.fraudFlags = src.fraud.flags;
  return payload;
}

/** Stable JSON (sorted keys) for hashing what was sent. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
