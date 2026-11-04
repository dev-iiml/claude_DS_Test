-- 0042 — Stage 19 guards. The passport access log and brand-organisation reviews are append-only (removed only by an
-- erasure transaction or with their parent row). A passport's owner never changes. updated_at kept current.
CREATE TRIGGER passport_access_log_append_only BEFORE UPDATE OR DELETE ON public.passport_access_log
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
CREATE TRIGGER brand_org_reviews_append_only BEFORE UPDATE OR DELETE ON public.brand_org_reviews
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.public_passports_owner_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.creator_id IS DISTINCT FROM OLD.creator_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'public passport % ownership is immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER public_passports_owner_guard BEFORE UPDATE ON public.public_passports
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.public_passports_owner_guard();
--> statement-breakpoint
CREATE TRIGGER public_passports_set_updated_at BEFORE UPDATE ON public.public_passports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER brand_orgs_set_updated_at BEFORE UPDATE ON public.brand_orgs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER brand_org_members_set_updated_at BEFORE UPDATE ON public.brand_org_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER brand_org_claims_set_updated_at BEFORE UPDATE ON public.brand_org_claims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER passport_takedowns_set_updated_at BEFORE UPDATE ON public.passport_takedowns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
