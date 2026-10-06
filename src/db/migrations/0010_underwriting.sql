CREATE TABLE "fin"."underwriting_inputs" (
	"run_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"origin" text NOT NULL,
	"value_numeric" numeric(18, 6),
	"value_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "underwriting_inputs_origin_valid" CHECK ("fin"."underwriting_inputs"."origin" in ('financial', 'professional', 'application')),
	CONSTRAINT "underwriting_inputs_single_value" CHECK ("fin"."underwriting_inputs"."value_numeric" is null or "fin"."underwriting_inputs"."value_text" is null)
);
--> statement-breakpoint
ALTER TABLE "fin"."underwriting_inputs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."underwriting_results" (
	"run_id" uuid NOT NULL,
	"model" text NOT NULL,
	"score" numeric(5, 1),
	"grade" text,
	"completeness" numeric(4, 3) NOT NULL,
	"confidence" text NOT NULL,
	"outcome" text NOT NULL,
	"income_basis" integer,
	"income_basis_source" text,
	"recommended_exposure" integer,
	"max_recommended_exposure" integer,
	"recommended_tenor_months" integer,
	"components" jsonb NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "underwriting_results_model_valid" CHECK ("fin"."underwriting_results"."model" in ('traditional', 'creator_enhanced')),
	CONSTRAINT "underwriting_results_grade_valid" CHECK ("fin"."underwriting_results"."grade" is null or "fin"."underwriting_results"."grade" in ('A', 'B', 'C', 'D', 'E')),
	CONSTRAINT "underwriting_results_outcome_valid" CHECK ("fin"."underwriting_results"."outcome" in ('recommend', 'refer', 'not_recommended')),
	CONSTRAINT "underwriting_results_score_range" CHECK ("fin"."underwriting_results"."score" is null or "fin"."underwriting_results"."score" between 0 and 100),
	CONSTRAINT "underwriting_results_bounded" CHECK (pg_column_size("fin"."underwriting_results"."components") <= 1024 and pg_column_size("fin"."underwriting_results"."reason_codes") <= 4096)
);
--> statement-breakpoint
ALTER TABLE "fin"."underwriting_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."underwriting_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"model_version" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"financial_run_id" uuid NOT NULL,
	"professional_run_id" uuid,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "underwriting_runs_hash_format" CHECK ("fin"."underwriting_runs"."inputs_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "fin"."underwriting_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fin"."underwriting_inputs" ADD CONSTRAINT "underwriting_inputs_run_id_underwriting_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "fin"."underwriting_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."underwriting_results" ADD CONSTRAINT "underwriting_results_run_id_underwriting_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "fin"."underwriting_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."underwriting_runs" ADD CONSTRAINT "underwriting_runs_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "fin"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "underwriting_inputs_run_key" ON "fin"."underwriting_inputs" USING btree ("run_id","feature_key");--> statement-breakpoint
CREATE UNIQUE INDEX "underwriting_results_run_model_key" ON "fin"."underwriting_results" USING btree ("run_id","model");--> statement-breakpoint
CREATE UNIQUE INDEX "underwriting_runs_identity_key" ON "fin"."underwriting_runs" USING btree ("application_id","model_version","inputs_hash");--> statement-breakpoint
CREATE INDEX "underwriting_runs_application_idx" ON "fin"."underwriting_runs" USING btree ("application_id","computed_at" DESC NULLS LAST);