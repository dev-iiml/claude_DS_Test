import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink, ListGroup, ListRow, PageHeader, SectionHeading, StatusBadge } from "@/components/creatorco";
import { getDb } from "@/db";
import { recordAuditEvent } from "@/modules/audit";
import { formatInr } from "@/modules/financial-eligibility/presentation";
import { requireAdmin } from "@/modules/identity";
import {
  FRAUD_CHECK_LABELS,
  FRAUD_OUTCOME_LABELS,
  FRAUD_OUTCOME_TONE,
  FRAUD_SEVERITY_TONE,
  formatEvidence,
} from "@/modules/fraud/presentation";
import type { FraudCheckCode, FraudOutcome, FraudSeverity } from "@/modules/fraud/rules";
import { COMPONENTS, ENHANCED_WEIGHTS, UNDERWRITING_MODEL_VERSION } from "@/modules/underwriting/model";
import { getUnderwritingRun, verifyUnderwritingReproducible } from "@/modules/underwriting/underwriting-service";

import { AdminShell } from "../../../_components/creator-shell";

export const metadata: Metadata = { title: "Underwriting run" };

const COMPONENT_LABEL: Record<string, string> = {
  financial_strength: "Financial Strength",
  income_stability: "Income Stability",
  creator_business_stability: "Creator Business Stability",
  revenue_diversification: "Revenue Diversification",
  professional_longevity: "Professional Longevity",
  audience_authenticity: "Audience Authenticity",
  brand_recurrence: "Brand Recurrence",
};
const EFFECT_TONE = { positive: "success", negative: "warning", info: "neutral" } as const;

type Run = NonNullable<Awaited<ReturnType<typeof getUnderwritingRun>>>;
type Result = NonNullable<Run["traditional"]>;

const CHECK_STATUS_LABEL = { passed: "Passed", flagged: "Flagged", not_run: "Not run" } as const;

function FraudSection({ fraud }: { fraud: NonNullable<Run["fraud"]> }) {
  const outcome = fraud.outcome as FraudOutcome;
  const flagged = new Map(fraud.flags.map((f) => [f.code, f]));
  return (
    <section aria-labelledby="fraud-title" className="mb-10 flex flex-col gap-6">
      <div className="flex items-end justify-between gap-3">
        <SectionHeading id="fraud-title">Fraud &amp; authenticity</SectionHeading>
        <StatusBadge tone={FRAUD_OUTCOME_TONE[outcome]}>{FRAUD_OUTCOME_LABELS[outcome]}</StatusBadge>
      </div>
      <ListGroup
        id="fraud-checks"
        footer={`${fraud.rulesVersion} · a separate layer: a high-severity flag routes the recommendation to refer; scores and exposures are unchanged. Never shown to the creator.`}
      >
        {fraud.checks.map((c) => {
          const label = FRAUD_CHECK_LABELS[c.code as FraudCheckCode];
          const flag = flagged.get(c.code);
          return (
            <ListRow
              key={c.code}
              label={label?.title ?? c.code}
              detail={
                flag ? formatEvidence(flag.evidence) : c.status === "not_run" ? "No data for this check" : label?.detail
              }
              accessory={
                flag ? (
                  <StatusBadge tone={FRAUD_SEVERITY_TONE[flag.severity as FraudSeverity]}>{flag.severity}</StatusBadge>
                ) : (
                  <StatusBadge tone={c.status === "passed" ? "success" : "neutral"}>
                    {CHECK_STATUS_LABEL[c.status as keyof typeof CHECK_STATUS_LABEL] ?? c.status}
                  </StatusBadge>
                )
              }
            />
          );
        })}
      </ListGroup>
    </section>
  );
}

