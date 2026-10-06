CREATE SCHEMA "iam";
--> statement-breakpoint
CREATE TABLE "iam"."identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identities_email_normalised" CHECK ("iam"."identities"."email" = lower(btrim("iam"."identities"."email")))
);
--> statement-breakpoint
ALTER TABLE "iam"."identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "iam"."login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_attempts_email_hash_format" CHECK ("iam"."login_attempts"."email_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "iam"."login_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "iam"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_format" CHECK ("iam"."sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sessions_expiry_after_creation" CHECK ("iam"."sessions"."expires_at" > "iam"."sessions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "iam"."sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"mobile" text,
	"role" text DEFAULT 'creator' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('creator', 'risk_admin', 'super_admin')),
	CONSTRAINT "users_status_valid" CHECK ("users"."status" in ('active', 'suspended', 'deactivated')),
	CONSTRAINT "users_email_normalised" CHECK ("users"."email" = lower(btrim("users"."email"))),
	CONSTRAINT "users_mobile_e164" CHECK ("users"."mobile" is null or "users"."mobile" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_categories" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_categories_code_format" CHECK ("creator_categories"."code" ~ '^[a-z][a-z0-9_]{0,39}$')
);
--> statement-breakpoint
ALTER TABLE "creator_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_preferences" (
	"creator_id" uuid PRIMARY KEY NOT NULL,
	"preferred_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"brand_interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"travel_interest" boolean DEFAULT false NOT NULL,
	"pr_interest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_preferences_preferred_categories_bound" CHECK (cardinality("creator_preferences"."preferred_categories") <= 20),
	CONSTRAINT "creator_preferences_brand_interests_bound" CHECK (cardinality("creator_preferences"."brand_interests") <= 20)
);
--> statement-breakpoint
ALTER TABLE "creator_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"primary_creator_handle" text,
	"creator_category" text,
	"city" text,
	"state" text,
	"country" text DEFAULT 'IN' NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"creator_since" date,
	"legal_form" text,
	"gst_status" text,
	"gstin" text,
	"profile_status" text DEFAULT 'draft' NOT NULL,
	"last_completed_step" text DEFAULT 'about' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_profiles_legal_name_length" CHECK (char_length(btrim("creator_profiles"."legal_name")) between 2 and 120),
	CONSTRAINT "creator_profiles_display_name_length" CHECK (char_length(btrim("creator_profiles"."display_name")) between 1 and 60),
	CONSTRAINT "creator_profiles_handle_format" CHECK ("creator_profiles"."primary_creator_handle" is null or "creator_profiles"."primary_creator_handle" ~ '^[A-Za-z0-9._-]{2,64}$'),
	CONSTRAINT "creator_profiles_country_format" CHECK ("creator_profiles"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "creator_profiles_legal_form_valid" CHECK ("creator_profiles"."legal_form" is null or "creator_profiles"."legal_form" in ('individual', 'sole_proprietorship', 'partnership', 'llp', 'private_limited', 'one_person_company', 'other_entity')),
	CONSTRAINT "creator_profiles_gst_status_valid" CHECK ("creator_profiles"."gst_status" is null or "creator_profiles"."gst_status" in ('not_registered', 'registered', 'unknown_requires_review')),
	CONSTRAINT "creator_profiles_gstin_requires_registration" CHECK ("creator_profiles"."gstin" is null or "creator_profiles"."gst_status" = 'registered'),
	CONSTRAINT "creator_profiles_gstin_format" CHECK ("creator_profiles"."gstin" is null or "creator_profiles"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "creator_profiles_profile_status_valid" CHECK ("creator_profiles"."profile_status" in ('draft', 'completed', 'suspended')),
	CONSTRAINT "creator_profiles_last_step_valid" CHECK ("creator_profiles"."last_completed_step" in ('about', 'profile', 'business', 'interests', 'consent')),
	CONSTRAINT "creator_profiles_creator_since_floor" CHECK ("creator_profiles"."creator_since" is null or "creator_profiles"."creator_since" >= date '2000-01-01'),
	CONSTRAINT "creator_profiles_completed_is_whole" CHECK ("creator_profiles"."profile_status" <> 'completed' or (
        "creator_profiles"."creator_category" is not null
        and "creator_profiles"."legal_form" is not null
        and "creator_profiles"."gst_status" is not null
        and "creator_profiles"."last_completed_step" = 'consent'
        and "creator_profiles"."completed_at" is not null
      ))
);
--> statement-breakpoint
ALTER TABLE "creator_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_account_id" text,
	"handle" text NOT NULL,
	"connection_status" text NOT NULL,
	"provider" text NOT NULL,
	"connected_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_social_accounts_status_valid" CHECK ("creator_social_accounts"."connection_status" in ('declared', 'pending', 'connected', 'error', 'disconnected')),
	CONSTRAINT "creator_social_accounts_handle_format" CHECK ("creator_social_accounts"."handle" ~ '^[A-Za-z0-9._-]{2,64}$'),
	CONSTRAINT "creator_social_accounts_provider_format" CHECK ("creator_social_accounts"."provider" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "creator_social_accounts_connected_has_timestamp" CHECK ("creator_social_accounts"."connection_status" <> 'connected' or "creator_social_accounts"."connected_at" is not null),
	CONSTRAINT "creator_social_accounts_disconnected_has_timestamp" CHECK ("creator_social_accounts"."connection_status" <> 'disconnected' or "creator_social_accounts"."disconnected_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "creator_social_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_social_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"social_account_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"followers" bigint,
	"subscribers" bigint,
	"views" bigint,
	"reach" bigint,
	"engagement_rate" numeric(9, 6),
	"posts_count" integer,
	"raw_payload_ref" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_social_snapshots_source_valid" CHECK ("creator_social_snapshots"."source" in ('provider', 'manual')),
	CONSTRAINT "creator_social_snapshots_non_negative" CHECK (coalesce("creator_social_snapshots"."followers", 0) >= 0 and coalesce("creator_social_snapshots"."subscribers", 0) >= 0
        and coalesce("creator_social_snapshots"."views", 0) >= 0 and coalesce("creator_social_snapshots"."reach", 0) >= 0
        and coalesce("creator_social_snapshots"."posts_count", 0) >= 0 and coalesce("creator_social_snapshots"."engagement_rate", 0) >= 0),
	CONSTRAINT "creator_social_snapshots_payload_ref_is_reference" CHECK ("creator_social_snapshots"."raw_payload_ref" is null or (char_length("creator_social_snapshots"."raw_payload_ref") <= 512 and "creator_social_snapshots"."raw_payload_ref" !~ '[{}]'))
);
--> statement-breakpoint
ALTER TABLE "creator_social_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "social_platforms" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_platforms_code_format" CHECK ("social_platforms"."code" ~ '^[a-z][a-z0-9_]{0,39}$')
);
--> statement-breakpoint
ALTER TABLE "social_platforms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consent_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"purpose" text NOT NULL,
	"body" text NOT NULL,
	"active_from" timestamp with time zone NOT NULL,
	"active_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_definitions_key_format" CHECK ("consent_definitions"."key" ~ '^[a-z][a-z0-9_]{2,63}$'),
	CONSTRAINT "consent_definitions_version_positive" CHECK ("consent_definitions"."version" > 0),
	CONSTRAINT "consent_definitions_window_valid" CHECK ("consent_definitions"."active_to" is null or "consent_definitions"."active_to" > "consent_definitions"."active_from")
);
--> statement-breakpoint
ALTER TABLE "consent_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consent_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_definition_id" uuid NOT NULL,
	"status" text NOT NULL,
	"granted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"source" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_receipts_status_valid" CHECK ("consent_receipts"."status" in ('granted', 'withdrawn')),
	CONSTRAINT "consent_receipts_source_valid" CHECK ("consent_receipts"."source" in ('onboarding', 'settings', 'system')),
	CONSTRAINT "consent_receipts_status_timestamps" CHECK (("consent_receipts"."status" = 'granted' and "consent_receipts"."granted_at" is not null and "consent_receipts"."withdrawn_at" is null)
        or ("consent_receipts"."status" = 'withdrawn' and "consent_receipts"."withdrawn_at" is not null)),
	CONSTRAINT "consent_receipts_metadata_bounded" CHECK (jsonb_typeof("consent_receipts"."metadata") = 'object' and pg_column_size("consent_receipts"."metadata") <= 1024)
);
--> statement-breakpoint
ALTER TABLE "consent_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_actor_type_valid" CHECK ("audit_events"."actor_type" in ('user', 'system')),
	CONSTRAINT "audit_events_event_type_format" CHECK ("audit_events"."event_type" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
	CONSTRAINT "audit_events_entity_type_format" CHECK ("audit_events"."entity_type" ~ '^[a-z][a-z_]*$'),
	CONSTRAINT "audit_events_metadata_bounded" CHECK (jsonb_typeof("audit_events"."metadata") = 'object' and pg_column_size("audit_events"."metadata") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "iam"."sessions" ADD CONSTRAINT "sessions_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "iam"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_user_id_identities_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "iam"."identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_preferences" ADD CONSTRAINT "creator_preferences_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_creator_category_creator_categories_code_fk" FOREIGN KEY ("creator_category") REFERENCES "public"."creator_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_social_accounts" ADD CONSTRAINT "creator_social_accounts_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_social_accounts" ADD CONSTRAINT "creator_social_accounts_platform_social_platforms_code_fk" FOREIGN KEY ("platform") REFERENCES "public"."social_platforms"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_social_snapshots" ADD CONSTRAINT "creator_social_snapshots_social_account_id_creator_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."creator_social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_receipts" ADD CONSTRAINT "consent_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_receipts" ADD CONSTRAINT "consent_receipts_consent_definition_id_consent_definitions_id_fk" FOREIGN KEY ("consent_definition_id") REFERENCES "public"."consent_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_email_key" ON "iam"."identities" USING btree ("email");--> statement-breakpoint
CREATE INDEX "login_attempts_email_hash_created_at_idx" ON "iam"."login_attempts" USING btree ("email_hash","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "iam"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_identity_id_idx" ON "iam"."sessions" USING btree ("identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_user_id_key" ON "users" USING btree ("auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_profiles_user_id_key" ON "creator_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "creator_profiles_category_idx" ON "creator_profiles" USING btree ("creator_category");--> statement-breakpoint
CREATE INDEX "creator_profiles_gst_status_idx" ON "creator_profiles" USING btree ("gst_status");--> statement-breakpoint
CREATE INDEX "creator_profiles_profile_status_idx" ON "creator_profiles" USING btree ("profile_status");--> statement-breakpoint
CREATE INDEX "creator_profiles_primary_handle_idx" ON "creator_profiles" USING btree (lower("primary_creator_handle"));--> statement-breakpoint
CREATE INDEX "creator_social_accounts_creator_id_idx" ON "creator_social_accounts" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_social_accounts_active_handle_key" ON "creator_social_accounts" USING btree ("creator_id","platform",lower("handle")) WHERE "creator_social_accounts"."connection_status" <> 'disconnected';--> statement-breakpoint
CREATE UNIQUE INDEX "creator_social_accounts_external_account_key" ON "creator_social_accounts" USING btree ("provider","platform","external_account_id") WHERE "creator_social_accounts"."external_account_id" is not null and "creator_social_accounts"."connection_status" <> 'disconnected';--> statement-breakpoint
CREATE INDEX "creator_social_snapshots_account_captured_idx" ON "creator_social_snapshots" USING btree ("social_account_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "creator_social_snapshots_idempotency_key" ON "creator_social_snapshots" USING btree ("social_account_id","captured_at","source");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_definitions_key_version_key" ON "consent_definitions" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_definitions_one_open_version_key" ON "consent_definitions" USING btree ("key") WHERE "consent_definitions"."active_to" is null;--> statement-breakpoint
CREATE INDEX "consent_receipts_user_id_idx" ON "consent_receipts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_receipts_one_active_grant_key" ON "consent_receipts" USING btree ("user_id","consent_definition_id") WHERE "consent_receipts"."status" = 'granted';--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_event_type_idx" ON "audit_events" USING btree ("event_type","created_at" DESC NULLS LAST);