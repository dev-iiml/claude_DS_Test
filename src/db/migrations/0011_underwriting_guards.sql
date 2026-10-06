-- 0011 — underwriting runs are immutable (reproducibility); erasable only inside an erasure transaction.
CREATE TRIGGER underwriting_runs_append_only BEFORE UPDATE OR DELETE ON fin.underwriting_runs
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
CREATE TRIGGER underwriting_inputs_append_only BEFORE UPDATE OR DELETE ON fin.underwriting_inputs
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
CREATE TRIGGER underwriting_results_append_only BEFORE UPDATE OR DELETE ON fin.underwriting_results
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
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
