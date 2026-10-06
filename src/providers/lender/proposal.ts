/**
 * The credit proposal CreatorCo shares with a partner lender (Stage 12).
 * Pure types and vocabulary — adapters map this to each lender's API.
 *
 * What is included is decided per partnership: a lender config's
 * `proposalProfile` lists the data groups, and the creator's "Share with a
 * partner lender" consent version must cover every group (enforced by the
 * lending module). The default is the minimum.
 */
export const PROPOSAL_DATA_GROUPS = [
  /** Requested amount and purposes. Always included. */
  "request",
  /** Financial Capacity features (bureau summary, verified cashflow, EMIs…). */
  "financial_capacity",
  /** Both models: grade, component scores, reason codes, exposure, tenor, completeness. */
  "model_results",
  /** Which bank accounts the cashflow covers. */
  "bank_coverage",
  /** Fraud layer outcome only: clear / watch / review. */
  "fraud_summary",
  /** Creator Professional Graph values the Creator-Enhanced model used (proprietary). */
  "professional_features",
  /** Each fraud flag with its evidence numbers. */
  "fraud_flag_details",
] as const;
export type ProposalDataGroup = (typeof PROPOSAL_DATA_GROUPS)[number];

/** The minimum (user decision for the pilot); anything more depends on partnership terms and consent. */
export const MINIMUM_PROPOSAL_PROFILE: readonly ProposalDataGroup[] = [
  "request",
  "financial_capacity",
  "model_results",
  "bank_coverage",
  "fraud_summary",
];

export type ProposalModelName = "traditional" | "creator_enhanced";

export interface ProposalModelResult {
  model: ProposalModelName;
  modelVersion: string;
  score: number | null;
  grade: string | null;
  outcome: "recommend" | "refer" | "not_recommended";
  completeness: number;
  confidence: string;
  recommendedExposure: number | null;
  maxRecommendedExposure: number | null;
  recommendedTenorMonths: number | null;
  components: Record<string, number | null>;
  reasonCodes: string[];
}

export interface ProposalPayload {
  schema: 1;
  proposalId: string;
  /** Opaque reference to the check (no creator identifiers). */
  applicationRef: string;
  createdAt: string;
  dataGroups: ProposalDataGroup[];
  versions: { underwriting: string; financialCapacity: string; fraudRules: string };
  request: { requestedAmount: number | null; purposes: string[] };
  financialCapacity?: { key: string; value: number | string | null; unit: string; confidence: string }[];
  models?: { traditional: ProposalModelResult | null; creatorEnhanced: ProposalModelResult | null };
  bankCoverage?: { status: "none" | "partial" | "complete"; accountsShared: number; accountsNotReceived: number };
  fraud?: { outcome: "clear" | "watch" | "review" };
  professionalFeatures?: Record<string, number | string | boolean | null>;
  fraudFlags?: { code: string; severity: string; evidence: Record<string, number | boolean | null> }[];
}
