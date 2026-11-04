import type { Metadata } from "next";

import { ListGroup, ListRow, MetricBlock, PageHeader, StatusBadge } from "@/components/creatorco";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { formatInr } from "@/modules/financial-eligibility/presentation";
import { FRAUD_CHECK_LABELS, FRAUD_OUTCOME_LABELS, FRAUD_OUTCOME_TONE } from "@/modules/fraud/presentation";
import type { FraudCheckCode, FraudOutcome } from "@/modules/fraud/rules";
import { requireAdmin } from "@/modules/identity";
import { UNDERWRITING_MODEL_VERSION } from "@/modules/underwriting/model";
import { listUnderwritingRuns, underwritingComparisonStats } from "@/modules/underwriting/underwriting-service";

import { AdminShell } from "../../_components/creator-shell";

export const metadata: Metadata = { title: "Underwriting" };

const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const MODEL_LABEL: Record<string, string> = { traditional: "Traditional", creator_enhanced: "Creator-Enhanced" };

const OUTCOME_LABEL: Record<string, string> = {
  recommend: "Recommend",
  refer: "Refer",
  not_recommended: "Not recommended",
};

export default async function UnderwritingPage() {
  const admin = await requireAdmin();
  const db = getDb();
  const [stats, runs] = await Promise.all([underwritingComparisonStats(db), listUnderwritingRuns(db)]);
  const fraudChecked = (stats.fraud.clear ?? 0) + (stats.fraud.watch ?? 0) + (stats.fraud.review ?? 0);
  const topFlags = [...stats.flagsByCode].sort((a, b) => b.n - a.n).slice(0, 6);

  return (
    <AdminShell role={admin.role}>
      <PageHeader
        eyebrow={`Model ${UNDERWRITING_MODEL_VERSION} · hypothesis`}
        title="Underwriting"
        description="Traditional vs Creator-Enhanced recommendations over the same frozen inputs. Differences are hypotheses to validate with lender outcome data, not evidence of lower risk."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <MetricBlock label="Runs" value={stats.runs} />
          </CardContent>
        </Card>
        {stats.byModel
          .sort((a, b) => a.model.localeCompare(b.model))
          .reverse()
          .map((m) => (
            <Card key={m.model}>
              <CardContent className="p-4">
                <MetricBlock
                  label={MODEL_LABEL[m.model] ?? m.model}
                  value={m.avgScore ?? "—"}
                  hint={`avg score · ${m.n ? Math.round((m.recommended / m.n) * 100) : 0}% recommend · avg ${m.avgExposure !== null ? formatInr(m.avgExposure) : "—"}`}
                />
              </CardContent>
            </Card>
          ))}
        <Card>
          <CardContent className="p-4">
            <MetricBlock
              label="Fraud review rate"
              value={`${fraudChecked ? Math.round(((stats.fraud.review ?? 0) / fraudChecked) * 100) : 0}%`}
              hint={`${stats.fraud.review ?? 0} review · ${stats.fraud.watch ?? 0} watch · ${stats.fraud.clear ?? 0} clear`}
            />
          </CardContent>
        </Card>
      </div>

      <ListGroup
        id="runs"
        label="Recent runs"
        footer="Grades read Traditional → Creator-Enhanced, A (strongest) to E. Pseudonymous: check IDs only. Opening a run is audited."
        className="mt-8"
      >
        {runs.length === 0 ? (
          <ListRow label="No runs yet" />
        ) : (
          runs.map((r) => (
            <ListRow
              key={r.id}
              href={`/admin/underwriting/${r.id}`}
              label={<span className="font-mono text-[14px]">{r.applicationId.slice(0, 8)}</span>}
              detail={[
                utc(r.computedAt),
                r.creatorSignals ? "with creator signals" : "no creator signals",
                r.fraud ? `fraud: ${FRAUD_OUTCOME_LABELS[r.fraud.outcome as FraudOutcome].toLowerCase()}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              value={
                <span className="text-[15px] tabular-nums">
                  {r.traditional?.grade ?? "—"} → {r.creatorEnhanced?.grade ?? "—"}
                </span>
              }
              accessory={
                r.fraud?.outcome === "review" ? (
                  <StatusBadge tone={FRAUD_OUTCOME_TONE.review}>Fraud review</StatusBadge>
                ) : (
                  <StatusBadge
                    tone={
                      r.creatorEnhanced?.outcome === "recommend"
                        ? "success"
                        : r.creatorEnhanced?.outcome === "refer"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {r.creatorEnhanced?.outcome
                      ? (OUTCOME_LABEL[r.creatorEnhanced.outcome] ?? r.creatorEnhanced.outcome)
                      : "—"}
                  </StatusBadge>
                )
              }
            />
          ))
        )}
      </ListGroup>

      <ListGroup
        id="flags"
        label="Fraud flags raised"
        className="mt-8"
        footer="Counts across all stored runs. Thresholds are hypotheses to tune."
      >
        {topFlags.length === 0 ? (
          <ListRow label="No flags yet" />
        ) : (
          topFlags.map((f) => (
            <ListRow
              key={`${f.code}-${f.severity}`}
              label={FRAUD_CHECK_LABELS[f.code as FraudCheckCode]?.title ?? f.code}
              detail={`${f.severity.charAt(0).toUpperCase()}${f.severity.slice(1)} severity`}
              value={<span className="tabular-nums">{f.n}</span>}
            />
          ))
        )}
      </ListGroup>
    </AdminShell>
  );
}
