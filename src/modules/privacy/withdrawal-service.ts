import { and, desc, eq } from "drizzle-orm";

import type { Database } from "@/db/create-db";
import {
  consentDefinitions,
  consentReceipts,
  consentWithdrawals,
  creatorProfiles,
  dataErasureRequests,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit";
import { CONSENT_KEYS, grantConsent, hasValidConsent, withdrawConsent } from "@/modules/consent";
import type { ConsentKey, ConsentSource, ErasureScope, WithdrawalReason } from "@/modules/consent/domain";
import { pauseMembership, resumeMembership } from "@/modules/creator-profile/membership";
import { closeOpenApplications } from "@/modules/financial-eligibility/application-service";
import { cancelPendingAccessRequests, eraseAccessRequests } from "@/modules/access";
import { eraseFinancialFunnelEvents, eraseOptionalEvents } from "@/modules/analytics/recorder";
import { eraseFinancialInputs } from "@/modules/financial-eligibility/erasure";
import { eraseUnderwritingRuns } from "@/modules/underwriting/erasure";
import { withdrawUnsentProposals } from "@/modules/lending/proposal-service";
import { eraseIdentityLookups } from "@/modules/identity/identity-erasure";
import { eraseProfessionalGraph } from "@/modules/professional-graph/erasure";
import { runProfessionalGraph } from "@/modules/professional-graph/graph-service";
import { disconnectAllAccounts, eraseSocialAccountData } from "@/modules/social-data/erasure";

import { purposeFor } from "./purposes";
import { lendingRetentionHolds, type RetentionHoldChecker } from "./retention-holds";

/**
 * Consent centre orchestration (Stage 08). The consent module owns receipts;
 * this module applies what a grant or withdrawal *means* across domains:
 * stop processing at once, then erase — unless a retention hold (e.g. an open
 * credit relationship with a partner lender) defers erasure.
 */

export class PrivacyError extends Error {
  constructor(
    readonly code: "unknown_purpose" | "not_granted" | "profile_required" | "not_found",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PrivacyError";
  }
}

export interface PrivacyDeps {
  db: Database;
  holds?: RetentionHoldChecker;
  now?: Date;
}

export interface WithdrawalResult {
  withdrawalId: string;
  effects: Record<string, string | number | boolean>;
  erasures: { scope: ErasureScope; status: "completed" | "deferred"; holdReasons: string[] }[];
  graphRecomputed: boolean;
}

async function profileFor(db: DbExecutor, userId: string) {
  const [p] = await db
    .select({ id: creatorProfiles.id, status: creatorProfiles.profileStatus })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId))
    .limit(1);
  return p ?? null;
}

async function erase(
  tx: DbExecutor,
  scope: ErasureScope,
  ids: { userId: string; creatorId: string | null },
  before?: Date,
  /** Sent checks whose lender relationship has closed (erasable despite having been sent). */
  released: string[] = [],
) {
  switch (scope) {
    case "identity_lookup":
      // Unsent recommendations hold fraud-check values derived from the lookup (name match), so they go too.
      return {
        ...(await eraseIdentityLookups(tx, { userId: ids.userId, before })),
        ...(await eraseUnderwritingRuns(tx, { userId: ids.userId })),
      };
    case "social_account_data": {
      // Same for connected-account fraud checks (handle mismatches, tenure).
      const underwriting = await eraseUnderwritingRuns(tx, { userId: ids.userId });
      return ids.creatorId
        ? { ...(await eraseSocialAccountData(tx, { creatorId: ids.creatorId, before })), ...underwriting }
        : underwriting;
    }
    case "professional_graph": {
      // Recommendations embed copies of the signals, so unsent ones go too.
      const underwriting = await eraseUnderwritingRuns(tx, { userId: ids.userId });
      return ids.creatorId
        ? { ...(await eraseProfessionalGraph(tx, { creatorId: ids.creatorId, before })), ...underwriting }
        : underwriting;
    }
    case "financial_inputs":
      return eraseFinancialInputs(tx, { userId: ids.userId, before, now: new Date(), releasedSubmitted: released });
    case "access_requests":
      return eraseAccessRequests(tx, { userId: ids.userId, before });
    case "product_analytics_events":
      return eraseOptionalEvents(tx, { userId: ids.userId, before });
    case "financial_funnel_events":
      return eraseFinancialFunnelEvents(tx, { userId: ids.userId, before });
  }
}

/**
 * Whether the unheld part of a scope can be erased while a hold remains. Only
 * per-check holds allow it: financial inputs, where the checker names the
 * released checks and erasure itself skips checks still with a lender. Any
 * other hold covers the whole scope, so nothing is erased until it lifts.
 */
