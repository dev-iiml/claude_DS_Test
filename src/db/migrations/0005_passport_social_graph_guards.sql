-- 0005 — guards and backfill for passport / social connection / professional graph.
-- Existing self-declared rows: remember the declared handle.
UPDATE public.creator_social_accounts SET declared_handle = handle WHERE provider = 'self_declared' AND declared_handle IS NULL;
--> statement-breakpoint
-- Professional Graph runs and features are immutable once written (reproducibility).
-- Cascaded deletes (pg_trigger_depth() > 0) remain possible when a profile is erased.
CREATE TRIGGER professional_graph_runs_append_only BEFORE UPDATE OR DELETE ON public.professional_graph_runs
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only();
--> statement-breakpoint
CREATE TRIGGER creator_professional_features_append_only BEFORE UPDATE OR DELETE ON public.creator_professional_features
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only();
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA iam FROM %I', r);
    END IF;
  END LOOP;
END;
$$;
