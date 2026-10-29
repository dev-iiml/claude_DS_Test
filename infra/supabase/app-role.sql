-- CreatorCo (Stage 17): the app's least-privilege login on a Supabase project.
-- Run ONCE per project (staging and production) in Supabase → SQL Editor, BEFORE the first deploy.
-- Replace CHANGE_ME with a fresh value from `openssl rand -hex 24` and keep it for the app connection string:
--   postgresql://creatorco_web.<project-ref>:<password>@<pooler host from Connect>:6543/postgres
-- (migration 0036 also creates creatorco_app if missing and grants it on every table after each `db:migrate`).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creatorco_app') THEN
    CREATE ROLE creatorco_app NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creatorco_web') THEN
    CREATE ROLE creatorco_web LOGIN PASSWORD 'CHANGE_ME' IN ROLE creatorco_app;
  END IF;
END;
$$;

-- Guard rails for the app login: no long-running or idle-in-transaction sessions.
ALTER ROLE creatorco_web SET statement_timeout = '30s';
ALTER ROLE creatorco_web SET idle_in_transaction_session_timeout = '60s';

-- Supabase's API roles never see CreatorCo data (migrations already revoke them; also turn off the Data API).
REVOKE ALL ON SCHEMA public FROM anon, authenticated;
