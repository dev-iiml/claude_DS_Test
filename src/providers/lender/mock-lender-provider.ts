import { ProviderError } from "../errors";
import type { ProviderHealth } from "../types";
import { MINIMUM_PROPOSAL_PROFILE, type ProposalDataGroup } from "./proposal";
import { illustrativeOffer } from "./offer";
import { DEFAULT_SIMULATED_POLICY, evaluateSimulatedPolicy } from "./simulated-policy";
import type { CreditProposal, LenderDecision, LenderProvider } from "./types";

/**
 * Simulated partner lender (RE) for the pilot. Decides at once, applying the
 * simulated credit policy it receives with the proposal (the lending module's
 * active, maker-checker-approved version). Clearly not a real lender.
 */
export class MockLenderProvider implements LenderProvider {
  readonly descriptor = { key: "mock_re", kind: "lender", mode: "mock" } as const;

  constructor(private readonly profile: readonly ProposalDataGroup[] = MINIMUM_PROPOSAL_PROFILE) {}

  async health(): Promise<ProviderHealth> {
    return { status: "ok", checkedAt: new Date(0) };
  }

  proposalProfile() {
    return this.profile;
  }

  async submitProposal(proposal: CreditProposal) {
    if (proposal.payload?.schema !== 1) throw new ProviderError("rejected", "unsupported proposal schema");
    // Idempotent per proposal: re-sending the same proposal (a retry after a timeout) gets the same reference.
    return { lenderReference: `re_${proposal.proposalId}` };
  }

  async getDecision(lenderReference: string, proposal: CreditProposal): Promise<LenderDecision> {
    const policy = proposal.simulation?.policy ?? DEFAULT_SIMULATED_POLICY;
    const d = evaluateSimulatedPolicy(proposal.payload, policy);
    // Deterministic: the simulated lender "decides" when the proposal was made.
    const decidedAt = new Date(proposal.payload.createdAt);
    const pricing = policy.pricing;
    const offer =
      d.outcome !== "declined" && d.approvedExposure !== null && d.approvedTenorMonths !== null && d.grade
        ? {
            terms: illustrativeOffer({
              lenderName: "Simulated partner lender",
              amount: d.approvedExposure,
              tenorMonths: d.approvedTenorMonths,
              annualInterestRatePct: pricing.annualRatePctByGrade[d.grade],
              processingFeePct: pricing.processingFeePct,
              coolingOffDays: pricing.coolingOffDays,
              kfsReference: `SIM-KFS-${proposal.proposalId.slice(0, 8)}`,
            }),
            expiresAt: new Date(decidedAt.getTime() + pricing.offerValidDays * 86_400_000),
          }
        : null;
    return {
      proposalId: proposal.proposalId,
      lenderReference,
      outcome: d.outcome,
      approvedExposure: d.approvedExposure,
      approvedTenorMonths: d.approvedTenorMonths,
      decisionBasis: d.decisionBasis,
      policyVersion: proposal.simulation?.policyVersion ?? null,
      decisionReasonCodes: d.reasonCodes,
      decidedAt,
      offer,
    };
  }
}
