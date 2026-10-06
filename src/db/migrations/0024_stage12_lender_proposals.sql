CREATE TABLE "fin"."credit_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"underwriting_run_id" uuid NOT NULL,
	"lender" text NOT NULL,
	"status" text NOT NULL,
	"hold_reason" text,
	"data_groups" text[] NOT NULL,
	"consent_receipt_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"policy_version" integer,
	"lender_reference" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"submitted_at" timestamp with time zone,
	"withdrawn_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_proposals_status_valid" CHECK ("fin"."credit_proposals"."status" in ('held', 'queued', 'submitted', 'decided', 'failed', 'withdrawn')),
	CONSTRAINT "credit_proposals_hold_valid" CHECK ("fin"."credit_proposals"."status" <> 'held' or "fin"."credit_proposals"."hold_reason" is not null),
	CONSTRAINT "credit_proposals_release_valid" CHECK (("fin"."credit_proposals"."released_at" is null) = ("fin"."credit_proposals"."released_by" is null) and ("fin"."credit_proposals"."released_at" is null) = ("fin"."credit_proposals"."release_reason" is null)
          and ("fin"."credit_proposals"."released_at" is null or "fin"."credit_proposals"."hold_reason" is not null)),
	CONSTRAINT "credit_proposals_withdrawn_valid" CHECK (("fin"."credit_proposals"."status" = 'withdrawn') = ("fin"."credit_proposals"."withdrawn_reason" is not null)),
	CONSTRAINT "credit_proposals_sent_has_reference" CHECK ("fin"."credit_proposals"."status" not in ('submitted', 'decided') or ("fin"."credit_proposals"."lender_reference" is not null and "fin"."credit_proposals"."submitted_at" is not null)),
	CONSTRAINT "credit_proposals_release_reason" CHECK ("fin"."credit_proposals"."release_reason" is null or char_length("fin"."credit_proposals"."release_reason") between 3 and 500),
	CONSTRAINT "credit_proposals_hash_format" CHECK ("fin"."credit_proposals"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "credit_proposals_lender_format" CHECK ("fin"."credit_proposals"."lender" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "credit_proposals_payload_bounded" CHECK (pg_column_size("fin"."credit_proposals"."payload") <= 32768),
	CONSTRAINT "credit_proposals_attempts_range" CHECK ("fin"."credit_proposals"."attempts" between 0 and 50)
);
--> statement-breakpoint
ALTER TABLE "fin"."credit_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."decision_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"action" text NOT NULL,
	"final_outcome" text NOT NULL,
	"final_exposure" integer,
	"final_tenor_months" integer,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_reviews_action_valid" CHECK ("fin"."decision_reviews"."action" in ('confirm', 'override')),
	CONSTRAINT "decision_reviews_outcome_valid" CHECK ("fin"."decision_reviews"."final_outcome" in ('approved', 'modified', 'declined')),
	CONSTRAINT "decision_reviews_override_has_reason" CHECK ("fin"."decision_reviews"."action" <> 'override' or ("fin"."decision_reviews"."reason" is not null and char_length("fin"."decision_reviews"."reason") between 10 and 500)),
	CONSTRAINT "decision_reviews_amounts_match_outcome" CHECK (("fin"."decision_reviews"."final_outcome" = 'declined') = ("fin"."decision_reviews"."final_exposure" is null)
          and ("fin"."decision_reviews"."final_exposure" is null or "fin"."decision_reviews"."final_exposure" between 10000 and 2500000)
          and ("fin"."decision_reviews"."final_tenor_months" is null or "fin"."decision_reviews"."final_tenor_months" between 3 and 60))
);
--> statement-breakpoint
ALTER TABLE "fin"."decision_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."lender_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"lender_reference" text NOT NULL,
	"outcome" text NOT NULL,
	"approved_exposure" integer,
	"approved_tenor_months" integer,
	"decision_basis" text,
	"policy_version" integer,
	"reason_codes" text[] NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lender_decisions_outcome_valid" CHECK ("fin"."lender_decisions"."outcome" in ('approved', 'modified', 'declined')),
	CONSTRAINT "lender_decisions_amounts_match_outcome" CHECK (("fin"."lender_decisions"."outcome" = 'declined') = ("fin"."lender_decisions"."approved_exposure" is null)
          and ("fin"."lender_decisions"."approved_exposure" is null or "fin"."lender_decisions"."approved_exposure" > 0)),
	CONSTRAINT "lender_decisions_basis_valid" CHECK ("fin"."lender_decisions"."decision_basis" is null or "fin"."lender_decisions"."decision_basis" in ('traditional', 'creator_enhanced')),
	CONSTRAINT "lender_decisions_reasons_bounded" CHECK (cardinality("fin"."lender_decisions"."reason_codes") <= 20)
);
--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."simulated_lender_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"rules" jsonb NOT NULL,
	"note" text,
	"proposed_by" uuid,
	"proposed_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simulated_lender_policies_status_valid" CHECK ("ops"."simulated_lender_policies"."status" in ('proposed', 'active', 'superseded', 'rejected')),
	CONSTRAINT "simulated_lender_policies_four_eyes" CHECK ("ops"."simulated_lender_policies"."decided_by" is null or "ops"."simulated_lender_policies"."proposed_by" is null or "ops"."simulated_lender_policies"."decided_by" <> "ops"."simulated_lender_policies"."proposed_by"),
	CONSTRAINT "simulated_lender_policies_decided" CHECK ("ops"."simulated_lender_policies"."status" = 'proposed' or "ops"."simulated_lender_policies"."proposed_by" is null or ("ops"."simulated_lender_policies"."decided_by" is not null and "ops"."simulated_lender_policies"."decided_at" is not null)),
	CONSTRAINT "simulated_lender_policies_note_length" CHECK ("ops"."simulated_lender_policies"."note" is null or char_length("ops"."simulated_lender_policies"."note") <= 500),
	CONSTRAINT "simulated_lender_policies_rules_bounded" CHECK (pg_column_size("ops"."simulated_lender_policies"."rules") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "ops"."simulated_lender_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."jobs" DROP CONSTRAINT "jobs_type_valid";--> statement-breakpoint
ALTER TABLE "fin"."credit_proposals" ADD CONSTRAINT "credit_proposals_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "fin"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."credit_proposals" ADD CONSTRAINT "credit_proposals_underwriting_run_id_underwriting_runs_id_fk" FOREIGN KEY ("underwriting_run_id") REFERENCES "fin"."underwriting_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."credit_proposals" ADD CONSTRAINT "credit_proposals_consent_receipt_id_consent_receipts_id_fk" FOREIGN KEY ("consent_receipt_id") REFERENCES "public"."consent_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."credit_proposals" ADD CONSTRAINT "credit_proposals_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."decision_reviews" ADD CONSTRAINT "decision_reviews_decision_id_lender_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "fin"."lender_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."decision_reviews" ADD CONSTRAINT "decision_reviews_proposal_id_credit_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "fin"."credit_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."decision_reviews" ADD CONSTRAINT "decision_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD CONSTRAINT "lender_decisions_proposal_id_credit_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "fin"."credit_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."simulated_lender_policies" ADD CONSTRAINT "simulated_lender_policies_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."simulated_lender_policies" ADD CONSTRAINT "simulated_lender_policies_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_proposals_application_idx" ON "fin"."credit_proposals" USING btree ("application_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credit_proposals_status_idx" ON "fin"."credit_proposals" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_proposals_live_run_key" ON "fin"."credit_proposals" USING btree ("underwriting_run_id") WHERE "fin"."credit_proposals"."status" not in ('withdrawn', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX "credit_proposals_lender_reference_key" ON "fin"."credit_proposals" USING btree ("lender","lender_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_reviews_decision_key" ON "fin"."decision_reviews" USING btree ("decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lender_decisions_proposal_key" ON "fin"."lender_decisions" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "simulated_lender_policies_version_key" ON "ops"."simulated_lender_policies" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "simulated_lender_policies_one_active" ON "ops"."simulated_lender_policies" USING btree ("status") WHERE "ops"."simulated_lender_policies"."status" = 'active';--> statement-breakpoint
ALTER TABLE "ops"."jobs" ADD CONSTRAINT "jobs_type_valid" CHECK ("ops"."jobs"."type" in ('expire_stale_applications', 'process_deferred_erasures', 'provider_health_check', 'purge_expired_fi_data', 'process_lender_proposals'));