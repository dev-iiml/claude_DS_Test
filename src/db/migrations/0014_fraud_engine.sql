CREATE TABLE "fin"."fraud_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"rules_version" text NOT NULL,
	"outcome" text NOT NULL,
	"highest_severity" text,
	"inputs" jsonb NOT NULL,
	"checks" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fraud_checks_outcome_valid" CHECK ("fin"."fraud_checks"."outcome" in ('clear', 'watch', 'review')),
	CONSTRAINT "fraud_checks_severity_valid" CHECK ("fin"."fraud_checks"."highest_severity" is null or "fin"."fraud_checks"."highest_severity" in ('low', 'medium', 'high')),
	CONSTRAINT "fraud_checks_outcome_matches_severity" CHECK (("fin"."fraud_checks"."outcome" = 'clear') = ("fin"."fraud_checks"."highest_severity" is null) and ("fin"."fraud_checks"."outcome" = 'review') = ("fin"."fraud_checks"."highest_severity" = 'high')),
	CONSTRAINT "fraud_checks_bounded" CHECK (pg_column_size("fin"."fraud_checks"."inputs") <= 1024 and pg_column_size("fin"."fraud_checks"."checks") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "fin"."fraud_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin"."fraud_flags" (
	"check_id" uuid NOT NULL,
	"code" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fraud_flags_code_format" CHECK ("fin"."fraud_flags"."code" ~ '^[A-Z][A-Z0-9_]{2,63}$'),
	CONSTRAINT "fraud_flags_category_valid" CHECK ("fin"."fraud_flags"."category" in ('identity', 'duplicate', 'income', 'account', 'audience', 'velocity')),
	CONSTRAINT "fraud_flags_severity_valid" CHECK ("fin"."fraud_flags"."severity" in ('low', 'medium', 'high')),
	CONSTRAINT "fraud_flags_evidence_bounded" CHECK (pg_column_size("fin"."fraud_flags"."evidence") <= 512)
);
--> statement-breakpoint
ALTER TABLE "fin"."fraud_flags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" DROP CONSTRAINT "credit_applications_erased_is_empty";--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD COLUMN "pan_fingerprint" text;--> statement-breakpoint
ALTER TABLE "fin"."fraud_checks" ADD CONSTRAINT "fraud_checks_run_id_underwriting_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "fin"."underwriting_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."fraud_checks" ADD CONSTRAINT "fraud_checks_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "fin"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."fraud_flags" ADD CONSTRAINT "fraud_flags_check_id_fraud_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "fin"."fraud_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fraud_checks_run_key" ON "fin"."fraud_checks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "fraud_checks_application_idx" ON "fin"."fraud_checks" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fraud_flags_check_code_key" ON "fin"."fraud_flags" USING btree ("check_id","code");--> statement-breakpoint
CREATE INDEX "fraud_flags_code_idx" ON "fin"."fraud_flags" USING btree ("code");--> statement-breakpoint
CREATE INDEX "credit_applications_pan_fingerprint_idx" ON "fin"."credit_applications" USING btree ("pan_fingerprint");--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_pan_fingerprint_format" CHECK ("fin"."credit_applications"."pan_fingerprint" is null or "fin"."credit_applications"."pan_fingerprint" ~ '^v[0-9]+:[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_erased_is_empty" CHECK ("fin"."credit_applications"."inputs_erased_at" is null or (
          "fin"."credit_applications"."requested_amount" is null and "fin"."credit_applications"."declared_monthly_income" is null and "fin"."credit_applications"."declared_monthly_emi" is null
          and cardinality("fin"."credit_applications"."income_sources") = 0 and "fin"."credit_applications"."pan_masked" is null and "fin"."credit_applications"."cashflow_reference" is null
          and "fin"."credit_applications"."pan_fingerprint" is null));