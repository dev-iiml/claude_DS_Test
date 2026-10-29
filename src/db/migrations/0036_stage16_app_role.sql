-- Stage 16: least-privilege application role.
--
-- The migration user owns the schema (DDL). The running app should connect as
-- a login user that is a member of `creatorco_app`, which can read and write
-- rows but cannot create, alter, drop or truncate anything, and cannot touch
-- the migration history. Every table keeps RLS enabled with no policy for the
-- Supabase API roles; `creatorco_app` gets an explicit allow-all policy (the
-- app authorises in its own data-access layer).
--
-- Creating the role needs CREATEROLE. Where the migration user lacks it (some
-- local setups), the role is skipped with a notice and everything else works
-- as before; `public.grant_app_access()` is a no-op until the role exists.
-- `npm run db:migrate` calls `grant_app_access()` after every run, so tables
-- added by later migrations are covered automatically.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creatorco_app') THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolcreaterole OR rolsuper)) THEN
      CREATE ROLE creatorco_app NOLOGIN NOINHERIT;
    ELSE
      RAISE NOTICE 'creatorco_app not created: % lacks CREATEROLE (create it during deployment)', current_user;
    END IF;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.grant_app_access() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  s text;
  t record;
  touched integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creatorco_app') THEN
    RETURN 0;
  END IF;
  FOREACH s IN ARRAY ARRAY['public', 'iam', 'fin', 'ops', 'analytics'] LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO creatorco_app', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO creatorco_app', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO creatorco_app', s);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO creatorco_app', s);
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM creatorco_app', s);
    FOR t IN
      SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = s AND c.relkind IN ('r', 'p') AND c.relrowsecurity
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = s AND p.tablename = c.relname AND p.policyname = 'creatorco_app_all'
        )
    LOOP
      EXECUTE format(
        'CREATE POLICY creatorco_app_all ON %I.%I TO creatorco_app USING (true) WITH CHECK (true)', s, t.relname
      );
      touched := touched + 1;
    END LOOP;
  END LOOP;
  -- The migration history and the schema itself stay out of reach.
  EXECUTE 'REVOKE ALL ON SCHEMA drizzle FROM creatorco_app';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM creatorco_app';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.grant_app_access() FROM creatorco_app';
  RETURN touched;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.grant_app_access() FROM PUBLIC;
--> statement-breakpoint
SELECT public.grant_app_access();
