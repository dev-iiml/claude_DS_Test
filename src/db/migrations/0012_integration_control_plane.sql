CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE TABLE "ops"."integration_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"kind" text NOT NULL,
	"config_id" uuid,
	"payload" jsonb NOT NULL,
	"reason" text NOT NULL,
	"approval_required" boolean NOT NULL,
	"status" text NOT NULL,
	"base_route_version" integer,
	"base_config_version" integer,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"applied_at" timestamp with time zone,
	CONSTRAINT "integration_change_requests_action_valid" CHECK ("ops"."integration_change_requests"."action" in ('create_config', 'update_config', 'set_route', 'pause_kind', 'resume_kind')),
	CONSTRAINT "integration_change_requests_status_valid" CHECK ("ops"."integration_change_requests"."status" in ('pending', 'applied', 'rejected', 'cancelled', 'expired', 'superseded')),
	CONSTRAINT "integration_change_requests_kind_valid" CHECK ("ops"."integration_change_requests"."kind" in ('social', 'identity', 'identity_lookup', 'tax_registration', 'notification', 'bureau', 'financial_data', 'lender')),
	CONSTRAINT "integration_change_requests_payload_size" CHECK (pg_column_size("ops"."integration_change_requests"."payload") <= 4096),
	CONSTRAINT "integration_change_requests_reason_length" CHECK (char_length("ops"."integration_change_requests"."reason") between 4 and 500),
	CONSTRAINT "integration_change_requests_note_length" CHECK (char_length("ops"."integration_change_requests"."decision_note") <= 500),
	CONSTRAINT "integration_change_requests_four_eyes" CHECK ("ops"."integration_change_requests"."decided_by" is null or "ops"."integration_change_requests"."decided_by" <> "ops"."integration_change_requests"."requested_by" or "ops"."integration_change_requests"."status" = 'cancelled'),
	CONSTRAINT "integration_change_requests_pending_needs_approval" CHECK ("ops"."integration_change_requests"."status" <> 'pending' or "ops"."integration_change_requests"."approval_required"),
	CONSTRAINT "integration_change_requests_approved_by_someone" CHECK ("ops"."integration_change_requests"."status" <> 'applied' or not "ops"."integration_change_requests"."approval_required" or "ops"."integration_change_requests"."decided_by" is not null),
	CONSTRAINT "integration_change_requests_applied_state" CHECK (("ops"."integration_change_requests"."status" = 'applied') = ("ops"."integration_change_requests"."applied_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "ops"."integration_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"result" jsonb,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_type_valid" CHECK ("ops"."jobs"."type" in ('expire_stale_applications', 'process_deferred_erasures', 'provider_health_check')),
	CONSTRAINT "jobs_status_valid" CHECK ("ops"."jobs"."status" in ('queued', 'running', 'succeeded', 'dead')),
	CONSTRAINT "jobs_payload_size" CHECK (pg_column_size("ops"."jobs"."payload") <= 1024),
	CONSTRAINT "jobs_result_size" CHECK (pg_column_size("ops"."jobs"."result") <= 1024),
	CONSTRAINT "jobs_last_error_length" CHECK (char_length("ops"."jobs"."last_error") <= 300),
	CONSTRAINT "jobs_attempts_valid" CHECK ("ops"."jobs"."attempts" >= 0 and "ops"."jobs"."max_attempts" between 1 and 20),
	CONSTRAINT "jobs_running_locked" CHECK (("ops"."jobs"."status" = 'running') = ("ops"."jobs"."locked_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "ops"."jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."provider_call_stats" (
	"config_id" uuid NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"operation" text NOT NULL,
	"successes" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"rejections" integer DEFAULT 0 NOT NULL,
	"total_duration_ms" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "provider_call_stats_config_id_bucket_operation_pk" PRIMARY KEY("config_id","bucket","operation"),
	CONSTRAINT "provider_call_stats_operation_format" CHECK ("ops"."provider_call_stats"."operation" ~ '^[a-zA-Z][a-zA-Z0-9_]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "ops"."provider_call_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"adapter" text NOT NULL,
	"mode" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_configs_kind_id_uq" UNIQUE("kind","id"),
	CONSTRAINT "provider_configs_kind_valid" CHECK ("ops"."provider_configs"."kind" in ('social', 'identity', 'identity_lookup', 'tax_registration', 'notification', 'bureau', 'financial_data', 'lender')),
	CONSTRAINT "provider_configs_mode_valid" CHECK ("ops"."provider_configs"."mode" in ('mock', 'sandbox', 'live')),
	CONSTRAINT "provider_configs_key_format" CHECK ("ops"."provider_configs"."key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "provider_configs_adapter_format" CHECK ("ops"."provider_configs"."adapter" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "provider_configs_settings_size" CHECK (pg_column_size("ops"."provider_configs"."settings") <= 2048),
	CONSTRAINT "provider_configs_secret_refs_size" CHECK (pg_column_size("ops"."provider_configs"."secret_refs") <= 1024),
	CONSTRAINT "provider_configs_version_positive" CHECK ("ops"."provider_configs"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "ops"."provider_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."provider_routes" (
	"kind" text PRIMARY KEY NOT NULL,
	"primary_config_id" uuid NOT NULL,
	"fallback_config_id" uuid,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_reason" text,
	"paused_at" timestamp with time zone,
	"paused_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_routes_kind_valid" CHECK ("ops"."provider_routes"."kind" in ('social', 'identity', 'identity_lookup', 'tax_registration', 'notification', 'bureau', 'financial_data', 'lender')),
	CONSTRAINT "provider_routes_fallback_distinct" CHECK ("ops"."provider_routes"."fallback_config_id" is null or "ops"."provider_routes"."fallback_config_id" <> "ops"."provider_routes"."primary_config_id"),
	CONSTRAINT "provider_routes_paused_state" CHECK (("ops"."provider_routes"."paused" and "ops"."provider_routes"."paused_at" is not null and "ops"."provider_routes"."paused_reason" is not null) or (not "ops"."provider_routes"."paused" and "ops"."provider_routes"."paused_at" is null and "ops"."provider_routes"."paused_reason" is null)),
	CONSTRAINT "provider_routes_paused_reason_length" CHECK (char_length("ops"."provider_routes"."paused_reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "ops"."provider_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."provider_runtime" (
	"config_id" uuid PRIMARY KEY NOT NULL,
	"circuit_state" text DEFAULT 'closed' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"health_checked_at" timestamp with time zone,
	"health_latency_ms" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_runtime_circuit_valid" CHECK ("ops"."provider_runtime"."circuit_state" in ('closed', 'open', 'half_open')),
	CONSTRAINT "provider_runtime_health_valid" CHECK ("ops"."provider_runtime"."health_status" in ('unknown', 'ok', 'degraded', 'down')),
	CONSTRAINT "provider_runtime_open_state" CHECK (("ops"."provider_runtime"."circuit_state" = 'closed') = ("ops"."provider_runtime"."opened_at" is null)),
	CONSTRAINT "provider_runtime_failures_non_negative" CHECK ("ops"."provider_runtime"."consecutive_failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ops"."provider_runtime" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_valid";--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD COLUMN "cashflow_provider" text;--> statement-breakpoint
ALTER TABLE "ops"."integration_change_requests" ADD CONSTRAINT "integration_change_requests_config_id_provider_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "ops"."provider_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."integration_change_requests" ADD CONSTRAINT "integration_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."integration_change_requests" ADD CONSTRAINT "integration_change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."jobs" ADD CONSTRAINT "jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."provider_call_stats" ADD CONSTRAINT "provider_call_stats_config_id_provider_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "ops"."provider_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."provider_configs" ADD CONSTRAINT "provider_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."provider_routes" ADD CONSTRAINT "provider_routes_paused_by_users_id_fk" FOREIGN KEY ("paused_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."provider_routes" ADD CONSTRAINT "provider_routes_primary_fk" FOREIGN KEY ("kind","primary_config_id") REFERENCES "ops"."provider_configs"("kind","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."provider_routes" ADD CONSTRAINT "provider_routes_fallback_fk" FOREIGN KEY ("kind","fallback_config_id") REFERENCES "ops"."provider_configs"("kind","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."provider_runtime" ADD CONSTRAINT "provider_runtime_config_id_provider_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "ops"."provider_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_change_requests_status_idx" ON "ops"."integration_change_requests" USING btree ("status","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "integration_change_requests_kind_idx" ON "ops"."integration_change_requests" USING btree ("kind","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key_uq" ON "ops"."jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "ops"."jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_type_created_idx" ON "ops"."jobs" USING btree ("type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "provider_call_stats_bucket_idx" ON "ops"."provider_call_stats" USING btree ("bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_configs_kind_key_uq" ON "ops"."provider_configs" USING btree ("kind","key");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('creator', 'risk_admin', 'ops_admin', 'super_admin'));--> statement-breakpoint
ALTER TABLE "fin"."credit_applications" ADD CONSTRAINT "credit_applications_cashflow_provider_format" CHECK ("fin"."credit_applications"."cashflow_provider" is null or "fin"."credit_applications"."cashflow_provider" ~ '^[a-z][a-z0-9_]{0,39}$');