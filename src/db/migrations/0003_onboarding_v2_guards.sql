-- 0003 — guards for the onboarding v2 tables.
CREATE TRIGGER creator_gst_registrations_set_updated_at BEFORE UPDATE ON public.creator_gst_registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
-- Generic append-only guard (names the table in the error).
CREATE OR REPLACE FUNCTION public.append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
-- provider_requests is an audit trail: append-only.
CREATE TRIGGER provider_requests_no_update_delete BEFORE UPDATE OR DELETE ON public.provider_requests
  FOR EACH ROW EXECUTE FUNCTION public.append_only();
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END;
$$;
