CREATE TABLE "social_connection_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"provider" text NOT NULL,
	"state_hash" text NOT NULL,
	"analytics_opt_in" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_connection_requests_state_hash_format" CHECK ("social_connection_requests"."state_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "social_connection_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_professional_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"feature_version" text NOT NULL,
	"value_numeric" numeric(18, 6),
	"value_boolean" boolean,
	"unit" text NOT NULL,
	"source" text NOT NULL,
	"completeness" numeric(4, 3) NOT NULL,
	"confidence" text NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "creator_professional_features_key_format" CHECK ("creator_professional_features"."feature_key" ~ '^[a-z][a-z0-9_]{2,63}$'),
	CONSTRAINT "creator_professional_features_source_valid" CHECK ("creator_professional_features"."source" in ('verified', 'declared', 'derived')),
	CONSTRAINT "creator_professional_features_confidence_valid" CHECK ("creator_professional_features"."confidence" in ('low', 'medium', 'high')),
	CONSTRAINT "creator_professional_features_completeness_range" CHECK ("creator_professional_features"."completeness" between 0 and 1),
	CONSTRAINT "creator_professional_features_has_value" CHECK ("creator_professional_features"."value_numeric" is not null or "creator_professional_features"."value_boolean" is not null or "creator_professional_features"."completeness" = 0),
	CONSTRAINT "creator_professional_features_provenance_bounded" CHECK (jsonb_typeof("creator_professional_features"."provenance") = 'object' and pg_column_size("creator_professional_features"."provenance") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "creator_professional_features" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "professional_graph_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"engine_version" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"snapshot_count" integer NOT NULL,
	"trigger" text NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "professional_graph_runs_inputs_hash_format" CHECK ("professional_graph_runs"."inputs_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "professional_graph_runs_trigger_valid" CHECK ("professional_graph_runs"."trigger" in ('connection', 'manual', 'system'))
);
--> statement-breakpoint
ALTER TABLE "professional_graph_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "iam"."sessions" ADD COLUMN "client" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_social_accounts" ADD COLUMN "declared_handle" text;--> statement-breakpoint
ALTER TABLE "creator_social_accounts" ADD COLUMN "account_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_connection_requests" ADD CONSTRAINT "social_connection_requests_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connection_requests" ADD CONSTRAINT "social_connection_requests_platform_social_platforms_code_fk" FOREIGN KEY ("platform") REFERENCES "public"."social_platforms"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_professional_features" ADD CONSTRAINT "creator_professional_features_run_id_professional_graph_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."professional_graph_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_professional_features" ADD CONSTRAINT "creator_professional_features_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_graph_runs" ADD CONSTRAINT "professional_graph_runs_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_connection_requests_state_hash_key" ON "social_connection_requests" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "social_connection_requests_creator_idx" ON "social_connection_requests" USING btree ("creator_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "creator_professional_features_run_key" ON "creator_professional_features" USING btree ("run_id","feature_key");--> statement-breakpoint
CREATE INDEX "creator_professional_features_creator_idx" ON "creator_professional_features" USING btree ("creator_id","feature_key","computed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "professional_graph_runs_reproducible_key" ON "professional_graph_runs" USING btree ("creator_id","engine_version","inputs_hash");--> statement-breakpoint
CREATE INDEX "professional_graph_runs_creator_idx" ON "professional_graph_runs" USING btree ("creator_id","computed_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "iam"."sessions" ADD CONSTRAINT "sessions_client_valid" CHECK ("iam"."sessions"."client" in ('web', 'ios', 'android', 'api'));