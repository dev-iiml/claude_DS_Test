-- 0032 — Stage 14 guards: Creator Status runs and the Creator Points ledger are append-only (erased only by
-- cascades / erasure transactions); Access requests only leave `requested`, once, and never change otherwise.
CREATE TRIGGER creator_status_runs_append_only BEFORE UPDATE OR DELETE ON public.creator_status_runs
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
CREATE TRIGGER creator_points_ledger_append_only BEFORE UPDATE OR DELETE ON public.creator_points_ledger
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.access_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('creatorco.erasure', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'access_requests are erased only with the brand-opportunities consent' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'requested' THEN
    RAISE EXCEPTION 'access request % is closed (%)', OLD.id, OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'requested'
    OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
    OR NEW.points_held IS DISTINCT FROM OLD.points_held
    OR NEW.tier_at_request IS DISTINCT FROM OLD.tier_at_request
    OR NEW.note IS DISTINCT FROM OLD.note
    OR NEW.consent_receipt_id IS DISTINCT FROM OLD.consent_receipt_id
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'access request % may only move out of requested', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER access_requests_guard BEFORE UPDATE OR DELETE ON public.access_requests
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.access_requests_guard();
--> statement-breakpoint
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER access_opportunities_set_updated_at BEFORE UPDATE ON public.access_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER access_requests_set_updated_at BEFORE UPDATE ON public.access_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
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
