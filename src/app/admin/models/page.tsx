import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { CASHFLOW_ANALYSIS_VERSION, OWN_TRANSFER_WINDOW_DAYS } from "@/modules/financial-eligibility/cashflow-analysis";
import { FIN_ENGINE_VERSION, FIN_FEATURE_VERSIONS } from "@/modules/financial-eligibility/financial-features";
import { formatInr } from "@/modules/financial-eligibility/presentation";
import { FRAUD_CHECK_LABELS } from "@/modules/fraud/presentation";
import {
  BRAND_WORK_FLAGS,
  BRAND_WORK_FLAG_LABELS,
  BRAND_WORK_RULES_VERSION,
  RULE_SETTINGS,
} from "@/modules/brand-work/rules";
import {
  PAYMENT_MATCH_RULES_VERSION,
  PAYMENT_MATCH_SETTINGS,
} from "@/modules/financial-eligibility/payment-match-rules";
import { EARN_GUIDE } from "@/modules/rewards/presentation";
import { POINTS_RULES_VERSION, TASK_POINTS_MAX, TASK_POINTS_MIN } from "@/modules/rewards/rules";
import { FRAUD_CHECK_CODES, FRAUD_RULES_VERSION, FRAUD_THRESHOLDS } from "@/modules/fraud/rules";
import { requireAdmin } from "@/modules/identity";
import { getActivePolicy, listPolicies } from "@/modules/lending";
import {
  COMPONENTS,
  ENHANCED_WEIGHTS,
  POLICY,
  TRADITIONAL_COMPONENTS,
  UNDERWRITING_MODEL_VERSION,
} from "@/modules/underwriting/model";
import { simulatedPolicySchema, type SimulatedLenderPolicy } from "@/providers/lender/simulated-policy";

import { AdminShell } from "../../_components/creator-shell";
import { decidePolicyAction } from "./actions";
import { PolicyForm } from "./policy-form";

export const metadata: Metadata = { title: "Models & rules" };

