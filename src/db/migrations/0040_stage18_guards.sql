-- 0040 — Stage 18 guards. Brand-work review actions and reversal decisions are append-only (erased only with the
-- brand_work_records consent, via cascades / erasure transactions). Directory merges are append-only apart from their
-- decision. updated_at kept current on records and directory entries.
CREATE TRIGGER brand_work_reviews_append_only BEFORE UPDATE OR DELETE ON public.brand_work_reviews
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.brand_work_records_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('creatorco.erasure', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'brand_work_records are erased only with the brand-work consent or as a draft' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.creator_id IS DISTINCT FROM OLD.creator_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.consent_receipt_id IS DISTINCT FROM OLD.consent_receipt_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'brand work record % ownership is immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER brand_work_records_guard BEFORE UPDATE OR DELETE ON public.brand_work_records
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.brand_work_records_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.brand_work_documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('creatorco.erasure', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'brand_work_documents are erased only with their record' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Only the scan verdict changes, once, from pending.
  IF OLD.scan_status <> 'pending'
    OR NEW.record_id IS DISTINCT FROM OLD.record_id
    OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
    OR NEW.storage_provider IS DISTINCT FROM OLD.storage_provider
    OR NEW.sha256 IS DISTINCT FROM OLD.sha256
    OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
    OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
    OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at THEN
    RAISE EXCEPTION 'brand work document % may only record its scan verdict', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER brand_work_documents_guard BEFORE UPDATE OR DELETE ON public.brand_work_documents
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.brand_work_documents_guard();
--> statement-breakpoint
CREATE TRIGGER brand_work_records_set_updated_at BEFORE UPDATE ON public.brand_work_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER brand_directory_set_updated_at BEFORE UPDATE ON public.brand_directory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER feature_switches_set_updated_at BEFORE UPDATE ON ops.feature_switches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
