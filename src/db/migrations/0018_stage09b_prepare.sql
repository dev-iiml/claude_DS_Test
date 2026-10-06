-- 0018 — Stage 09b data preparation (runs before the schema change).
-- A check waiting at the Account Aggregator under the old single-reference flow starts sharing again
-- (its reference moves to fin.cashflow_sessions, which old references were never written to).
UPDATE fin.credit_applications
SET cashflow_status = 'not_started', cashflow_reference = NULL, cashflow_provider = NULL
WHERE cashflow_status = 'pending';
--> statement-breakpoint
-- Confirmation is now explicit and needs bank data received or skipped; a declined share goes back to review.
UPDATE fin.credit_applications
SET status = 'draft', inputs_ready_at = NULL
WHERE status = 'inputs_ready' AND cashflow_status NOT IN ('completed', 'skipped');
