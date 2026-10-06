CREATE TABLE "fin"."cashflow_account_months" (
	"account_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"month" date NOT NULL,
	"analysis_version" text NOT NULL,
	"inflow_total" integer NOT NULL,
	"outflow_total" integer NOT NULL,
	"creator_income" integer NOT NULL,
	"own_transfers_in" integer NOT NULL,
	"own_transfers_out" integer NOT NULL,
	"transaction_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashflow_account_months_first_of_month" CHECK (extract(day from "fin"."cashflow_account_months"."month") = 1),
	CONSTRAINT "cashflow_account_months_non_negative" CHECK ("fin"."cashflow_account_months"."inflow_total" >= 0 and "fin"."cashflow_account_months"."outflow_total" >= 0 and "fin"."cashflow_account_months"."creator_income" between 0 and "fin"."cashflow_account_months"."inflow_total"
          and "fin"."cashflow_account_months"."own_transfers_in" >= 0 and "fin"."cashflow_account_months"."own_transfers_out" >= 0 and "fin"."cashflow_account_months"."transaction_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fin"."cashflow_account_months" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."cashflow_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"masked_number" text NOT NULL,
	"institution" text NOT NULL,
	"account_type" text NOT NULL,
	"discovered_via_last4" text NOT NULL,
	"status" text NOT NULL,
	"period_from" date,
	"period_to" date,
	"transactions_retained" boolean DEFAULT false NOT NULL,
	"data_life_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashflow_accounts_status_valid" CHECK ("fin"."cashflow_accounts"."status" in ('delivered', 'pending', 'timeout', 'denied', 'failed')),
	CONSTRAINT "cashflow_accounts_type_valid" CHECK ("fin"."cashflow_accounts"."account_type" in ('savings', 'current', 'overdraft', 'other')),
	CONSTRAINT "cashflow_accounts_masked_format" CHECK ("fin"."cashflow_accounts"."masked_number" ~ '^[X*]{0,16}[0-9]{2,6}$'),
	CONSTRAINT "cashflow_accounts_last4_format" CHECK ("fin"."cashflow_accounts"."discovered_via_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "cashflow_accounts_institution_length" CHECK (char_length("fin"."cashflow_accounts"."institution") between 1 and 120),
	CONSTRAINT "cashflow_accounts_dedupe_format" CHECK ("fin"."cashflow_accounts"."dedupe_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "cashflow_accounts_retained_needs_life" CHECK (not "fin"."cashflow_accounts"."transactions_retained" or ("fin"."cashflow_accounts"."data_life_until" is not null and "fin"."cashflow_accounts"."status" = 'delivered'))
);
--> statement-breakpoint
ALTER TABLE "fin"."cashflow_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."cashflow_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"mobile_last4" text NOT NULL,
	"mobile_fingerprint" text NOT NULL,
	"retry_of" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"accounts_selected" integer DEFAULT 0 NOT NULL,
	"accounts_delivered" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashflow_sessions_status_valid" CHECK ("fin"."cashflow_sessions"."status" in ('pending', 'completed', 'partial', 'declined', 'no_accounts', 'failed', 'abandoned')),
	CONSTRAINT "cashflow_sessions_provider_format" CHECK ("fin"."cashflow_sessions"."provider" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "cashflow_sessions_last4_format" CHECK ("fin"."cashflow_sessions"."mobile_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "cashflow_sessions_fingerprint_format" CHECK ("fin"."cashflow_sessions"."mobile_fingerprint" ~ '^v[0-9]+:[0-9a-f]{64}$'),
	CONSTRAINT "cashflow_sessions_counts_valid" CHECK ("fin"."cashflow_sessions"."accounts_selected" >= 0 and "fin"."cashflow_sessions"."accounts_delivered" between 0 and "fin"."cashflow_sessions"."accounts_selected")
);
--> statement-breakpoint
ALTER TABLE "fin"."cashflow_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."fi_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"txn_ref_hash" text NOT NULL,
	"booked_on" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"direction" text NOT NULL,
	"mode" text NOT NULL,
	"narration_sealed" text NOT NULL,
	"counterparty_sealed" text,
	"data_life_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fi_transactions_direction_valid" CHECK ("fin"."fi_transactions"."direction" in ('credit', 'debit')),
	CONSTRAINT "fi_transactions_amount_positive" CHECK ("fin"."fi_transactions"."amount" > 0),
	CONSTRAINT "fi_transactions_mode_format" CHECK ("fin"."fi_transactions"."mode" ~ '^[a-z]{2,10}$'),
	CONSTRAINT "fi_transactions_hash_format" CHECK ("fin"."fi_transactions"."txn_ref_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "fi_transactions_sealed_format" CHECK ("fin"."fi_transactions"."narration_sealed" like 'v1.%')
);
--> statement-breakpoint
ALTER TABLE "fin"."fi_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."fi_vendor_analytics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"payload_sealed" text NOT NULL,
	"data_life_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fi_vendor_analytics_sealed_format" CHECK ("fin"."fi_vendor_analytics"."payload_sealed" like 'v1.%')
);
--> statement-breakpoint
ALTER TABLE "fin"."fi_vendor_analytics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fin"."cashflow_months" DROP CONSTRAINT "cashflow_months_non_negative";--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" DROP CONSTRAINT "credit_applications_cashflow_provider_format";--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" DROP CONSTRAINT "credit_applications_purpose_valid";--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" DROP CONSTRAINT "credit_applications_cashflow_status_valid";--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" DROP CONSTRAINT "credit_applications_ready_is_whole";--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" DROP CONSTRAINT "credit_applications_erased_is_empty";--> statement-breakpoint
DROP INDEX "fin"."credit_applications_cashflow_reference_key";--> statement-breakpoint
ALTER TABLE "fin"."cashflow_months" ADD COLUMN "own_transfers_excluded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fin"."cashflow_months" ADD COLUMN "accounts_contributing" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD COLUMN "purposes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD COLUMN "purpose_note" text;--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD COLUMN "cashflow_coverage" text;--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD COLUMN "accounts_complete_declared" boolean;--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD COLUMN "missing_accounts_reason" text;--> statement-breakpoint
ALTER TABLE "fin"."cashflow_account_months" ADD CONSTRAINT "cashflow_account_months_account_id_cashflow_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "fin"."cashflow_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."cashflow_account_months" ADD CONSTRAINT "cashflow_account_months_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "fin"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."cashflow_accounts" ADD CONSTRAINT "cashflow_accounts_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "fin"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."cashflow_accounts" ADD CONSTRAINT "cashflow_accounts_session_id_cashflow_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "fin"."cashflow_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."cashflow_sessions" ADD CONSTRAINT "cashflow_sessions_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "fin"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."fi_transactions" ADD CONSTRAINT "fi_transactions_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "fin"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."fi_transactions" ADD CONSTRAINT "fi_transactions_account_id_cashflow_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "fin"."cashflow_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."fi_vendor_analytics" ADD CONSTRAINT "fi_vendor_analytics_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "fin"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."fi_vendor_analytics" ADD CONSTRAINT "fi_vendor_analytics_account_id_cashflow_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "fin"."cashflow_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cashflow_account_months_key" ON "fin"."cashflow_account_months" USING btree ("account_id","month");--> statement-breakpoint
CREATE INDEX "cashflow_account_months_application_idx" ON "fin"."cashflow_account_months" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cashflow_accounts_dedupe_key" ON "fin"."cashflow_accounts" USING btree ("application_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "cashflow_sessions_reference_key" ON "fin"."cashflow_sessions" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "cashflow_sessions_application_idx" ON "fin"."cashflow_sessions" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fi_transactions_account_ref_key" ON "fin"."fi_transactions" USING btree ("account_id","txn_ref_hash");--> statement-breakpoint
CREATE INDEX "fi_transactions_data_life_idx" ON "fin"."fi_transactions" USING btree ("data_life_until");--> statement-breakpoint
CREATE INDEX "fi_transactions_application_idx" ON "fin"."fi_transactions" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fi_vendor_analytics_account_key" ON "fin"."fi_vendor_analytics" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "fi_vendor_analytics_data_life_idx" ON "fin"."fi_vendor_analytics" USING btree ("data_life_until");--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" DROP COLUMN "cashflow_reference";--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" DROP COLUMN "cashflow_provider";--> statement-breakpoint
ALTER TABLE "fin"."cashflow_months" ADD CONSTRAINT "cashflow_months_non_negative" CHECK ("fin"."cashflow_months"."inflow_total" >= 0 and "fin"."cashflow_months"."outflow_total" >= 0 and coalesce("fin"."cashflow_months"."creator_income_inflow", 0) >= 0
          and "fin"."cashflow_months"."own_transfers_excluded" >= 0 and "fin"."cashflow_months"."accounts_contributing" >= 0);--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_purposes_valid" CHECK (cardinality("fin"."credit_applications"."purposes") <= 3
          and "fin"."credit_applications"."purposes" <@ array['equipment', 'content_production', 'studio_setup', 'team_hiring', 'work_travel', 'marketing', 'working_capital', 'education', 'other']::text[]
          and (cardinality("fin"."credit_applications"."purposes") = 0 or "fin"."credit_applications"."purposes"[1] = "fin"."credit_applications"."purpose"));--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_purpose_note_valid" CHECK ("fin"."credit_applications"."purpose_note" is null or (char_length("fin"."credit_applications"."purpose_note") between 1 and 140
          and 'other' = any("fin"."credit_applications"."purposes")));--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_coverage_valid" CHECK (("fin"."credit_applications"."cashflow_coverage" is null or "fin"."credit_applications"."cashflow_coverage" in ('none', 'partial', 'complete'))
          and ("fin"."credit_applications"."missing_accounts_reason" is null or ("fin"."credit_applications"."missing_accounts_reason" in ('other_number_unavailable', 'bank_not_on_aa', 'chose_not_to_share')
            and "fin"."credit_applications"."accounts_complete_declared" = false)));--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_purpose_valid" CHECK ("fin"."credit_applications"."purpose" is null or "fin"."credit_applications"."purpose" in ('equipment', 'content_production', 'studio_setup', 'team_hiring', 'work_travel', 'marketing', 'working_capital', 'education', 'other'));--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_cashflow_status_valid" CHECK ("fin"."credit_applications"."cashflow_status" in ('not_started', 'pending', 'completed', 'declined', 'unavailable', 'skipped'));--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_ready_is_whole" CHECK ("fin"."credit_applications"."status" <> 'inputs_ready' or (
          "fin"."credit_applications"."details_completed_at" is not null and "fin"."credit_applications"."bureau_status" = 'completed'
          and "fin"."credit_applications"."cashflow_status" in ('completed', 'skipped') and "fin"."credit_applications"."inputs_ready_at" is not null));--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_erased_is_empty" CHECK ("fin"."credit_applications"."inputs_erased_at" is null or (
          "fin"."credit_applications"."requested_amount" is null and "fin"."credit_applications"."declared_monthly_income" is null and "fin"."credit_applications"."declared_monthly_emi" is null
          and cardinality("fin"."credit_applications"."income_sources") = 0 and "fin"."credit_applications"."pan_masked" is null and "fin"."credit_applications"."purpose_note" is null
          and "fin"."credit_applications"."pan_fingerprint" is null));