function erasesAroundHolds(holds: RetentionHoldChecker, scope: ErasureScope): boolean {
  return scope === "financial_inputs" && typeof holds.releasedApplications === "function";
}

/**
 * Withdraws every granted receipt for a purpose (any version), applies its
 * effects and records an append-only withdrawal with small effect counts.
 */
export async function withdrawPurpose(
  deps: PrivacyDeps,
  input: { userId: string; key: string; reason?: WithdrawalReason | null; source: ConsentSource },
): Promise<WithdrawalResult> {
  const policy = purposeFor(input.key);
  if (!policy) throw new PrivacyError("unknown_purpose");
  const now = deps.now ?? new Date();
  const holds = deps.holds ?? lendingRetentionHolds;

  const result = await deps.db.transaction(async (tx) => {
    const granted = await tx
      .select({ id: consentReceipts.id, version: consentDefinitions.version })
      .from(consentReceipts)
      .innerJoin(consentDefinitions, eq(consentDefinitions.id, consentReceipts.consentDefinitionId))
      .where(
        and(
          eq(consentReceipts.userId, input.userId),
          eq(consentDefinitions.key, policy.key),
          eq(consentReceipts.status, "granted"),
        ),
      )
      .orderBy(desc(consentDefinitions.version))
      // Lock the receipts before applying effects: an action that holds a receipt (an Access request, an
      // offer acceptance) either commits first — and is then undone by the effects below — or sees it withdrawn.
      .for("update", { of: consentReceipts });
    if (!granted.length) throw new PrivacyError("not_granted");

    const profile = await profileFor(tx, input.userId);
    const effects: Record<string, string | number | boolean> = {};

    // 1. Stop processing immediately.
    if (policy.core) effects.membership_paused = await pauseMembership(tx, { userId: input.userId, now });
    if (policy.key === CONSENT_KEYS.socialAccountConnection && profile) {
      effects.accounts_disconnected = await disconnectAllAccounts(tx, { creatorId: profile.id, now });
    }
    if (policy.key === CONSENT_KEYS.financialEligibility) {
      effects.checks_closed = await closeOpenApplications(tx, { userId: input.userId, now });
    }
    if (policy.key === CONSENT_KEYS.lenderSharing) {
      effects.proposals_cancelled = await withdrawUnsentProposals(tx, { userId: input.userId });
    }
    if (policy.key === CONSENT_KEYS.brandOpportunities || policy.core) {
      // Brand consent withdrawn, or membership paused: pending Access requests are cancelled, points returned.
      effects.access_requests_cancelled = await cancelPendingAccessRequests(tx, { userId: input.userId, now });
    }

    // 2. Withdraw the receipts and record the withdrawal (effects on the newest).
    let withdrawalId = "";
    for (const [i, receipt] of granted.entries()) {
      await withdrawConsent(tx, { userId: input.userId, receiptId: receipt.id, now });
      const [row] = await tx
        .insert(consentWithdrawals)
        .values({
          receiptId: receipt.id,
          userId: input.userId,
          consentKey: policy.key,
          definitionVersion: receipt.version,
          source: input.source,
          reason: input.reason ?? null,
          effects: i === 0 ? effects : {},
          withdrawnAt: now,
        })
        .returning({ id: consentWithdrawals.id });
      if (i === 0) withdrawalId = row!.id;
    }

    // 3. Erase now everything no retention hold covers; what a hold covers is deferred until it lifts.
    const erasures: WithdrawalResult["erasures"] = [];
    for (const scope of policy.erasure) {
      const holdReasons = await holds.holdsFor(tx, { userId: input.userId, scope, now });
      const released = (await holds.releasedApplications?.(tx, { userId: input.userId, scope, now })) ?? [];
      const erased =
        holdReasons.length && !erasesAroundHolds(holds, scope)
          ? {}
          : await erase(tx, scope, { userId: input.userId, creatorId: profile?.id ?? null }, undefined, released);
      if (holdReasons.length) {
        await tx.insert(dataErasureRequests).values({
          userId: input.userId,
          withdrawalId,
          scope,
          status: "deferred",
          holdReasons,
          erased,
          requestedAt: now,
        });
        await recordAuditEvent(tx, {
          actorType: "system",
          eventType: "privacy.erasure_deferred",
          entityType: "consent_withdrawal",
          entityId: withdrawalId,
          metadata: { scope, holds: holdReasons.length, ...erased },
        });
        erasures.push({ scope, status: "deferred", holdReasons });
        continue;
      }
      await tx.insert(dataErasureRequests).values({
        userId: input.userId,
        withdrawalId,
        scope,
        status: "completed",
        erased,
        requestedAt: now,
        completedAt: now,
      });
      await recordAuditEvent(tx, {
        actorType: "system",
        eventType: "privacy.erasure_completed",
        entityType: "consent_withdrawal",
        entityId: withdrawalId,
        metadata: { scope, ...erased },
      });
      erasures.push({ scope, status: "completed", holdReasons: [] });
    }
    return { withdrawalId, effects, erasures, profile };
  });

  // Signals computed from withdrawn social data are rebuilt from what remains.
  let graphRecomputed = false;
  if (
    policy.key === CONSENT_KEYS.socialAccountConnection &&
    result.profile?.status === "completed" &&
    (await hasValidConsent(deps.db, input.userId, CONSENT_KEYS.professionalAnalytics, now))
  ) {
    const run = await runProfessionalGraph(deps.db, {
      userId: input.userId,
      creatorId: result.profile.id,
      trigger: "system",
      now,
    });
    graphRecomputed = run.ok;
  }

  return { withdrawalId: result.withdrawalId, effects: result.effects, erasures: result.erasures, graphRecomputed };
}

