-- 0007 — guards for the consent centre (Stage 08).

-- Withdrawals are an audit trail: append-only.
CREATE TRIGGER consent_withdrawals_append_only BEFORE UPDATE OR DELETE ON public.consent_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.append_only();
--> statement-breakpoint
-- Erasure requests: never deleted; the only change allowed is deferred → completed.
CREATE OR REPLACE FUNCTION public.data_erasure_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'data_erasure_requests rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'deferred' OR NEW.status <> 'completed'
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.withdrawal_id IS DISTINCT FROM OLD.withdrawal_id OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'data_erasure_requests may only move from deferred to completed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER data_erasure_requests_guard BEFORE UPDATE OR DELETE ON public.data_erasure_requests
  FOR EACH ROW EXECUTE FUNCTION public.data_erasure_requests_guard();
--> statement-breakpoint
-- Professional Graph rows stay immutable, but can be erased when the creator
-- withdraws consent. Erasure runs in a transaction that sets
-- `creatorco.erasure = 'on'` (SET LOCAL); updates are never allowed.
CREATE OR REPLACE FUNCTION public.append_only_except_erasure() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('creatorco.erasure', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
DROP TRIGGER professional_graph_runs_append_only ON public.professional_graph_runs;
--> statement-breakpoint
CREATE TRIGGER professional_graph_runs_append_only BEFORE UPDATE OR DELETE ON public.professional_graph_runs
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
DROP TRIGGER creator_professional_features_append_only ON public.creator_professional_features;
--> statement-breakpoint
CREATE TRIGGER creator_professional_features_append_only BEFORE UPDATE OR DELETE ON public.creator_professional_features
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
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
