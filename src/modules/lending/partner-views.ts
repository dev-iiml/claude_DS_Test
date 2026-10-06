import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  consentReceipts,
  creatorProfiles,
  creditApplications,
  creditProposals,
  decisionQueries,
  decisionReviews,
  lenderDecisions,
  offerResponses,
  users,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import type { ProposalPayload } from "@/providers/lender/proposal";

/**
 * What a partner lender sees through the partner API (Stage 12b): only
 * proposals sent to the lender config it serves, only once they're sent, and
 * exactly the frozen payload the creator's consent covered. Never staff
 * identities, never the simulated policy.
 */

export const PARTNER_PROPOSAL_STATUSES = ["awaiting_decision", "query_open", "decided", "confirmed"] as const;
export type PartnerProposalStatus = (typeof PARTNER_PROPOSAL_STATUSES)[number];

const SENT = ["submitted", "decided"] as const;

/** Fully qualified on purpose: Drizzle leaves columns unqualified in single-table select lists, and inside these
 * subqueries a bare "id" would resolve to the subquery's own table. */
const PROPOSAL_ID = sql.raw(`"fin"."credit_proposals"."id"`);
const PROPOSAL_STATUS = sql.raw(`"fin"."credit_proposals"."status"`);

const statusSql = sql<PartnerProposalStatus>`case
  when ${PROPOSAL_STATUS} = 'submitted' then 'awaiting_decision'
  when exists (select 1 from fin.decision_queries q where q.proposal_id = ${PROPOSAL_ID} and q.resolved_at is null)
    then 'query_open'
  when exists (select 1 from fin.decision_reviews r where r.proposal_id = ${PROPOSAL_ID}) then 'confirmed'
  else 'decided' end`;

export interface PartnerProposalSummary {
  id: string;
  status: PartnerProposalStatus;
  submittedAt: string;
  payloadHash: string;
}

const encodeCursor = (submittedAt: Date, id: string) =>
  Buffer.from(`${submittedAt.toISOString()}|${id}`).toString("base64url");
function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at, id };
}

