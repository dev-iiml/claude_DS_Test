-- 0030 — Stage 13 guards: offer responses are records (append-only; erased only with their check).
CREATE TRIGGER offer_responses_append_only BEFORE UPDATE OR DELETE ON fin.offer_responses
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
