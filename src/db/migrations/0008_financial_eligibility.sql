CREATE SCHEMA "fin";
--> statement-breakpoint
CREATE TABLE "fin"."bureau_summaries" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"score_band" text NOT NULL,
	"active_tradelines" integer NOT NULL,
	"delinquent_tradelines_12m" integer NOT NULL,
	"enquiries_6m" integer NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bureau_summaries_band_valid" CHECK ("fin"."bureau_summaries"."score_band" in ('no_hit', 'thin', 'low', 'medium', 'high')),
	CONSTRAINT "bureau_summaries_counts_non_negative" CHECK ("fin"."bureau_summaries"."active_tradelines" >= 0 and "fin"."bureau_summaries"."delinquent_tradelines_12m" >= 0 and "fin"."bureau_summaries"."enquiries_6m" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fin"."bureau_summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."cashflow_months" (
	"application_id" uuid NOT NULL,
	"month" date NOT NULL,
	"inflow_total" integer NOT NULL,
	"outflow_total" integer NOT NULL,
	"creator_income_inflow" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashflow_months_first_of_month" CHECK (extract(day from "fin"."cashflow_months"."month") = 1),
	CONSTRAINT "cashflow_months_non_negative" CHECK ("fin"."cashflow_months"."inflow_total" >= 0 and "fin"."cashflow_months"."outflow_total" >= 0 and coalesce("fin"."cashflow_months"."creator_income_inflow", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "fin"."cashflow_months" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."credit_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"consent_receipt_id" uuid NOT NULL,
	"purpose" text,
	"requested_amount" integer,
	"declared_monthly_income" integer,
	"declared_monthly_emi" integer,
	"income_sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"details_completed_at" timestamp with time zone,
	"pan_masked" text,
	"bureau_status" text DEFAULT 'not_started' NOT NULL,
	"cashflow_status" text DEFAULT 'not_started' NOT NULL,
	"cashflow_reference" text,
	"expires_at" timestamp with time zone NOT NULL,
	"inputs_ready_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"inputs_erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_applications_status_valid" CHECK ("fin"."credit_applications"."status" in ('draft', 'inputs_ready', 'submitted', 'withdrawn', 'expired')),
	CONSTRAINT "credit_applications_purpose_valid" CHECK ("fin"."credit_applications"."purpose" is null or "fin"."credit_applications"."purpose" in ('equipment', 'content_production', 'working_capital', 'marketing', 'education', 'other')),
	CONSTRAINT "credit_applications_bureau_status_valid" CHECK ("fin"."credit_applications"."bureau_status" in ('not_started', 'completed')),
	CONSTRAINT "credit_applications_cashflow_status_valid" CHECK ("fin"."credit_applications"."cashflow_status" in ('not_started', 'pending', 'completed', 'declined', 'skipped')),
	CONSTRAINT "credit_applications_amounts_valid" CHECK (("fin"."credit_applications"."requested_amount" is null or "fin"."credit_applications"."requested_amount" between 10000 and 2500000)
          and ("fin"."credit_applications"."declared_monthly_income" is null or "fin"."credit_applications"."declared_monthly_income" between 0 and 10000000)
          and ("fin"."credit_applications"."declared_monthly_emi" is null or "fin"."credit_applications"."declared_monthly_emi" between 0 and 10000000)),
	CONSTRAINT "credit_applications_sources_bound" CHECK (cardinality("fin"."credit_applications"."income_sources") <= 6),
	CONSTRAINT "credit_applications_pan_masked_format" CHECK ("fin"."credit_applications"."pan_masked" is null or "fin"."credit_applications"."pan_masked" ~ '^X{5}[0-9]{4}[A-Z]$'),
	CONSTRAINT "credit_applications_ready_is_whole" CHECK ("fin"."credit_applications"."status" <> 'inputs_ready' or (
          "fin"."credit_applications"."details_completed_at" is not null and "fin"."credit_applications"."bureau_status" = 'completed'
          and "fin"."credit_applications"."cashflow_status" in ('completed', 'declined', 'skipped') and "fin"."credit_applications"."inputs_ready_at" is not null)),
	CONSTRAINT "credit_applications_closed_has_timestamp" CHECK ("fin"."credit_applications"."status" not in ('withdrawn', 'expired') or "fin"."credit_applications"."closed_at" is not null),
	CONSTRAINT "credit_applications_erased_is_empty" CHECK ("fin"."credit_applications"."inputs_erased_at" is null or (
          "fin"."credit_applications"."requested_amount" is null and "fin"."credit_applications"."declared_monthly_income" is null and "fin"."credit_applications"."declared_monthly_emi" is null
          and cardinality("fin"."credit_applications"."income_sources") = 0 and "fin"."credit_applications"."pan_masked" is null and "fin"."credit_applications"."cashflow_reference" is null))
);
--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."financial_feature_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"engine_version" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_feature_runs_hash_format" CHECK ("fin"."financial_feature_runs"."inputs_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "fin"."financial_feature_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."financial_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"feature_version" text NOT NULL,
	"value_numeric" numeric(18, 6),
	"value_text" text,
	"unit" text NOT NULL,
	"source" text NOT NULL,
	"completeness" numeric(4, 3) NOT NULL,
	"confidence" text NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_features_source_valid" CHECK ("fin"."financial_features"."source" in ('verified', 'declared', 'derived')),
	CONSTRAINT "financial_features_confidence_valid" CHECK ("fin"."financial_features"."confidence" in ('low', 'medium', 'high')),
	CONSTRAINT "financial_features_single_value" CHECK ("fin"."financial_features"."value_numeric" is null or "fin"."financial_features"."value_text" is null),
	CONSTRAINT "financial_features_completeness_range" CHECK ("fin"."financial_features"."completeness" between 0 and 1),
	CONSTRAINT "financial_features_provenance_bounded" CHECK (pg_column_size("fin"."financial_features"."provenance") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "fin"."financial_features" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_erasure_requests" DROP CONSTRAINT "data_erasure_requests_scope_valid";--> statement-breakpoint
ALTER TABLE "fin"."bureau_summaries" ADD CONSTRAINT "bureau_summaries_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "fin"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."cashflow_months" ADD CONSTRAINT "cashflow_months_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "fin"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_consent_receipt_id_consent_receipts_id_fk" FOREIGN KEY ("consent_receipt_id") REFERENCES "public"."consent_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."financial_feature_runs" ADD CONSTRAINT "financial_feature_runs_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "fin"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."financial_features" ADD CONSTRAINT "financial_features_run_id_financial_feature_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "fin"."financial_feature_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."financial_features" ADD CONSTRAINT "financial_features_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "fin"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cashflow_months_application_month_key" ON "fin"."cashflow_months" USING btree ("application_id","month");--> statement-breakpoint
CREATE INDEX "credit_applications_user_idx" ON "fin"."credit_applications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credit_applications_expiry_idx" ON "fin"."credit_applications" USING btree ("expires_at") WHERE "fin"."credit_applications"."status" in ('draft', 'inputs_ready');--> statement-breakpoint
CREATE UNIQUE INDEX "credit_applications_cashflow_reference_key" ON "fin"."credit_applications" USING btree ("cashflow_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_applications_one_open_key" ON "fin"."credit_applications" USING btree ("user_id") WHERE "fin"."credit_applications"."status" in ('draft', 'inputs_ready');--> statement-breakpoint
CREATE UNIQUE INDEX "financial_feature_runs_identity_key" ON "fin"."financial_feature_runs" USING btree ("application_id","engine_version","inputs_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_features_run_key" ON "fin"."financial_features" USING btree ("run_id","feature_key");--> statement-breakpoint
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_scope_valid" CHECK ("data_erasure_requests"."scope" in ('social_account_data', 'professional_graph', 'identity_lookup', 'financial_inputs'));