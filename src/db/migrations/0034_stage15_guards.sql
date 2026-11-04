-- 0034 — Stage 15 guards: raw analytics events are append-only; they are deleted only by the consent erasure
-- (optional events) or the 24-month retention purge, both inside a transaction that sets creatorco.erasure.
CREATE TRIGGER analytics_events_append_only BEFORE UPDATE OR DELETE ON analytics.events
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM %I', r);
      EXECUTE format('REVOKE ALL ON SCHEMA analytics FROM %I', r);
    END IF;
  END LOOP;
END;
$$;