function ModelColumn({ title, r }: { title: string; r: Result }) {
  return (
    <section aria-labelledby={`${r.model}-title`} className="flex flex-col gap-6">
      <SectionHeading id={`${r.model}-title`}>{title}</SectionHeading>
      <ListGroup id={`${r.model}-summary`} label="Recommendation">
        <ListRow label="Score" value={r.score ?? "—"} />
        <ListRow label="Risk grade" value={r.grade ?? "—"} />
        <ListRow
          label="Outcome"
          accessory={
            <StatusBadge tone={r.outcome === "recommend" ? "success" : r.outcome === "refer" ? "info" : "neutral"}>
              {r.outcome}
            </StatusBadge>
          }
        />
        <ListRow
          label="Recommended exposure"
          value={r.recommendedExposure !== null ? formatInr(r.recommendedExposure) : "—"}
        />
        <ListRow
          label="Maximum recommended"
          value={r.maxRecommendedExposure !== null ? formatInr(r.maxRecommendedExposure) : "—"}
        />
        <ListRow label="Tenor" value={r.recommendedTenorMonths ? `${r.recommendedTenorMonths} months` : "—"} />
        <ListRow
          label="Income basis"
          value={r.incomeBasis !== null ? formatInr(r.incomeBasis) : "—"}
          detail={
            r.incomeBasisSource === "declared_haircut"
              ? "Declared, with haircut (models before uw-0.3.0)"
              : r.incomeBasisSource
                ? "Verified (bank data)"
                : "No bank-verified income"
          }
        />
        <ListRow
          label="Completeness"
          value={`${Math.round(r.completeness * 100)}%`}
          detail={`${r.confidence} confidence`}
        />
      </ListGroup>
      <ListGroup id={`${r.model}-components`} label="Components (score · weight)">
        {COMPONENTS.filter((c) => c in r.components).map((c) => (
          <ListRow
            key={c}
            label={COMPONENT_LABEL[c]}
            value={
              <span className="tabular-nums">
                {r.components[c] ?? "missing"} · {Math.round(ENHANCED_WEIGHTS[c] * 100)}%
              </span>
            }
          />
        ))}
      </ListGroup>
      <ListGroup id={`${r.model}-reasons`} label="Reason codes">
        {r.reasonCodes.map((rc) => (
          <ListRow
            key={`${rc.code}-${rc.component}`}
            label={<span className="font-mono text-[13px]">{rc.code}</span>}
            detail={rc.component}
            accessory={
              <StatusBadge tone={EFFECT_TONE[rc.effect as keyof typeof EFFECT_TONE] ?? "neutral"}>
                {rc.effect}
              </StatusBadge>
            }
          />
        ))}
      </ListGroup>
    </section>
  );
}

export default async function UnderwritingRunPage({ params }: PageProps<"/admin/underwriting/[runId]">) {
  const admin = await requireAdmin();
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) notFound();
  const db = getDb();
  const run = await getUnderwritingRun(db, runId);
  if (!run || !run.traditional || !run.creatorEnhanced) notFound();
  const reproducible = await verifyUnderwritingReproducible(db, runId);
  // Staff access to a run is audited (CLAUDE.md §25).
  await recordAuditEvent(db, {
    actorType: "user",
    actorId: admin.userId,
    eventType: "risk_console.underwriting_run_viewed",
    entityType: "underwriting_run",
    entityId: run.id,
  });

  return (
    <AdminShell role={admin.role}>
      <BackLink href="/admin/underwriting" label="Underwriting" />
      <PageHeader
        eyebrow={`Check ${run.applicationId.slice(0, 8)} · ${run.modelVersion}`}
        title="Underwriting run"
        action={
          run.modelVersion !== UNDERWRITING_MODEL_VERSION ? (
            <StatusBadge tone="neutral">Earlier model</StatusBadge>
          ) : (
            <StatusBadge tone={reproducible ? "success" : "danger"}>
              {reproducible ? "Reproducible" : "Not reproducible"}
            </StatusBadge>
          )
        }
      />
      {run.fraud ? <FraudSection fraud={run.fraud} /> : null}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <ModelColumn title="Traditional" r={run.traditional} />
        <ModelColumn title="Creator-Enhanced" r={run.creatorEnhanced} />
      </div>
      <ListGroup
        id="inputs"
        label="Frozen inputs"
        footer={`Input hash ${run.inputsHash.slice(0, 16)}… · computed ${run.computedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`}
        className="mt-10"
      >
        {run.inputs.map((i) => (
          <ListRow
            key={i.key}
            label={<span className="font-mono text-[13px]">{i.key}</span>}
            detail={i.origin}
            value={<span className="font-mono text-[13px]">{i.value === null ? "null" : String(i.value)}</span>}
          />
        ))}
      </ListGroup>
    </AdminShell>
  );
}
