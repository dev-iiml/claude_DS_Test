CREATE TABLE "creator_additional_categories" (
	"creator_id" uuid NOT NULL,
	"category_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_additional_categories_creator_id_category_code_pk" PRIMARY KEY("creator_id","category_code")
);
--> statement-breakpoint
ALTER TABLE "creator_additional_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_gst_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"gstin" text NOT NULL,
	"registration_status" text NOT NULL,
	"legal_name" text,
	"trade_name" text,
	"constitution" text,
	"state_code" text,
	"registered_on" date,
	"source" text NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_gst_registrations_gstin_format" CHECK ("creator_gst_registrations"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "creator_gst_registrations_status_valid" CHECK ("creator_gst_registrations"."registration_status" in ('active', 'suspended', 'cancelled', 'not_found')),
	CONSTRAINT "creator_gst_registrations_source_valid" CHECK ("creator_gst_registrations"."source" in ('lookup_by_pan', 'manual_entry'))
);
--> statement-breakpoint
ALTER TABLE "creator_gst_registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "identity_lookup_results" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"mobile" text NOT NULL,
	"verified_name" text NOT NULL,
	"pan_masked" text NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text,
	"consent_receipt_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "identity_lookup_results_pan_masked_format" CHECK ("identity_lookup_results"."pan_masked" ~ '^X{5}[0-9]{4}[A-Z]$'),
	CONSTRAINT "identity_lookup_results_name_length" CHECK (char_length("identity_lookup_results"."verified_name") between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "identity_lookup_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mobile_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mobile" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_verifications_mobile_e164" CHECK ("mobile_verifications"."mobile" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "mobile_verifications_code_hash_format" CHECK ("mobile_verifications"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mobile_verifications_attempts_range" CHECK ("mobile_verifications"."attempts" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "mobile_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"provider_kind" text NOT NULL,
	"provider_key" text NOT NULL,
	"operation" text NOT NULL,
	"outcome" text NOT NULL,
	"provider_reference" text,
	"consent_receipt_id" uuid,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_requests_outcome_valid" CHECK ("provider_requests"."outcome" in ('success', 'not_found', 'rejected', 'error')),
	CONSTRAINT "provider_requests_operation_format" CHECK ("provider_requests"."operation" ~ '^[a-z][a-z_]{1,63}$')
);
--> statement-breakpoint
ALTER TABLE "provider_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mobile_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "legal_name_source" text DEFAULT 'self_declared' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "languages_other" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_additional_categories" ADD CONSTRAINT "creator_additional_categories_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_additional_categories" ADD CONSTRAINT "creator_additional_categories_category_code_creator_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."creator_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_gst_registrations" ADD CONSTRAINT "creator_gst_registrations_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_lookup_results" ADD CONSTRAINT "identity_lookup_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_lookup_results" ADD CONSTRAINT "identity_lookup_results_consent_receipt_id_consent_receipts_id_fk" FOREIGN KEY ("consent_receipt_id") REFERENCES "public"."consent_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_verifications" ADD CONSTRAINT "mobile_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_requests" ADD CONSTRAINT "provider_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_requests" ADD CONSTRAINT "provider_requests_consent_receipt_id_consent_receipts_id_fk" FOREIGN KEY ("consent_receipt_id") REFERENCES "public"."consent_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_gst_registrations_creator_gstin_key" ON "creator_gst_registrations" USING btree ("creator_id","gstin");--> statement-breakpoint
CREATE INDEX "mobile_verifications_user_created_idx" ON "mobile_verifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "provider_requests_user_created_idx" ON "provider_requests" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "provider_requests_kind_op_created_idx" ON "provider_requests" USING btree ("provider_kind","operation","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "users_verified_mobile_key" ON "users" USING btree ("mobile") WHERE "users"."mobile_verified_at" is not null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_mobile_verified_requires_mobile" CHECK ("users"."mobile_verified_at" is null or "users"."mobile" is not null);--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_languages_other_bound" CHECK (cardinality("creator_profiles"."languages_other") <= 5);--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_legal_name_source_valid" CHECK ("creator_profiles"."legal_name_source" in ('self_declared', 'verified_lookup'));