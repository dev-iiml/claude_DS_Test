import type { Provider } from "../types";
import type { Offer } from "./offer";
import type { ProposalDataGroup, ProposalPayload } from "./proposal";
import type { SimulatedLenderPolicy } from "./simulated-policy";

/**
 * Regulated entity (bank/NBFC) integration. CreatorCo submits a credit
 * proposal; the RE applies its approved credit policy and owns the sanction
 * decision.
 */
export interface CreditProposal {
  proposalId: string;
  payload: ProposalPayload;
  /**
   * Simulated lenders only: the pilot's simulated credit policy and its
   * version. Real lender adapters ignore it and never send it.
   */
  simulation?: { policy: SimulatedLenderPolicy; policyVersion: number };
}

export interface LenderDecision {
  proposalId: string;
  lenderReference: string;
  /** `pending`: the lender hasn't decided yet (poll again later). */
  outcome: "approved" | "modified" | "declined" | "pending";
  approvedExposure: number | null; // INR
  approvedTenorMonths: number | null;
  /** Which CreatorCo model the lender based its decision on, if it says. */
  decisionBasis: "traditional" | "creator_enhanced" | null;
  /** The simulated policy version applied (simulated lenders only). */
  policyVersion: number | null;
  decisionReasonCodes: string[];
  decidedAt: Date | null;
  /** Stage 13: the offer (terms + KFS, and how long it stands). Required unless declined or pending. */
  offer?: Offer | null;
}

export interface LenderProvider extends Provider {
  /** Synchronous: the data groups this partnership's proposals carry (from the lender config). */
  proposalProfile(): readonly ProposalDataGroup[];
  /**
   * Synchronous, optional: `push` when decisions arrive through the partner
   * API (Stage 12b) rather than by polling `getDecision`. Default `poll`.
   */
  decisionDelivery?(): "poll" | "push";
  submitProposal(proposal: CreditProposal): Promise<{ lenderReference: string }>;
  getDecision(lenderReference: string, proposal: CreditProposal): Promise<LenderDecision>;
}
