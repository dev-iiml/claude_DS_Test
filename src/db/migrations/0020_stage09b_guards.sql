-- 0020 — Stage 09b guards and backfill.
CREATE TRIGGER cashflow_sessions_set_updated_at BEFORE UPDATE ON fin.cashflow_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER cashflow_accounts_set_updated_at BEFORE UPDATE ON fin.cashflow_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
-- AA line items and vendor analytics are immutable; deletable only in an erasure transaction
-- (check erasure, or the data-life purge).
CREATE TRIGGER fi_transactions_append_only BEFORE UPDATE OR DELETE ON fin.fi_transactions
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
CREATE TRIGGER fi_vendor_analytics_append_only BEFORE UPDATE OR DELETE ON fin.fi_vendor_analytics
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
-- Existing checks: the single purpose becomes the first (primary) of `purposes`.
UPDATE fin.credit_applications SET purposes = ARRAY[purpose]
WHERE purpose IS NOT NULL AND cardinality(purposes) = 0 AND inputs_erased_at IS NULL;
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA fin FROM %I', r);
    END IF;
  END LOOP;
END;
$$;
