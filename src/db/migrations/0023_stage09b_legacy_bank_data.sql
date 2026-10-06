-- 0023 — open checks that received bank data before Stage 09b have monthly totals but no shared-account rows,
-- so the creator couldn't answer the coverage question or skip. They share again under the new flow.
DELETE FROM fin.cashflow_months m
USING fin.credit_applications a
WHERE m.application_id = a.id
  AND a.status IN ('draft', 'inputs_ready')
  AND a.cashflow_status = 'completed'
  AND NOT EXISTS (SELECT 1 FROM fin.cashflow_accounts c WHERE c.application_id = a.id);
--> statement-breakpoint
UPDATE fin.credit_applications a
SET status = 'draft', inputs_ready_at = NULL, cashflow_status = 'not_started', cashflow_coverage = NULL
WHERE a.status IN ('draft', 'inputs_ready')
  AND a.cashflow_status = 'completed'
  AND NOT EXISTS (SELECT 1 FROM fin.cashflow_accounts c WHERE c.application_id = a.id);