/**
 * Grants (or re-grants) a purpose from the consent centre. Re-granting the
 * Creator Profile consent resumes a paused membership; turning signals on
 * computes them straight away.
 */
export async function grantPurpose(
  deps: PrivacyDeps,
  input: { userId: string; key: string; consentDefinitionId: string; source: ConsentSource },
) {
  const policy = purposeFor(input.key);
  if (!policy) throw new PrivacyError("unknown_purpose");
  const now = deps.now ?? new Date();
  const profile = await profileFor(deps.db, input.userId);
  // Draft creators give consents inside onboarding, not from the consent centre.
  if (!profile || (profile.status !== "completed" && profile.status !== "paused")) {
    throw new PrivacyError("profile_required");
  }

  const receipt = await deps.db.transaction(async (tx) => {
    const r = await grantConsent(tx, {
      userId: input.userId,
      key: policy.key as ConsentKey,
      consentDefinitionId: input.consentDefinitionId,
      source: input.source,
      metadata: { surface: "consent_centre" },
      now,
    });
    if (policy.core) await resumeMembership(tx, { userId: input.userId });
    return r;
  });

  if (policy.key === CONSENT_KEYS.professionalAnalytics && profile.status === "completed") {
    await runProfessionalGraph(deps.db, { userId: input.userId, creatorId: profile.id, trigger: "manual", now });
  }
  return receipt;
}

/**
 * Completes deferred erasures whose retention holds have lifted. Only data
 * stored before the original request is erased (later data was collected
 * under a fresh consent). Intended for a scheduled job.
 */
export async function processDeferredErasures(deps: PrivacyDeps): Promise<{ checked: number; completed: number }> {
  const holds = deps.holds ?? lendingRetentionHolds;
  const now = deps.now ?? new Date();
  const pending = await deps.db.select().from(dataErasureRequests).where(eq(dataErasureRequests.status, "deferred"));
  let completed = 0;
  for (const req of pending) {
    // Each pass erases what has been released since (e.g. an offer declined or expired); the request
    // completes once nothing is held any more. Only data stored before the request is erased.
    const done = await deps.db.transaction(async (tx) => {
      const holdReasons = await holds.holdsFor(tx, { userId: req.userId, scope: req.scope, now });
      const released = (await holds.releasedApplications?.(tx, { userId: req.userId, scope: req.scope, now })) ?? [];
      if (holdReasons.length && !erasesAroundHolds(holds, req.scope)) return false;
      const profile = await profileFor(tx, req.userId);
      const erased = await erase(
        tx,
        req.scope,
        { userId: req.userId, creatorId: profile?.id ?? null },
        req.createdAt,
        released,
      );
      if (holdReasons.length) {
        if (Number((erased as Record<string, number>).applications ?? 0) > 0) {
          await recordAuditEvent(tx, {
            actorType: "system",
            eventType: "privacy.erasure_partial",
            entityType: "consent_withdrawal",
            entityId: req.withdrawalId,
            metadata: { scope: req.scope, ...erased },
          });
        }
        return false;
      }
      await tx
        .update(dataErasureRequests)
        .set({ status: "completed", erased, completedAt: now })
        .where(and(eq(dataErasureRequests.id, req.id), eq(dataErasureRequests.status, "deferred")));
      await recordAuditEvent(tx, {
        actorType: "system",
        eventType: "privacy.erasure_completed",
        entityType: "consent_withdrawal",
        entityId: req.withdrawalId,
        metadata: { scope: req.scope, deferred: true, ...erased },
      });
      return true;
    });
    if (done) completed += 1;
  }
  return { checked: pending.length, completed };
}
