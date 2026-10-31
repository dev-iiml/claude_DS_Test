CREATE TABLE "ops"."feature_switches" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_switches_key_format" CHECK ("ops"."feature_switches"."key" ~ '^[a-z][a-z0-9_]{1,39}$')
);
--> statement-breakpoint
ALTER TABLE "ops"."feature_switches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"directory_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_aliases_format" CHECK ("brand_aliases"."alias" ~ '^[a-z0-9 ]{1,80}$')
);
--> statement-breakpoint
ALTER TABLE "brand_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_directory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"industry_code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_directory_status_valid" CHECK ("brand_directory"."status" in ('active', 'merged')),
	CONSTRAINT "brand_directory_name_length" CHECK (char_length("brand_directory"."canonical_name") between 2 and 80),
	CONSTRAINT "brand_directory_merge_shape" CHECK (("brand_directory"."status" = 'merged') = ("brand_directory"."merged_into" is not null))
);
--> statement-breakpoint
ALTER TABLE "brand_directory" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_directory_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_id" uuid NOT NULL,
	"into_id" uuid NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"proposed_by" uuid,
	"decided_by" uuid,
	"proposed_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "brand_directory_merges_status_valid" CHECK ("brand_directory_merges"."status" in ('proposed', 'approved', 'declined')),
	CONSTRAINT "brand_directory_merges_distinct" CHECK ("brand_directory_merges"."from_id" <> "brand_directory_merges"."into_id"),
	CONSTRAINT "brand_directory_merges_four_eyes" CHECK ("brand_directory_merges"."decided_by" is null or "brand_directory_merges"."decided_by" <> "brand_directory_merges"."proposed_by")
);
--> statement-breakpoint
ALTER TABLE "brand_directory_merges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_industries" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_industries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_work_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"storage_provider" text NOT NULL,
	"sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"scan_status" text DEFAULT 'pending' NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_work_documents_kind_valid" CHECK ("brand_work_documents"."kind" in ('invoice', 'purchase_order', 'agreement', 'remittance_advice')),
	CONSTRAINT "brand_work_documents_scan_valid" CHECK ("brand_work_documents"."scan_status" in ('pending', 'clean', 'rejected')),
	CONSTRAINT "brand_work_documents_sha_format" CHECK ("brand_work_documents"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "brand_work_documents_key_format" CHECK ("brand_work_documents"."storage_key" ~ '^bw/[0-9a-f]{32}$'),
	CONSTRAINT "brand_work_documents_mime_valid" CHECK ("brand_work_documents"."mime_type" in ('application/pdf', 'image/jpeg', 'image/png')),
	CONSTRAINT "brand_work_documents_size_range" CHECK ("brand_work_documents"."size_bytes" between 1 and 10485760)
);
--> statement-breakpoint
ALTER TABLE "brand_work_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_work_reasons" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"creator_message" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_work_reasons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_work_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"end_brand_name" text NOT NULL,
	"brand_directory_id" uuid,
	"billed_party_type" text NOT NULL,
	"billed_party_name" text NOT NULL,
	"industry_code" text,
	"industry_confirmed" boolean DEFAULT false NOT NULL,
	"platforms" text[] NOT NULL,
	"deliverables" text[] NOT NULL,
	"visibility" text DEFAULT 'show_on_passport' NOT NULL,
	"description" text NOT NULL,
	"deliverables_summary" text,
	"work_date" date NOT NULL,
	"invoice_date" date,
	"invoice_amount_paise" bigint,
	"currency" text DEFAULT 'INR' NOT NULL,
	"verification_status" text DEFAULT 'draft' NOT NULL,
	"payment_status" text DEFAULT 'unconfirmed' NOT NULL,
	"payment_confirmation_method" text,
	"payment_confirmed_month" date,
	"requested_confirmation" text,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"rules_version" text,
	"reason_code" text,
	"assigned_to" uuid,
	"assigned_until" timestamp with time zone,
	"first_reviewer_id" uuid,
	"second_reviewer_id" uuid,
	"consent_receipt_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"payment_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_work_records_status_valid" CHECK ("brand_work_records"."verification_status" in ('draft', 'submitted', 'in_review', 'needs_info', 'verified', 'rejected')),
	CONSTRAINT "brand_work_records_payment_valid" CHECK ("brand_work_records"."payment_status" in ('unconfirmed', 'confirmed', 'not_seen')),
	CONSTRAINT "brand_work_records_method_valid" CHECK ("brand_work_records"."payment_confirmation_method" is null or "brand_work_records"."payment_confirmation_method" in ('agency_confirmation', 'remittance_advice', 'aa_match')),
	CONSTRAINT "brand_work_records_requested_valid" CHECK ("brand_work_records"."requested_confirmation" is null or "brand_work_records"."requested_confirmation" in ('agency_confirmation', 'remittance_advice', 'aa_match')),
	CONSTRAINT "brand_work_records_billed_valid" CHECK ("brand_work_records"."billed_party_type" in ('brand', 'agency', 'platform')),
	CONSTRAINT "brand_work_records_visibility_valid" CHECK ("brand_work_records"."visibility" in ('show_on_passport', 'private')),
	CONSTRAINT "brand_work_records_currency" CHECK ("brand_work_records"."currency" = 'INR'),
	CONSTRAINT "brand_work_records_amount_range" CHECK ("brand_work_records"."invoice_amount_paise" is null or "brand_work_records"."invoice_amount_paise" between 1 and 1000000000000),
	CONSTRAINT "brand_work_records_brand_length" CHECK (char_length("brand_work_records"."end_brand_name") between 2 and 80),
	CONSTRAINT "brand_work_records_billed_length" CHECK (char_length("brand_work_records"."billed_party_name") between 2 and 80),
	CONSTRAINT "brand_work_records_description_length" CHECK (char_length("brand_work_records"."description") between 3 and 280),
	CONSTRAINT "brand_work_records_summary_length" CHECK ("brand_work_records"."deliverables_summary" is null or char_length("brand_work_records"."deliverables_summary") <= 280),
	CONSTRAINT "brand_work_records_payment_shape" CHECK (("brand_work_records"."payment_status" = 'confirmed') = ("brand_work_records"."payment_confirmation_method" is not null and "brand_work_records"."payment_confirmed_month" is not null)),
	CONSTRAINT "brand_work_records_confirmed_needs_verified" CHECK ("brand_work_records"."payment_status" = 'unconfirmed' or "brand_work_records"."verification_status" = 'verified'),
	CONSTRAINT "brand_work_records_month_first" CHECK ("brand_work_records"."payment_confirmed_month" is null or extract(day from "brand_work_records"."payment_confirmed_month") = 1),
	CONSTRAINT "brand_work_records_four_eyes" CHECK ("brand_work_records"."second_reviewer_id" is null or "brand_work_records"."second_reviewer_id" <> "brand_work_records"."first_reviewer_id")
);
--> statement-breakpoint
ALTER TABLE "brand_work_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_work_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"proposed_by" uuid,
	"decided_by" uuid,
	"proposed_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "brand_work_reversals_status_valid" CHECK ("brand_work_reversals"."status" in ('proposed', 'approved', 'declined')),
	CONSTRAINT "brand_work_reversals_four_eyes" CHECK ("brand_work_reversals"."decided_by" is null or "brand_work_reversals"."decided_by" <> "brand_work_reversals"."proposed_by")
);
--> statement-breakpoint
ALTER TABLE "brand_work_reversals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_work_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"action" text NOT NULL,
	"reason_code" text,
	"note" text,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "brand_work_reviews_action_valid" CHECK ("brand_work_reviews"."action" in ('assign', 'verify', 'second_verify', 'request_info', 'reject', 'record_agency_confirmation', 'record_remittance_advice', 'propose_reversal', 'approve_reversal', 'decline_reversal', 'resolve_brand')),
	CONSTRAINT "brand_work_reviews_note_length" CHECK ("brand_work_reviews"."note" is null or char_length("brand_work_reviews"."note") <= 280)
);
--> statement-breakpoint
ALTER TABLE "brand_work_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_notices" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"on_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_notices_user_id_kind_pk" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "creator_notices_kind_valid" CHECK ("creator_notices"."kind" in ('aa_consent_ending', 'aa_data_life_ended'))
);
--> statement-breakpoint
ALTER TABLE "creator_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_valid";--> statement-breakpoint
ALTER TABLE "data_erasure_requests" DROP CONSTRAINT "data_erasure_requests_scope_valid";--> statement-breakpoint
ALTER TABLE "ops"."integration_change_requests" DROP CONSTRAINT "integration_change_requests_action_valid";--> statement-breakpoint
ALTER TABLE "ops"."integration_change_requests" DROP CONSTRAINT "integration_change_requests_kind_valid";--> statement-breakpoint
ALTER TABLE "ops"."jobs" DROP CONSTRAINT "jobs_type_valid";--> statement-breakpoint
ALTER TABLE "ops"."provider_configs" DROP CONSTRAINT "provider_configs_kind_valid";--> statement-breakpoint
ALTER TABLE "ops"."provider_routes" DROP CONSTRAINT "provider_routes_kind_valid";--> statement-breakpoint
ALTER TABLE "analytics"."events" DROP CONSTRAINT "analytics_events_event_valid";--> statement-breakpoint
ALTER TABLE "ops"."feature_switches" ADD CONSTRAINT "feature_switches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_aliases" ADD CONSTRAINT "brand_aliases_directory_id_brand_directory_id_fk" FOREIGN KEY ("directory_id") REFERENCES "public"."brand_directory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_aliases" ADD CONSTRAINT "brand_aliases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_directory" ADD CONSTRAINT "brand_directory_industry_code_brand_industries_code_fk" FOREIGN KEY ("industry_code") REFERENCES "public"."brand_industries"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_directory" ADD CONSTRAINT "brand_directory_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_directory_merges" ADD CONSTRAINT "brand_directory_merges_from_id_brand_directory_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."brand_directory"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_directory_merges" ADD CONSTRAINT "brand_directory_merges_into_id_brand_directory_id_fk" FOREIGN KEY ("into_id") REFERENCES "public"."brand_directory"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_directory_merges" ADD CONSTRAINT "brand_directory_merges_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_directory_merges" ADD CONSTRAINT "brand_directory_merges_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_documents" ADD CONSTRAINT "brand_work_documents_record_id_brand_work_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."brand_work_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_documents" ADD CONSTRAINT "brand_work_documents_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_records" ADD CONSTRAINT "brand_work_records_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_records" ADD CONSTRAINT "brand_work_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_records" ADD CONSTRAINT "brand_work_records_brand_directory_id_brand_directory_id_fk" FOREIGN KEY ("brand_directory_id") REFERENCES "public"."brand_directory"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_records" ADD CONSTRAINT "brand_work_records_industry_code_brand_industries_code_fk" FOREIGN KEY ("industry_code") REFERENCES "public"."brand_industries"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_records" ADD CONSTRAINT "brand_work_records_reason_code_brand_work_reasons_code_fk" FOREIGN KEY ("reason_code") REFERENCES "public"."brand_work_reasons"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_records" ADD CONSTRAINT "brand_work_records_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_records" ADD CONSTRAINT "brand_work_records_first_reviewer_id_users_id_fk" FOREIGN KEY ("first_reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_records" ADD CONSTRAINT "brand_work_records_second_reviewer_id_users_id_fk" FOREIGN KEY ("second_reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_records" ADD CONSTRAINT "brand_work_records_consent_receipt_id_consent_receipts_id_fk" FOREIGN KEY ("consent_receipt_id") REFERENCES "public"."consent_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_reversals" ADD CONSTRAINT "brand_work_reversals_record_id_brand_work_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."brand_work_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_reversals" ADD CONSTRAINT "brand_work_reversals_reason_code_brand_work_reasons_code_fk" FOREIGN KEY ("reason_code") REFERENCES "public"."brand_work_reasons"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_reversals" ADD CONSTRAINT "brand_work_reversals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_reversals" ADD CONSTRAINT "brand_work_reversals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_reviews" ADD CONSTRAINT "brand_work_reviews_record_id_brand_work_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."brand_work_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_reviews" ADD CONSTRAINT "brand_work_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_work_reviews" ADD CONSTRAINT "brand_work_reviews_reason_code_brand_work_reasons_code_fk" FOREIGN KEY ("reason_code") REFERENCES "public"."brand_work_reasons"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_notices" ADD CONSTRAINT "creator_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_aliases_directory_idx" ON "brand_aliases" USING btree ("directory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_directory_merges_open_key" ON "brand_directory_merges" USING btree ("from_id") WHERE "brand_directory_merges"."status" = 'proposed';--> statement-breakpoint
CREATE INDEX "brand_work_documents_record_idx" ON "brand_work_documents" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "brand_work_documents_sha_idx" ON "brand_work_documents" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_work_documents_record_sha_key" ON "brand_work_documents" USING btree ("record_id","sha256");--> statement-breakpoint
CREATE INDEX "brand_work_records_creator_idx" ON "brand_work_records" USING btree ("creator_id","work_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "brand_work_records_queue_idx" ON "brand_work_records" USING btree ("verification_status","submitted_at");--> statement-breakpoint
CREATE INDEX "brand_work_records_directory_idx" ON "brand_work_records" USING btree ("brand_directory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_work_reversals_open_key" ON "brand_work_reversals" USING btree ("record_id") WHERE "brand_work_reversals"."status" = 'proposed';--> statement-breakpoint
CREATE INDEX "brand_work_reviews_record_idx" ON "brand_work_reviews" USING btree ("record_id","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('creator', 'risk_admin', 'ops_admin', 'partnerships_admin', 'analyst', 'brand_work_reviewer', 'super_admin'));--> statement-breakpoint
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_scope_valid" CHECK ("data_erasure_requests"."scope" in ('social_account_data', 'professional_graph', 'identity_lookup', 'financial_inputs', 'access_requests', 'product_analytics_events', 'financial_funnel_events', 'brand_work_records', 'brand_payment_matches'));--> statement-breakpoint
ALTER TABLE "ops"."integration_change_requests" ADD CONSTRAINT "integration_change_requests_action_valid" CHECK ("ops"."integration_change_requests"."action" in ('create_config', 'update_config', 'set_route', 'pause_kind', 'resume_kind', 'set_feature'));--> statement-breakpoint
ALTER TABLE "ops"."integration_change_requests" ADD CONSTRAINT "integration_change_requests_kind_valid" CHECK ("ops"."integration_change_requests"."kind" in ('social', 'identity', 'identity_lookup', 'tax_registration', 'notification', 'bureau', 'financial_data', 'lender', 'document_storage', 'file_scan'));--> statement-breakpoint
ALTER TABLE "ops"."jobs" ADD CONSTRAINT "jobs_type_valid" CHECK ("ops"."jobs"."type" in ('expire_stale_applications', 'process_deferred_erasures', 'provider_health_check', 'purge_expired_fi_data', 'process_lender_proposals', 'deliver_partner_webhooks', 'expire_access_requests', 'analytics_maintenance', 'rate_limit_purge', 'purge_auth_records', 'grant_membership_milestones', 'brand_work_scan_document', 'brand_work_erase_documents', 'brand_work_consent_reminders'));--> statement-breakpoint
ALTER TABLE "ops"."provider_configs" ADD CONSTRAINT "provider_configs_kind_valid" CHECK ("ops"."provider_configs"."kind" in ('social', 'identity', 'identity_lookup', 'tax_registration', 'notification', 'bureau', 'financial_data', 'lender', 'document_storage', 'file_scan'));--> statement-breakpoint
ALTER TABLE "ops"."provider_routes" ADD CONSTRAINT "provider_routes_kind_valid" CHECK ("ops"."provider_routes"."kind" in ('social', 'identity', 'identity_lookup', 'tax_registration', 'notification', 'bureau', 'financial_data', 'lender', 'document_storage', 'file_scan'));--> statement-breakpoint
ALTER TABLE "analytics"."events" ADD CONSTRAINT "analytics_events_event_valid" CHECK ("analytics"."events"."event" in ('landing_viewed', 'application_started', 'account_created', 'creator_profile_completed', 'social_connection_started', 'social_connection_completed', 'passport_generated', 'status_generated', 'financial_eligibility_started', 'financial_consent_granted', 'financial_inputs_completed', 'underwriting_started', 'underwriting_completed', 'offer_generated', 'offer_viewed', 'simulated_offer_accepted', 'offer_accepted', 'offer_declined', 'access_opportunity_viewed', 'access_requested', 'brand_work_record_created', 'brand_work_submitted', 'brand_work_verified', 'brand_work_payment_confirmed'));