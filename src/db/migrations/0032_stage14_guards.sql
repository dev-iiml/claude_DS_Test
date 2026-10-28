-- 0032 — Stage 14 guards: Creator Status runs and the points ledger are append-only; an Access request
-- moves out of `requested` exactly once and is otherwise immutable; rows are deleted only by erasure.
CREATE TRIGGER access_opportunities_set_updated_at BEFORE UPDATE ON public.access_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER access_requests_set_updated_at BEFORE UPDATE ON public.access_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
-- Status runs are erased with the Professional Graph run they read (FK cascade, trigger depth > 0)
-- or directly inside an erasure transaction.
CREATE TRIGGER creator_status_runs_append_only BEFORE UPDATE OR DELETE ON public.creator_status_runs
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
-- The ledger is never edited or erased by the application (a hold for an erased request keeps its pairing).
-- Only deleting the creator profile itself cascades here.
CREATE TRIGGER creator_points_ledger_append_only BEFORE UPDATE OR DELETE ON public.creator_points_ledger
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.access_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('creatorco.erasure', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'access_requests rows are deleted only by erasure' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'requested' OR NEW.status = 'requested' THEN
    RAISE EXCEPTION 'an access request moves out of requested exactly once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.opportunity_id <> OLD.opportunity_id
     OR NEW.creator_id <> OLD.creator_id
     OR NEW.user_id <> OLD.user_id
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.points_held <> OLD.points_held
     OR NEW.consent_receipt_id <> OLD.consent_receipt_id
     OR NEW.requested_at <> OLD.requested_at
     OR NEW.expires_at <> OLD.expires_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'only the outcome of an access request can change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER access_requests_guard BEFORE UPDATE OR DELETE ON public.access_requests
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.access_requests_guard();
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
