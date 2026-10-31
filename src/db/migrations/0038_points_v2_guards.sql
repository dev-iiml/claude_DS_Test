-- 0038 — Points v2 guards. Access requests: still only leave `requested` once — except that an APPROVED request may be
-- marked completed once (completed_at / completed_by, nothing else). Task completions are append-only (erased only by
-- cascades with the creator); tasks keep updated_at current.
CREATE OR REPLACE FUNCTION public.access_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('creatorco.erasure', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'access_requests are erased only with the brand-opportunities consent' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'approved' AND OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
      OR NEW.points_held IS DISTINCT FROM OLD.points_held
      OR NEW.tier_at_request IS DISTINCT FROM OLD.tier_at_request
      OR NEW.note IS DISTINCT FROM OLD.note
      OR NEW.consent_receipt_id IS DISTINCT FROM OLD.consent_receipt_id
      OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
      OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
      OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
      OR NEW.decline_reason IS DISTINCT FROM OLD.decline_reason
      OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'access request % may only be marked completed', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'requested' THEN
    RAISE EXCEPTION 'access request % is closed (%)', OLD.id, OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'requested'
    OR NEW.completed_at IS NOT NULL
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
CREATE TRIGGER points_task_completions_append_only BEFORE UPDATE OR DELETE ON public.points_task_completions
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
CREATE TRIGGER points_tasks_set_updated_at BEFORE UPDATE ON public.points_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
