-- 0001 — integrity guards, privilege hardening and reference data.
-- Hand-written (drizzle-kit --custom). Safe to run on plain PostgreSQL and on Supabase.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER identities_set_updated_at BEFORE UPDATE ON iam.identities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER creator_profiles_set_updated_at BEFORE UPDATE ON public.creator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER creator_preferences_set_updated_at BEFORE UPDATE ON public.creator_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER creator_social_accounts_set_updated_at BEFORE UPDATE ON public.creator_social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- audit_events is append-only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update_delete BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_events_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON public.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_events_append_only();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- consent_definitions: immutable once published; only active_to may be closed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consent_definitions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consent_definitions rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.key IS DISTINCT FROM OLD.key
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.active_from IS DISTINCT FROM OLD.active_from
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'published consent definitions are immutable; publish a new version instead'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.active_to IS NOT NULL AND NEW.active_to IS DISTINCT FROM OLD.active_to THEN
    RAISE EXCEPTION 'a closed consent definition cannot be reopened or re-dated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER consent_definitions_guard BEFORE UPDATE OR DELETE ON public.consent_definitions
  FOR EACH ROW EXECUTE FUNCTION public.consent_definitions_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- consent_receipts: append-only except granted -> withdrawn.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consent_receipts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consent_receipts rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.consent_definition_id IS DISTINCT FROM OLD.consent_definition_id
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'consent receipts are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (OLD.status = 'granted' AND NEW.status = 'withdrawn') THEN
    RAISE EXCEPTION 'only granted -> withdrawn is permitted (got % -> %)', OLD.status, NEW.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER consent_receipts_guard BEFORE UPDATE OR DELETE ON public.consent_receipts
  FOR EACH ROW EXECUTE FUNCTION public.consent_receipts_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Privilege hardening.
-- All tables have RLS enabled with no policies (deny-by-default). The app
-- connects as the schema owner from the server only. On Supabase, also make
-- sure the PostgREST roles cannot read anything even if RLS is later relaxed.
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA iam FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA iam FROM %I', r);
      EXECUTE format('REVOKE ALL ON SCHEMA iam FROM %I', r);
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reference data (required in every environment).
-- ---------------------------------------------------------------------------
INSERT INTO public.creator_categories (code, label, sort_order) VALUES
  ('beauty', 'Beauty', 10),
  ('fashion', 'Fashion', 20),
  ('lifestyle', 'Lifestyle', 30),
  ('travel', 'Travel', 40),
  ('food', 'Food', 50),
  ('fitness', 'Fitness & wellness', 60),
  ('tech', 'Technology', 70),
  ('education', 'Education', 80),
  ('music', 'Music', 90),
  ('comedy', 'Comedy & entertainment', 100),
  ('gaming', 'Gaming', 110),
  ('parenting', 'Parenting & family', 120),
  ('home', 'Home & interiors', 130),
  ('photography', 'Photography & film', 140),
  ('art_design', 'Art & design', 150)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.social_platforms (code, label, sort_order) VALUES
  ('instagram', 'Instagram', 10),
  ('youtube', 'YouTube', 20),
  ('linkedin', 'LinkedIn', 30),
  ('x', 'X', 40),
  ('facebook', 'Facebook', 50),
  ('snapchat', 'Snapchat', 60),
  ('sharechat', 'ShareChat', 70),
  ('moj', 'Moj', 80),
  ('josh', 'Josh', 90),
  ('podcast', 'Podcasts', 100)
ON CONFLICT (code) DO NOTHING;
