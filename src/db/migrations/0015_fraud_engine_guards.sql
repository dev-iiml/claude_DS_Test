-- 0015 — fraud checks are immutable (reproducibility); erasable only inside an erasure transaction.
CREATE TRIGGER fraud_checks_append_only BEFORE UPDATE OR DELETE ON fin.fraud_checks
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
CREATE TRIGGER fraud_flags_append_only BEFORE UPDATE OR DELETE ON fin.fraud_flags
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
