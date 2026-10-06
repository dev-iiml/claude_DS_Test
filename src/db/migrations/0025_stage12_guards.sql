-- 0025 — Stage 12 guards.
CREATE TRIGGER credit_proposals_set_updated_at BEFORE UPDATE ON fin.credit_proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER simulated_lender_policies_set_updated_at BEFORE UPDATE ON ops.simulated_lender_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
-- What a proposal says is frozen when it's created: only its delivery state changes.
CREATE OR REPLACE FUNCTION fin.credit_proposal_content_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.data_groups IS DISTINCT FROM OLD.data_groups
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.underwriting_run_id IS DISTINCT FROM OLD.underwriting_run_id
     OR NEW.consent_receipt_id IS DISTINCT FROM OLD.consent_receipt_id
     OR NEW.lender IS DISTINCT FROM OLD.lender THEN
    RAISE EXCEPTION 'credit proposal content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credit_proposals_content_immutable BEFORE UPDATE ON fin.credit_proposals
  FOR EACH ROW EXECUTE FUNCTION fin.credit_proposal_content_immutable();
--> statement-breakpoint
-- Lender decisions and staff reviews are records: append-only (erasable only in an erasure transaction).
CREATE TRIGGER lender_decisions_append_only BEFORE UPDATE OR DELETE ON fin.lender_decisions
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
CREATE TRIGGER decision_reviews_append_only BEFORE UPDATE OR DELETE ON fin.decision_reviews
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.append_only_except_erasure();
--> statement-breakpoint
-- Policy versions are kept: never deleted, and an approved version's rules never change.
CREATE OR REPLACE FUNCTION ops.simulated_lender_policy_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'simulated lender policy versions are kept' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.rules IS DISTINCT FROM OLD.rules OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'simulated lender policy rules are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER simulated_lender_policies_guard BEFORE UPDATE OR DELETE ON ops.simulated_lender_policies
  FOR EACH ROW EXECUTE FUNCTION ops.simulated_lender_policy_guard();
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA fin FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM %I', r);
    END IF;
  END LOOP;
END;
$$;
