import { ProviderError } from "../errors";
import type { ProviderHealth, ProviderMode } from "../types";
import { MINIMUM_PROPOSAL_PROFILE, type ProposalDataGroup } from "./proposal";
import type { CreditProposal, LenderDecision, LenderProvider } from "./types";

/**
 * A partner lender integrated through the CreatorCo partner API (Stage 12b,
 * user decision "pull + thin webhooks"). Vendor-neutral: any bank/NBFC that
 * consumes the partner API uses this adapter, configured in /ops.
 *
 * Submitting makes the frozen proposal available to the partner (the lending
 * module then emits a signed `proposal.submitted` webhook); the partner
 * fetches it with its API key and POSTs its decision back. Nothing is pushed
 * to the partner here, so there is no partner secret to hold.
 */
export class PartnerApiLenderProvider implements LenderProvider {
  readonly descriptor;

  constructor(
    mode: ProviderMode,
    private readonly profile: readonly ProposalDataGroup[] = MINIMUM_PROPOSAL_PROFILE,
  ) {
    this.descriptor = { key: "partner_api", kind: "lender", mode } as const;
  }

  async health(): Promise<ProviderHealth> {
    return { status: "ok", checkedAt: new Date() };
  }

  proposalProfile() {
    return this.profile;
  }

  /** Decisions arrive through the partner API, never by polling. */
  decisionDelivery() {
    return "push" as const;
  }

  async submitProposal(proposal: CreditProposal) {
    if (proposal.payload?.schema !== 1) throw new ProviderError("rejected", "unsupported proposal schema");
    // Idempotent per proposal. The partner may quote its own reference when it decides.
    return { lenderReference: `pp_${proposal.proposalId}` };
  }

  async getDecision(lenderReference: string, proposal: CreditProposal): Promise<LenderDecision> {
    return {
      proposalId: proposal.proposalId,
      lenderReference,
      outcome: "pending",
      approvedExposure: null,
      approvedTenorMonths: null,
      decisionBasis: null,
      policyVersion: null,
      decisionReasonCodes: [],
      decidedAt: null,
    };
  }
}