/** Oldest first by submission time, keyset-paginated. Identifiers and status only — no payload. */
export async function listPartnerProposals(
  db: DbExecutor,
  input: { lenderKey: string; status?: PartnerProposalStatus; cursor?: string; limit?: number },
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const cursor = decodeCursor(input.cursor);
  const rows = await db
    .select({
      id: creditProposals.id,
      submittedAt: creditProposals.submittedAt,
      payloadHash: creditProposals.payloadHash,
      status: statusSql,
    })
    .from(creditProposals)
    .where(
      and(
        eq(creditProposals.lender, input.lenderKey),
        inArray(creditProposals.status, [...SENT]),
        isNull(creditProposals.policyVersion), // never a simulated-lender proposal
        input.status ? sql`${statusSql} = ${input.status}` : undefined,
        cursor
          ? sql`(${creditProposals.submittedAt}, ${creditProposals.id}) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(creditProposals.submittedAt), asc(creditProposals.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    data: page.map((r): PartnerProposalSummary => ({
      id: r.id,
      status: r.status,
      submittedAt: r.submittedAt!.toISOString(),
      payloadHash: r.payloadHash,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(new Date(last.submittedAt!), last.id) : null,
  };
}

/** One proposal for its partner, with its decisions and queries. Audited (a partner read the financial payload). */
export async function getPartnerProposal(
  db: DbExecutor,
  input: { lenderKey: string; proposalId: string; apiKeyId: string },
) {
  const [p] = await db
    .select({ p: creditProposals, status: statusSql })
    .from(creditProposals)
    .where(
      and(
        eq(creditProposals.id, input.proposalId),
        eq(creditProposals.lender, input.lenderKey),
        inArray(creditProposals.status, [...SENT]),
        isNull(creditProposals.policyVersion), // never a simulated-lender proposal
      ),
    )
    .limit(1);
  if (!p) return null;
  const decisions = await db
    .select()
    .from(lenderDecisions)
    .where(eq(lenderDecisions.proposalId, p.p.id))
    .orderBy(asc(lenderDecisions.revision));
  const queries = await db
    .select()
    .from(decisionQueries)
    .where(eq(decisionQueries.proposalId, p.p.id))
    .orderBy(asc(decisionQueries.createdAt));
  const [review] = await db
    .select({
      createdAt: decisionReviews.createdAt,
      decisionId: decisionReviews.decisionId,
      finalOfferExpiresAt: decisionReviews.finalOfferExpiresAt,
    })
    .from(decisionReviews)
    .where(eq(decisionReviews.proposalId, p.p.id))
    .limit(1);
  const [response] = await db
    .select({ r: offerResponses, receiptStatus: consentReceipts.status })
    .from(offerResponses)
    .leftJoin(consentReceipts, eq(consentReceipts.id, offerResponses.handoffReceiptId))
    .where(eq(offerResponses.proposalId, p.p.id))
    .limit(1);
  // Applicant details only for an acceptance whose "Continue with the partner lender" consent still stands.
  const applicant =
    response?.r.response === "accepted" && response.receiptStatus === "granted"
      ? await applicantFor(db, p.p.applicationId)
      : null;
  await recordAuditEvent(db, {
    actorType: "partner",
    actorId: input.apiKeyId,
    eventType: "lending.proposal_fetched",
    entityType: "credit_proposal",
    entityId: p.p.id,
    metadata: applicant ? { applicant: true } : {},
  });
  const revisionOf = new Map(decisions.map((d) => [d.id, d.revision]));
  return {
    id: p.p.id,
    status: p.status,
    submittedAt: p.p.submittedAt!.toISOString(),
    reference: p.p.lenderReference,
    payloadHash: p.p.payloadHash,
    payload: p.p.payload as unknown as ProposalPayload,
    decisions: decisions.map((d) => ({
      revision: d.revision,
      outcome: d.outcome,
      approvedExposure: d.approvedExposure,
      approvedTenorMonths: d.approvedTenorMonths,
      decisionBasis: d.decisionBasis,
      reasonCodes: d.reasonCodes,
      lenderReference: d.lenderReference,
      decidedAt: d.decidedAt.toISOString(),
      receivedAt: d.receivedAt.toISOString(),
      offer:
        d.offerTerms && d.offerExpiresAt ? { expiresAt: d.offerExpiresAt.toISOString(), terms: d.offerTerms } : null,
    })),
    queries: queries.map((q) => ({
      id: q.id,
      onRevision: revisionOf.get(q.decisionId) ?? null,
      message: q.message,
      raisedAt: q.createdAt.toISOString(),
      answeredByRevision: q.resolvedDecisionId ? (revisionOf.get(q.resolvedDecisionId) ?? null) : null,
      /** Withdrawn by CreatorCo without an answer (the reason stays internal). */
      withdrawnAt: q.withdrawnBy && q.resolvedAt ? q.resolvedAt.toISOString() : null,
    })),
    confirmation: review
      ? {
          revision: revisionOf.get(review.decisionId) ?? null,
          confirmedAt: review.createdAt.toISOString(),
          offerExpiresAt: review.finalOfferExpiresAt?.toISOString() ?? null,
        }
      : null,
    /** Stage 13: the creator's answer to the confirmed offer. */
    offerResponse: response
      ? {
          response: response.r.response,
          respondedAt: response.r.respondedAt.toISOString(),
          termsHash: response.r.termsHash,
          declineReason: response.r.declineReason,
        }
      : null,
    applicant,
  };
}

/** Who to contact after an acceptance: legal name, email, and the mobile only if OTP-verified. */
async function applicantFor(db: DbExecutor, applicationId: string) {
  const [row] = await db
    .select({
      legalName: creatorProfiles.legalName,
      email: users.email,
      mobile: users.mobile,
      mobileVerifiedAt: users.mobileVerifiedAt,
    })
    .from(creditApplications)
    .innerJoin(users, eq(users.id, creditApplications.userId))
    .leftJoin(creatorProfiles, eq(creatorProfiles.userId, users.id))
    .where(eq(creditApplications.id, applicationId))
    .limit(1);
  if (!row) return null;
  return {
    legalName: row.legalName,
    email: row.email,
    mobile: row.mobileVerifiedAt ? row.mobile : null,
  };
}