const utc = (d: Date | null) => (d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—");
const label = (s: string) => s.replace(/_/g, " ");

function PolicyRows({ rules }: { rules: SimulatedLenderPolicy }) {
  return (
    <>
      <ListRow
        label="Decision basis"
        value={rules.decisionBasis === "traditional" ? "Traditional" : "Creator-Enhanced"}
      />
      <ListRow label="Worst grade accepted" value={rules.minGrade} />
      <ListRow label="Maximum amount" value={formatInr(rules.maxExposure)} />
      <ListRow label="Maximum tenor" value={`${rules.maxTenorMonths} months`} />
      <ListRow label="Missed payments allowed (12 months)" value={String(rules.maxDelinquencies12m)} />
      <ListRow label="Least bank coverage" value={rules.minBankCoverage} />
      <ListRow label="Least model completeness" value={`${Math.round(rules.minCompleteness * 100)}%`} />
      <ListRow
        label="Illustrative rate by grade (p.a.)"
        detail="Simulated pilot pricing — not a recommendation and not any lender's rates."
        value={(["A", "B", "C", "D", "E"] as const)
          .map((g) => `${g} ${rules.pricing.annualRatePctByGrade[g]}%`)
          .join(" · ")}
      />
      <ListRow
        label="Processing fee · offer validity · cooling-off"
        value={`${rules.pricing.processingFeePct}% · ${rules.pricing.offerValidDays} days · ${rules.pricing.coolingOffDays} days`}
      />
    </>
  );
}

export default async function ModelsPage() {
  const admin = await requireAdmin();
  const db = getDb();
  const [active, policies] = await Promise.all([getActivePolicy(db), listPolicies(db)]);
  const pending = policies.filter((p) => p.status === "proposed");

  return (
    <AdminShell role={admin.role}>
      <PageHeader
        eyebrow="Internal · engines are read-only · the simulated policy is four-eyes"
        title="Models & rules"
        description="What CreatorCo's engines compute and the simulated partner-lender policy. Engine changes are code releases that bump a version; the simulated policy changes through maker-checker here."
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <ListGroup
            id="uw"
            label={`Underwriting · ${UNDERWRITING_MODEL_VERSION}`}
            footer="Weights are a product hypothesis, not a validated credit model. Traditional uses only the first two components."
          >
            {COMPONENTS.map((c) => (
              <ListRow
                key={c}
                label={label(c)}
                value={`${Math.round(ENHANCED_WEIGHTS[c] * 100)}%`}
                detail={TRADITIONAL_COMPONENTS.includes(c) ? "Traditional + Creator-Enhanced" : "Creator-Enhanced only"}
              />
            ))}
          </ListGroup>
          <ListGroup
            id="uw-policy"
            label="Affordability policy"
            footer="Income basis: bank-verified creator income only."
          >
            <ListRow label="Max EMIs to income" value={`${POLICY.maxTotalEmiToIncome * 100}%`} />
            <ListRow
              label="Reference rate (to size a principal)"
              value={`${POLICY.referenceAnnualRate * 100}% a year`}
            />
            <ListRow label="Tenor" value={`${POLICY.tenorMonths} months`} />
            <ListRow
              label="Grade caps (× monthly income)"
              value={Object.entries(POLICY.gradeIncomeMultiple)
                .map(([g, m]) => `${g} ${m}`)
                .join(" · ")}
            />
            <ListRow label="Refer below completeness" value={`${POLICY.minCompleteness * 100}%`} />
          </ListGroup>
          <ListGroup id="fin" label={`Financial Capacity · ${FIN_ENGINE_VERSION}`}>
            {Object.entries(FIN_FEATURE_VERSIONS).map(([k, v]) => (
              <ListRow key={k} label={<span className="font-mono text-[13px]">{k}</span>} value={`v${v}`} />
            ))}
          </ListGroup>
          <ListGroup
            id="cfa"
            label={`Cashflow analysis · ${CASHFLOW_ANALYSIS_VERSION}`}
            footer="Keyword rules are hypotheses to tune on consented statements."
          >
            <ListRow
              label="Own-account transfers"
              detail={`Equal amount across shared accounts within ${OWN_TRANSFER_WINDOW_DAYS} days, or self-transfer narration. Never income.`}
            />
            <ListRow
              label="Creator income"
              detail="Platform payouts, brand/agency payments, affiliate commissions only. Refunds, reversals and cash deposits excluded."
            />
          </ListGroup>
          <ListGroup
            id="fraud"
            label={`Fraud rules · ${FRAUD_RULES_VERSION}`}
            footer="Never a weighted score: a high flag routes to refer and holds the proposal for release."
          >
            {FRAUD_CHECK_CODES.map((c) => (
              <ListRow key={c} label={FRAUD_CHECK_LABELS[c].title} detail={FRAUD_CHECK_LABELS[c].detail} />
            ))}
            <ListRow
              label="Thresholds"
              detail={Object.entries(FRAUD_THRESHOLDS)
                .map(([k, v]) => `${k} ${v}`)
                .join(" · ")}
            />
          </ListGroup>
          <ListGroup
            id="brand-work-rules"
            label={`Brand-work rules · ${BRAND_WORK_RULES_VERSION}`}
            footer="Flags only — they route a record to a second reviewer and never reject it. Brand work is not an underwriting input."
          >
            {BRAND_WORK_FLAGS.map((f) => (
              <ListRow key={f} label={BRAND_WORK_FLAG_LABELS[f]} />
            ))}
            <ListRow
              label="Bands"
              detail={`₹${RULE_SETTINGS.minPlausiblePaise / 100}–₹${(RULE_SETTINGS.maxPlausiblePaise / 100).toLocaleString("en-IN")} per record · ${RULE_SETTINGS.medianMultiple}× own median after ${RULE_SETTINGS.medianMinRecords} records · ${RULE_SETTINGS.newBrandsThreshold}+ new brands in ${RULE_SETTINGS.newBrandsWindowDays} days`}
            />
          </ListGroup>
          <ListGroup
            id="payment-match-rules"
            label={`Brand payment match · ${PAYMENT_MATCH_RULES_VERSION}`}
            footer="Runs inside the financial domain only when the creator chose it, both consents are on and the /ops switch is on. Only seen / not seen and the month leave it; missing data is “unknown”, never “not seen”."
          >
            <ListRow
              label="Window"
              detail={`Invoice date −${PAYMENT_MATCH_SETTINGS.windowDaysBefore} to +${PAYMENT_MATCH_SETTINGS.windowDaysAfter} days`}
            />
            <ListRow
              label="Amount"
              detail={`${PAYMENT_MATCH_SETTINGS.minShare * 100}–${PAYMENT_MATCH_SETTINGS.maxShare * 100}% of the invoice (net of plausible TDS)`}
            />
            <ListRow
              label="Payer"
              detail="A shared word with the billed party or brand, after removing legal suffixes and transfer codes"
            />
          </ListGroup>
          <ListGroup
            id="points-rules"
            label={`Creator Points · ${POINTS_RULES_VERSION}`}
            footer="Milestones and verified outcomes only. Never for applying for credit or for giving, renewing or keeping a consent; never scaled by money; the same whatever the confirmation method."
          >
            {EARN_GUIDE.flatMap((g) => g.rows).map((r) => (
              <ListRow key={r.label} label={r.label} detail={r.frequency} value={String(r.points)} />
            ))}
            <ListRow
              label="Staff tasks"
              detail={`${TASK_POINTS_MIN}–${TASK_POINTS_MAX} points each, set on the task; four-eyes approval`}
            />
          </ListGroup>
        </div>

        <div className="flex flex-col gap-8">
          <ListGroup
            id="policy-active"
            label={`Simulated lender policy · v${active.version} (active)`}
            footer="Simulated for the pilot. A real partner lender applies its own approved credit policy."
          >
            <PolicyRows rules={active.rules} />
          </ListGroup>

          {pending.map((p) => {
            const rules = simulatedPolicySchema.parse(p.rules);
            const own = p.proposedBy === admin.userId;
            return (
              <ListGroup
                key={p.id}
                id={`policy-${p.version}`}
                label={`Proposed · v${p.version}`}
                action={<StatusBadge tone="warning">Awaiting approval</StatusBadge>}
                footer={
                  own
                    ? "You proposed this version — a different risk admin has to approve or reject it."
                    : `Proposed ${utc(p.proposedAt)}${p.note ? ` · “${p.note}”` : ""}`
                }
              >
                <PolicyRows rules={rules} />
                {own ? null : (
                  <li className="flex gap-3 px-4 py-3">
                    <form action={decidePolicyAction}>
                      <input type="hidden" name="policyId" value={p.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <Button type="submit" size="sm">
                        Approve v{p.version}
                      </Button>
                    </form>
                    <form action={decidePolicyAction}>
                      <input type="hidden" name="policyId" value={p.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <Button type="submit" size="sm" variant="ghost">
                        Reject
                      </Button>
                    </form>
                  </li>
                )}
              </ListGroup>
            );
          })}

          <section aria-labelledby="propose-heading" className="flex flex-col gap-3">
            <h2 id="propose-heading" className="px-1 text-[13px] font-medium tracking-wide text-ink-subtle uppercase">
              Propose a new version
            </h2>
            <PolicyForm current={active.rules} />
          </section>

          <ListGroup id="policy-history" label="History">
            {policies.map((p) => (
              <ListRow
                key={p.id}
                label={`v${p.version}`}
                detail={`${p.status} · proposed ${utc(p.proposedAt)}${p.decidedAt ? ` · decided ${utc(p.decidedAt)}` : ""}${p.note ? ` · ${p.note}` : ""}`}
              />
            ))}
          </ListGroup>
        </div>
      </div>
    </AdminShell>
  );
}
