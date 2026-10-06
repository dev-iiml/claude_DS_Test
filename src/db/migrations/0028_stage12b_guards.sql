-- 0028 — Stage 12b guards: partner access (ops) and decision queries (fin).
CREATE TRIGGER partners_set_updated_at BEFORE UPDATE ON ops.partners
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER partner_api_keys_set_updated_at BEFORE UPDATE ON ops.partner_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER partner_webhook_endpoints_set_updated_at BEFORE UPDATE ON ops.partner_webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER partner_webhook_deliveries_set_updated_at BEFORE UPDATE ON ops.partner_webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
-- A partner's identity and the lender config it serves never change (create a new partner instead).
CREATE OR REPLACE FUNCTION ops.partner_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'partners are kept (suspend instead)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.key IS DISTINCT FROM OLD.key OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.lender_key IS DISTINCT FROM OLD.lender_key THEN
    RAISE EXCEPTION 'partner identity is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER partners_guard BEFORE UPDATE OR DELETE ON ops.partners
  FOR EACH ROW EXECUTE FUNCTION ops.partner_guard();
--> statement-breakpoint
-- API keys: what a key is never changes; status moves forward only; expiry only shortens.
CREATE OR REPLACE FUNCTION ops.partner_api_key_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'partner API keys are kept (revoke instead)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.partner_id IS DISTINCT FROM OLD.partner_id OR NEW.prefix IS DISTINCT FROM OLD.prefix
     OR NEW.secret_hash IS DISTINCT FROM OLD.secret_hash OR NEW.scopes IS DISTINCT FROM OLD.scopes
     OR NEW.label IS DISTINCT FROM OLD.label OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by
     OR NEW.proposed_at IS DISTINCT FROM OLD.proposed_at OR NEW.replaces_key_id IS DISTINCT FROM OLD.replaces_key_id
     OR NEW.overlap_hours IS DISTINCT FROM OLD.overlap_hours THEN
    RAISE EXCEPTION 'partner API key content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.expires_at > OLD.expires_at THEN
    RAISE EXCEPTION 'a partner API key''s expiry can only be brought forward' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('active', 'rejected', 'expired', 'cancelled'))
       OR (OLD.status = 'active' AND NEW.status = 'revoked')) THEN
    RAISE EXCEPTION 'invalid partner API key status change % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER partner_api_keys_guard BEFORE UPDATE OR DELETE ON ops.partner_api_keys
  FOR EACH ROW EXECUTE FUNCTION ops.partner_api_key_guard();
--> statement-breakpoint
-- Webhook endpoints: the URL never changes (a new URL is a new, approved endpoint).
CREATE OR REPLACE FUNCTION ops.partner_webhook_endpoint_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'webhook endpoints are kept (retire instead)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.url IS DISTINCT FROM OLD.url OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
     OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by OR NEW.secret_version < OLD.secret_version THEN
    RAISE EXCEPTION 'webhook endpoint content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('active', 'rejected', 'expired', 'cancelled'))
       OR (OLD.status = 'active' AND NEW.status = 'retired')) THEN
    RAISE EXCEPTION 'invalid webhook endpoint status change % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER partner_webhook_endpoints_guard BEFORE UPDATE OR DELETE ON ops.partner_webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION ops.partner_webhook_endpoint_guard();
--> statement-breakpoint
-- Events are a record (and the partner's feed): append-only; erased with their proposal (cascade).
CREATE TRIGGER partner_events_append_only BEFORE UPDATE OR DELETE ON ops.partner_events
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
-- A query's text never changes; only its resolution is recorded, once.
CREATE OR REPLACE FUNCTION fin.decision_query_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('creatorco.erasure', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'decision queries are append-only' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.proposal_id IS DISTINCT FROM OLD.proposal_id OR NEW.decision_id IS DISTINCT FROM OLD.decision_id
     OR NEW.raised_by IS DISTINCT FROM OLD.raised_by OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.resolved_at IS NOT NULL AND (NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
       OR NEW.resolved_decision_id IS DISTINCT FROM OLD.resolved_decision_id
       OR NEW.withdrawn_by IS DISTINCT FROM OLD.withdrawn_by
       OR NEW.withdrawn_reason IS DISTINCT FROM OLD.withdrawn_reason)) THEN
    RAISE EXCEPTION 'decision queries are append-only (only the resolution is set, once)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER decision_queries_guard BEFORE UPDATE OR DELETE ON fin.decision_queries
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION fin.decision_query_guard();
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA fin FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA ops FROM %I', r);
    END IF;
  END LOOP;
END;
$$;
