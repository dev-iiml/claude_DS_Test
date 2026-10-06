-- 0013 — guards for the integration control plane (`ops` schema).
CREATE TRIGGER provider_configs_set_updated_at BEFORE UPDATE ON ops.provider_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER provider_routes_set_updated_at BEFORE UPDATE ON ops.provider_routes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER provider_runtime_set_updated_at BEFORE UPDATE ON ops.provider_runtime
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
-- A config's identity (capability, key, adapter) is recorded with the data it
-- produced, so it never changes and configs are never deleted (disable instead).
CREATE OR REPLACE FUNCTION ops.provider_configs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider configs cannot be deleted; disable them instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.key IS DISTINCT FROM OLD.key
     OR NEW.adapter IS DISTINCT FROM OLD.adapter OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'provider config identity is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'provider config changes must increment version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER provider_configs_guard BEFORE UPDATE OR DELETE ON ops.provider_configs
  FOR EACH ROW EXECUTE FUNCTION ops.provider_configs_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ops.provider_routes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider routes cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'provider route changes must keep the capability and increment version'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER provider_routes_guard BEFORE UPDATE OR DELETE ON ops.provider_routes
  FOR EACH ROW EXECUTE FUNCTION ops.provider_routes_guard();
--> statement-breakpoint
-- Change requests: only a pending request may be decided, once; what was
-- requested (action, payload, requester, base versions) never changes.
CREATE OR REPLACE FUNCTION ops.integration_change_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'change requests cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'decided change requests are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.action IS DISTINCT FROM OLD.action OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.approval_required IS DISTINCT FROM OLD.approval_required
     OR NEW.base_route_version IS DISTINCT FROM OLD.base_route_version
     OR NEW.base_config_version IS DISTINCT FROM OLD.base_config_version
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR (OLD.config_id IS NOT NULL AND NEW.config_id IS DISTINCT FROM OLD.config_id) THEN
    RAISE EXCEPTION 'the requested change is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_change_requests_guard BEFORE UPDATE OR DELETE ON ops.integration_change_requests
  FOR EACH ROW EXECUTE FUNCTION ops.integration_change_requests_guard();
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA ops FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM %I', r);
    END IF;
  END LOOP;
END;
$$;
