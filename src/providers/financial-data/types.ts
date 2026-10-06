import type { Provider } from "../types";

/**
 * Financial data via an Account Aggregator (AA) under an eligible FIU / the
 * partner RE (Stage 09b). One `requestConsent` = one AA journey for one
 * mobile number (the AA's handle); the creator verifies it by OTP at the AA,
 * picks the discovered accounts to share and approves. `fetchData` then
 * returns what each selected account delivered.
 *
 * What the live integration needs (documented in the module README):
 * multi-account selection, in-journey additional-number verification where
 * the AA supports it, per-account FI status, a data-life in the consent, and
 * a new data session for retries.
 */

export interface FinancialDataCapabilities {
  /** The creator can pick several discovered accounts in one consent. */
  multiAccountSelection: boolean;
  /** The AA can OTP-verify and search an additional mobile number inside its own journey. */
  additionalNumberInJourney: boolean;
  /** Line items are returned (not only summaries). */
  returnsTransactions: boolean;
  /** Most mobile numbers CreatorCo should let a creator search for one check. */
  maxMobileNumbers: number;
}

export type FiTransactionMode = "upi" | "neft" | "imps" | "rtgs" | "cash" | "card" | "cheque" | "other";

export interface FiTransaction {
  /** Provider's transaction id (opaque). */
  txnRef: string;
  bookedOn: string; // YYYY-MM-DD
  /** INR, positive; `direction` gives the sign. */
  amount: number;
  direction: "credit" | "debit";
  mode: FiTransactionMode;
  narration: string;
  counterparty: string | null;
}

export type SharedAccountStatus = "delivered" | "pending" | "timeout" | "denied" | "failed";

export interface SharedAccount {
  /** Provider's account link reference (opaque, stable for the account at this AA). */
  accountRef: string;
  /** As the bank masks it, e.g. XXXXXX4821. */
  maskedNumber: string;
  /** Bank (FIP) display name. */
  institution: string;
  accountType: "savings" | "current" | "overdraft" | "other";
  /** Last four digits of the mobile number the AA discovered this account through. */
  discoveredViaLast4: string;
  status: SharedAccountStatus;
  /** Statement period actually delivered (YYYY-MM-DD), when delivered. */
  periodFrom: string | null;
  periodTo: string | null;
  transactions: FiTransaction[] | null;
  /** The AA/FIU vendor's own derived analytics for the account, if offered. */
  analytics: Record<string, unknown> | null;
}

export type FiSessionOutcome = "completed" | "partial" | "failed";

export interface FinancialDataResult {
  reference: string;
  /** completed: every selected account delivered · partial: some did · failed: none did. */
  status: FiSessionOutcome;
  accounts: SharedAccount[];
  retrievedAt: Date;
  /** When the consent's data-life ends; stored line items must be purged by then. */
  dataLifeUntil: Date;
}

/** What the AA's redirect back to CreatorCo says (vendor parameters mapped by the adapter). */
export interface AggregatorReturn {
  reference: string | null;
  outcome: "approved" | "rejected" | "no_accounts" | "failed";
}

export interface FinancialDataProvider extends Provider {
  /** Synchronous: what this aggregator supports. */
  capabilities(): FinancialDataCapabilities;
  /** Synchronous: reads the aggregator's redirect parameters. */
  interpretReturn(params: Record<string, string>): AggregatorReturn;
  /** Starts an AA journey for one mobile number; the creator approves at the AA and is redirected back. */
  requestConsent(input: {
    subjectRef: string;
    consentReceiptId: string;
    /**
     * 10-digit mobile used as the AA handle. Passed through, never stored by
     * CreatorCo. Absent on a retry: the adapter reuses `retryOf`'s consent/handle.
     */
    mobile?: string;
    monthsRequested: number;
    dataLifeDays: number;
    redirectUri: string;
    asOf: Date;
    /** Retrying an earlier session (same number): the adapter reuses its consent or handle. */
    retryOf?: string;
  }): Promise<{ reference: string; redirectUrl: string }>;
  /** Fetches the selected accounts' data once the creator approved. */
  fetchData(input: { reference: string; params: Record<string, string>; asOf: Date }): Promise<FinancialDataResult>;
}
