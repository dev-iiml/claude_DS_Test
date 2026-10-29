CREATE TABLE "ops"."rate_limit_counters" (
	"bucket" text NOT NULL,
	"subject_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_limit_counters_bucket_subject_key_window_start_pk" PRIMARY KEY("bucket","subject_key","window_start"),
	CONSTRAINT "rate_limit_counters_bucket_format" CHECK ("ops"."rate_limit_counters"."bucket" ~ '^[a-z_]+\.[a-z_]+$'),
	CONSTRAINT "rate_limit_counters_subject_format" CHECK ("ops"."rate_limit_counters"."subject_key" ~ '^rl[0-9]+:[0-9a-f]{32}$'),
	CONSTRAINT "rate_limit_counters_count_positive" CHECK ("ops"."rate_limit_counters"."count" > 0)
);
--> statement-breakpoint
ALTER TABLE "ops"."rate_limit_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."jobs" DROP CONSTRAINT "jobs_type_valid";--> statement-breakpoint
CREATE INDEX "rate_limit_counters_window_idx" ON "ops"."rate_limit_counters" USING btree ("window_start");--> statement-breakpoint
ALTER TABLE "ops"."jobs" ADD CONSTRAINT "jobs_type_valid" CHECK ("ops"."jobs"."type" in ('expire_stale_applications', 'process_deferred_erasures', 'provider_health_check', 'purge_expired_fi_data', 'process_lender_proposals', 'deliver_partner_webhooks', 'expire_access_requests', 'analytics_maintenance', 'rate_limit_purge', 'purge_auth_records'));