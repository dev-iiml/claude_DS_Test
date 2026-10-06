-- 0009 — guards for the regulated financial domain (`fin` schema).
CREATE TRIGGER credit_applications_set_updated_at BEFORE UPDATE ON fin.credit_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
-- Financial Capacity runs and features are immutable (reproducibility), erasable only in an erasure transaction.
CREATE TRIGGER financial_feature_runs_append_only BEFORE UPDATE OR DELETE ON fin.financial_feature_runs
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
CREATE TRIGGER financial_features_append_only BEFORE UPDATE OR DELETE ON fin.financial_features
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
-- Applications are tombstoned, never deleted.
CREATE TRIGGER credit_applications_no_delete BEFORE DELETE ON fin.credit_applications
  FOR EACH ROW EXECUTE FUNCTION public.append_only();
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA fin FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA fin FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END;
$$;
