CREATE TABLE "ops"."platform_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_limits_key_format" CHECK ("ops"."platform_limits"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "platform_limits_value_bound" CHECK ("ops"."platform_limits"."value" between 0 and 100000)
);
--> statement-breakpoint
ALTER TABLE "ops"."platform_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_email_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_email_challenges_hash_format" CHECK ("brand_email_challenges"."code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "brand_email_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_org_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"directory_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_by" uuid,
	"approved_by" uuid,
	"logo_key" text,
	"logo_mime" text,
	"logo_provider" text,
	"logo_scan" text,
	"logo_status" text,
	"logo_verified_by" uuid,
	"logo_approved_by" uuid,
	"logo_licence_accepted_by" uuid,
	"logo_licence_accepted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_org_claims_status_valid" CHECK ("brand_org_claims"."status" in ('pending', 'verified', 'approved', 'rejected')),
	CONSTRAINT "brand_org_claims_logo_status_valid" CHECK ("brand_org_claims"."logo_status" is null or "brand_org_claims"."logo_status" in ('pending', 'verified', 'approved', 'rejected')),
	CONSTRAINT "brand_org_claims_logo_key_format" CHECK ("brand_org_claims"."logo_key" is null or "brand_org_claims"."logo_key" ~ '^lg/[0-9a-f]{32}$'),
	CONSTRAINT "brand_org_claims_logo_scan_valid" CHECK ("brand_org_claims"."logo_scan" is null or "brand_org_claims"."logo_scan" in ('pending', 'clean', 'rejected')),
	CONSTRAINT "brand_org_claims_logo_shape" CHECK (("brand_org_claims"."logo_key" is null) = ("brand_org_claims"."logo_status" is null)
        and ("brand_org_claims"."logo_key" is null) = ("brand_org_claims"."logo_provider" is null)
        and ("brand_org_claims"."logo_key" is null or ("brand_org_claims"."logo_licence_accepted_by" is not null and "brand_org_claims"."logo_licence_accepted_at" is not null))),
	CONSTRAINT "brand_org_claims_four_eyes" CHECK (("brand_org_claims"."approved_by" is null or ("brand_org_claims"."verified_by" is not null and "brand_org_claims"."approved_by" <> "brand_org_claims"."verified_by"))
        and ("brand_org_claims"."logo_approved_by" is null or ("brand_org_claims"."logo_verified_by" is not null and "brand_org_claims"."logo_approved_by" <> "brand_org_claims"."logo_verified_by")))
);
--> statement-breakpoint
ALTER TABLE "brand_org_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_org_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_org_invites_token_format" CHECK ("brand_org_invites"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "brand_org_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"terms_version" integer,
	"terms_accepted_at" timestamp with time zone,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_org_members_role_valid" CHECK ("brand_org_members"."org_role" in ('owner', 'member')),
	CONSTRAINT "brand_org_members_status_valid" CHECK ("brand_org_members"."status" in ('active', 'removed')),
	CONSTRAINT "brand_org_members_terms_shape" CHECK (("brand_org_members"."terms_version" is null) = ("brand_org_members"."terms_accepted_at" is null))
);
--> statement-breakpoint
ALTER TABLE "brand_org_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_org_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"target" text NOT NULL,
	"target_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason_code" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_org_reviews_target_valid" CHECK ("brand_org_reviews"."target" in ('org', 'claim', 'logo')),
	CONSTRAINT "brand_org_reviews_action_valid" CHECK ("brand_org_reviews"."action" in ('verify', 'approve', 'reject', 'propose_suspend', 'approve_suspend', 'propose_reinstate', 'approve_reinstate', 'set_quota', 'link_access_brand')),
	CONSTRAINT "brand_org_reviews_reason_format" CHECK ("brand_org_reviews"."reason_code" is null or "brand_org_reviews"."reason_code" ~ '^[a-z_]{2,40}$')
);
--> statement-breakpoint
ALTER TABLE "brand_org_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"org_type" text NOT NULL,
	"website" text NOT NULL,
	"email_domain" text NOT NULL,
	"identifier_type" text NOT NULL,
	"identifier_value" text NOT NULL,
	"gstin_fingerprint" text,
	"gstin_state_code" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"lookup_legal_name" text,
	"lookup_status" text,
	"lookup_incorporated_on" date,
	"lookup_provider" text,
	"lookup_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"pending_action" text,
	"pending_by" uuid,
	"daily_unlock_quota" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_orgs_type_valid" CHECK ("brand_orgs"."org_type" in ('brand', 'agency')),
	CONSTRAINT "brand_orgs_status_valid" CHECK ("brand_orgs"."status" in ('pending', 'verified', 'rejected', 'suspended')),
	CONSTRAINT "brand_orgs_identifier_type_valid" CHECK ("brand_orgs"."identifier_type" in ('cin', 'llpin')),
	CONSTRAINT "brand_orgs_identifier_format" CHECK (("brand_orgs"."identifier_type" = 'cin' and "brand_orgs"."identifier_value" ~ '^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$')
        or ("brand_orgs"."identifier_type" = 'llpin' and "brand_orgs"."identifier_value" ~ '^[A-Z]{3}-[0-9]{4}$')),
	CONSTRAINT "brand_orgs_legal_name_length" CHECK (char_length("brand_orgs"."legal_name") between 2 and 120),
	CONSTRAINT "brand_orgs_website_format" CHECK ("brand_orgs"."website" ~ '^https?://' and char_length("brand_orgs"."website") <= 200),
	CONSTRAINT "brand_orgs_domain_format" CHECK ("brand_orgs"."email_domain" ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
	CONSTRAINT "brand_orgs_gstin_shape" CHECK (("brand_orgs"."gstin_fingerprint" is null) = ("brand_orgs"."gstin_state_code" is null)
        and ("brand_orgs"."gstin_fingerprint" is null or "brand_orgs"."gstin_fingerprint" ~ '^g1:[0-9a-f]{32}$')
        and ("brand_orgs"."gstin_state_code" is null or "brand_orgs"."gstin_state_code" ~ '^[0-9]{2}$')),
	CONSTRAINT "brand_orgs_four_eyes" CHECK ("brand_orgs"."approved_by" is null or ("brand_orgs"."verified_by" is not null and "brand_orgs"."approved_by" <> "brand_orgs"."verified_by")),
	CONSTRAINT "brand_orgs_verified_shape" CHECK ("brand_orgs"."status" <> 'verified' or "brand_orgs"."approved_by" is not null),
	CONSTRAINT "brand_orgs_pending_action_valid" CHECK ("brand_orgs"."pending_action" is null or "brand_orgs"."pending_action" in ('suspend', 'reinstate')),
	CONSTRAINT "brand_orgs_quota_bound" CHECK ("brand_orgs"."daily_unlock_quota" is null or "brand_orgs"."daily_unlock_quota" between 0 and 500)
);
--> statement-breakpoint
ALTER TABLE "brand_orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "passport_access_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_id" uuid NOT NULL,
	"label" text NOT NULL,
	"code_hash" text NOT NULL,
	"code_hint" text NOT NULL,
	"org_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passport_access_codes_hash_format" CHECK ("passport_access_codes"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "passport_access_codes_hint_format" CHECK ("passport_access_codes"."code_hint" ~ '^[0-9A-Z]{4}$'),
	CONSTRAINT "passport_access_codes_label_length" CHECK (char_length("passport_access_codes"."label") between 1 and 60),
	CONSTRAINT "passport_access_codes_max_uses_bound" CHECK ("passport_access_codes"."max_uses" is null or "passport_access_codes"."max_uses" between 1 and 1000),
	CONSTRAINT "passport_access_codes_uses_bound" CHECK ("passport_access_codes"."uses" >= 0 and ("passport_access_codes"."max_uses" is null or "passport_access_codes"."uses" <= "passport_access_codes"."max_uses"))
);
--> statement-breakpoint
ALTER TABLE "passport_access_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "passport_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code_id" uuid,
	"code_label" text,
	"org_id" uuid,
	"viewer_name" text,
	"viewer_company" text,
	"ip_pseudonym" text,
	"day" date NOT NULL,
	"hour" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passport_access_log_kind_valid" CHECK ("passport_access_log"."kind" in ('code', 'brand', 'lockout')),
	CONSTRAINT "passport_access_log_hour_bound" CHECK ("passport_access_log"."hour" between 0 and 23),
	CONSTRAINT "passport_access_log_ip_format" CHECK ("passport_access_log"."ip_pseudonym" is null or "passport_access_log"."ip_pseudonym" ~ '^ip1:[0-9a-f]{32}$'),
	CONSTRAINT "passport_access_log_name_length" CHECK ("passport_access_log"."viewer_name" is null or char_length("passport_access_log"."viewer_name") <= 60),
	CONSTRAINT "passport_access_log_company_length" CHECK ("passport_access_log"."viewer_company" is null or char_length("passport_access_log"."viewer_company") <= 80),
	CONSTRAINT "passport_access_log_shape" CHECK ("passport_access_log"."kind" <> 'brand' or "passport_access_log"."org_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "passport_access_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "passport_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passport_reports_reason_valid" CHECK ("passport_reports"."reason" in ('impersonation', 'inaccurate', 'offensive', 'privacy', 'other')),
	CONSTRAINT "passport_reports_status_valid" CHECK ("passport_reports"."status" in ('open', 'dismissed', 'actioned'))
);
--> statement-breakpoint
ALTER TABLE "passport_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "passport_takedowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"taken_by" uuid,
	"proposed_by" uuid,
	"approved_by" uuid,
	"lifted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passport_takedowns_status_valid" CHECK ("passport_takedowns"."status" in ('offline', 'permanent_proposed', 'permanent', 'lifted')),
	CONSTRAINT "passport_takedowns_reason_valid" CHECK ("passport_takedowns"."reason" in ('impersonation', 'inaccurate', 'offensive', 'privacy', 'other')),
	CONSTRAINT "passport_takedowns_four_eyes" CHECK (("passport_takedowns"."status" <> 'permanent' or ("passport_takedowns"."proposed_by" is not null and "passport_takedowns"."approved_by" is not null))
        and ("passport_takedowns"."approved_by" is null or "passport_takedowns"."approved_by" <> "passport_takedowns"."proposed_by"))
);
--> statement-breakpoint
ALTER TABLE "passport_takedowns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "public_passport_slug_redirects" (
	"slug" text PRIMARY KEY NOT NULL,
	"passport_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_passport_slug_redirects_format" CHECK ("public_passport_slug_redirects"."slug" ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$')
);
--> statement-breakpoint
ALTER TABLE "public_passport_slug_redirects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "public_passports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"field_tiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bio" text,
	"photo_key" text,
	"photo_mime" text,
	"photo_provider" text,
	"photo_scan" text,
	"audience" text DEFAULT 'code_holders_only' NOT NULL,
	"indexable" boolean DEFAULT false NOT NULL,
	"include_private_in_totals" boolean DEFAULT false NOT NULL,
	"discoverable" boolean DEFAULT false NOT NULL,
	"cache_version" integer DEFAULT 1 NOT NULL,
	"code_failures" integer DEFAULT 0 NOT NULL,
	"code_failures_since" timestamp with time zone,
	"code_locked_until" timestamp with time zone,
	"published_at" timestamp with time zone,
	"unpublished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_passports_status_valid" CHECK ("public_passports"."status" in ('draft', 'published', 'unpublished')),
	CONSTRAINT "public_passports_audience_valid" CHECK ("public_passports"."audience" in ('code_holders_only', 'code_holders_and_verified_brands')),
	CONSTRAINT "public_passports_slug_format" CHECK ("public_passports"."slug" is null or ("public_passports"."slug" ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' and "public_passports"."slug" !~ '--')),
	CONSTRAINT "public_passports_published_shape" CHECK ("public_passports"."status" <> 'published' or "public_passports"."slug" is not null),
	CONSTRAINT "public_passports_tiers_shape" CHECK (jsonb_typeof("public_passports"."field_tiers") = 'object' and pg_column_size("public_passports"."field_tiers") <= 1024),
	CONSTRAINT "public_passports_bio_length" CHECK ("public_passports"."bio" is null or char_length("public_passports"."bio") <= 280),
	CONSTRAINT "public_passports_photo_key_format" CHECK ("public_passports"."photo_key" is null or "public_passports"."photo_key" ~ '^pp/[0-9a-f]{32}$'),
	CONSTRAINT "public_passports_photo_shape" CHECK (("public_passports"."photo_key" is null) = ("public_passports"."photo_scan" is null) and ("public_passports"."photo_key" is null) = ("public_passports"."photo_mime" is null)
        and ("public_passports"."photo_key" is null) = ("public_passports"."photo_provider" is null)),
	CONSTRAINT "public_passports_photo_scan_valid" CHECK ("public_passports"."photo_scan" is null or "public_passports"."photo_scan" in ('pending', 'clean', 'rejected')),
	CONSTRAINT "public_passports_discoverable_shape" CHECK (not "public_passports"."discoverable" or "public_passports"."audience" = 'code_holders_and_verified_brands')
);
--> statement-breakpoint
ALTER TABLE "public_passports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_valid";--> statement-breakpoint
ALTER TABLE "data_erasure_requests" DROP CONSTRAINT "data_erasure_requests_scope_valid";--> statement-breakpoint
ALTER TABLE "ops"."integration_change_requests" DROP CONSTRAINT "integration_change_requests_action_valid";--> statement-breakpoint
ALTER TABLE "ops"."integration_change_requests" DROP CONSTRAINT "integration_change_requests_kind_valid";--> statement-breakpoint
ALTER TABLE "ops"."provider_configs" DROP CONSTRAINT "provider_configs_kind_valid";--> statement-breakpoint
ALTER TABLE "ops"."provider_routes" DROP CONSTRAINT "provider_routes_kind_valid";--> statement-breakpoint
ALTER TABLE "analytics"."events" DROP CONSTRAINT "analytics_events_event_valid";--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "brand_org_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."platform_limits" ADD CONSTRAINT "platform_limits_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_claims" ADD CONSTRAINT "brand_org_claims_org_id_brand_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."brand_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_claims" ADD CONSTRAINT "brand_org_claims_directory_id_brand_directory_id_fk" FOREIGN KEY ("directory_id") REFERENCES "public"."brand_directory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_claims" ADD CONSTRAINT "brand_org_claims_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_claims" ADD CONSTRAINT "brand_org_claims_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_claims" ADD CONSTRAINT "brand_org_claims_logo_verified_by_users_id_fk" FOREIGN KEY ("logo_verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_claims" ADD CONSTRAINT "brand_org_claims_logo_approved_by_users_id_fk" FOREIGN KEY ("logo_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_claims" ADD CONSTRAINT "brand_org_claims_logo_licence_accepted_by_users_id_fk" FOREIGN KEY ("logo_licence_accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_claims" ADD CONSTRAINT "brand_org_claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_invites" ADD CONSTRAINT "brand_org_invites_org_id_brand_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."brand_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_invites" ADD CONSTRAINT "brand_org_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_members" ADD CONSTRAINT "brand_org_members_org_id_brand_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."brand_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_members" ADD CONSTRAINT "brand_org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_members" ADD CONSTRAINT "brand_org_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_reviews" ADD CONSTRAINT "brand_org_reviews_org_id_brand_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."brand_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_org_reviews" ADD CONSTRAINT "brand_org_reviews_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_orgs" ADD CONSTRAINT "brand_orgs_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_orgs" ADD CONSTRAINT "brand_orgs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_orgs" ADD CONSTRAINT "brand_orgs_pending_by_users_id_fk" FOREIGN KEY ("pending_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_access_codes" ADD CONSTRAINT "passport_access_codes_passport_id_public_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."public_passports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_access_codes" ADD CONSTRAINT "passport_access_codes_org_id_brand_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."brand_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_access_log" ADD CONSTRAINT "passport_access_log_passport_id_public_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."public_passports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_access_log" ADD CONSTRAINT "passport_access_log_code_id_passport_access_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."passport_access_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_access_log" ADD CONSTRAINT "passport_access_log_org_id_brand_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."brand_orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_reports" ADD CONSTRAINT "passport_reports_passport_id_public_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."public_passports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_reports" ADD CONSTRAINT "passport_reports_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_takedowns" ADD CONSTRAINT "passport_takedowns_passport_id_public_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."public_passports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_takedowns" ADD CONSTRAINT "passport_takedowns_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_takedowns" ADD CONSTRAINT "passport_takedowns_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_takedowns" ADD CONSTRAINT "passport_takedowns_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_takedowns" ADD CONSTRAINT "passport_takedowns_lifted_by_users_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_passport_slug_redirects" ADD CONSTRAINT "public_passport_slug_redirects_passport_id_public_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."public_passports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_passports" ADD CONSTRAINT "public_passports_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_passports" ADD CONSTRAINT "public_passports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_email_challenges_email_idx" ON "brand_email_challenges" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "brand_org_claims_org_idx" ON "brand_org_claims" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_org_claims_directory_approved_key" ON "brand_org_claims" USING btree ("directory_id") WHERE "brand_org_claims"."status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "brand_org_invites_token_key" ON "brand_org_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "brand_org_invites_org_idx" ON "brand_org_invites" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_org_members_user_key" ON "brand_org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "brand_org_members_org_idx" ON "brand_org_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "brand_org_reviews_org_idx" ON "brand_org_reviews" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_orgs_identifier_key" ON "brand_orgs" USING btree ("identifier_type","identifier_value");--> statement-breakpoint
CREATE INDEX "brand_orgs_status_idx" ON "brand_orgs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "passport_access_codes_hash_key" ON "passport_access_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "passport_access_codes_passport_idx" ON "passport_access_codes" USING btree ("passport_id");--> statement-breakpoint
CREATE INDEX "passport_access_log_passport_idx" ON "passport_access_log" USING btree ("passport_id","created_at");--> statement-breakpoint
CREATE INDEX "passport_access_log_org_day_idx" ON "passport_access_log" USING btree ("org_id","day");--> statement-breakpoint
CREATE INDEX "passport_reports_status_idx" ON "passport_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "passport_takedowns_passport_idx" ON "passport_takedowns" USING btree ("passport_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passport_takedowns_active_key" ON "passport_takedowns" USING btree ("passport_id") WHERE "passport_takedowns"."status" in ('offline', 'permanent_proposed', 'permanent');--> statement-breakpoint
CREATE INDEX "public_passport_slug_redirects_passport_idx" ON "public_passport_slug_redirects" USING btree ("passport_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_passports_creator_key" ON "public_passports" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_passports_slug_key" ON "public_passports" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_brand_org_id_brand_orgs_id_fk" FOREIGN KEY ("brand_org_id") REFERENCES "public"."brand_orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('creator', 'risk_admin', 'ops_admin', 'partnerships_admin', 'analyst', 'brand_work_reviewer', 'super_admin', 'brand_member'));--> statement-breakpoint
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_scope_valid" CHECK ("data_erasure_requests"."scope" in ('social_account_data', 'professional_graph', 'identity_lookup', 'financial_inputs', 'access_requests', 'product_analytics_events', 'financial_funnel_events', 'brand_work_records', 'brand_payment_matches', 'public_passport_content'));--> statement-breakpoint
ALTER TABLE "ops"."integration_change_requests" ADD CONSTRAINT "integration_change_requests_action_valid" CHECK ("ops"."integration_change_requests"."action" in ('create_config', 'update_config', 'set_route', 'pause_kind', 'resume_kind', 'set_feature', 'set_limit'));--> statement-breakpoint
ALTER TABLE "ops"."integration_change_requests" ADD CONSTRAINT "integration_change_requests_kind_valid" CHECK ("ops"."integration_change_requests"."kind" in ('social', 'identity', 'identity_lookup', 'tax_registration', 'notification', 'bureau', 'financial_data', 'lender', 'document_storage', 'file_scan', 'business_verification'));--> statement-breakpoint
ALTER TABLE "ops"."provider_configs" ADD CONSTRAINT "provider_configs_kind_valid" CHECK ("ops"."provider_configs"."kind" in ('social', 'identity', 'identity_lookup', 'tax_registration', 'notification', 'bureau', 'financial_data', 'lender', 'document_storage', 'file_scan', 'business_verification'));--> statement-breakpoint
ALTER TABLE "ops"."provider_routes" ADD CONSTRAINT "provider_routes_kind_valid" CHECK ("ops"."provider_routes"."kind" in ('social', 'identity', 'identity_lookup', 'tax_registration', 'notification', 'bureau', 'financial_data', 'lender', 'document_storage', 'file_scan', 'business_verification'));--> statement-breakpoint
ALTER TABLE "analytics"."events" ADD CONSTRAINT "analytics_events_event_valid" CHECK ("analytics"."events"."event" in ('landing_viewed', 'application_started', 'account_created', 'creator_profile_completed', 'social_connection_started', 'social_connection_completed', 'passport_generated', 'status_generated', 'financial_eligibility_started', 'financial_consent_granted', 'financial_inputs_completed', 'underwriting_started', 'underwriting_completed', 'offer_generated', 'offer_viewed', 'simulated_offer_accepted', 'offer_accepted', 'offer_declined', 'access_opportunity_viewed', 'access_requested', 'brand_work_record_created', 'brand_work_submitted', 'brand_work_verified', 'brand_work_payment_confirmed', 'passport_published', 'passport_unpublished', 'passport_viewed', 'passport_code_created', 'passport_unlock_attempted', 'brand_org_signed_up', 'brand_org_verified', 'brand_discovery_searched'));