CREATE SCHEMA "analytics";
--> statement-breakpoint
CREATE TABLE "analytics"."daily_counts" (
	"day" date NOT NULL,
	"event" text NOT NULL,
	"internal" boolean NOT NULL,
	"events" integer NOT NULL,
	"subjects" integer NOT NULL,
	"rolled_up_at" timestamp with time zone NOT NULL,
	CONSTRAINT "daily_counts_day_event_internal_pk" PRIMARY KEY("day","event","internal"),
	CONSTRAINT "analytics_daily_counts_nonnegative" CHECK ("analytics"."daily_counts"."events" >= 0 and "analytics"."daily_counts"."subjects" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"event_version" integer NOT NULL,
	"tier" text NOT NULL,
	"subject" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "analytics_events_event_valid" CHECK ("analytics"."events"."event" in ('landing_viewed', 'application_started', 'account_created', 'creator_profile_completed', 'social_connection_started', 'social_connection_completed', 'passport_generated', 'status_generated', 'financial_eligibility_started', 'financial_consent_granted', 'financial_inputs_completed', 'underwriting_started', 'underwriting_completed', 'offer_generated', 'offer_viewed', 'simulated_offer_accepted', 'offer_accepted', 'offer_declined', 'access_opportunity_viewed', 'access_requested')),
	CONSTRAINT "analytics_events_tier_valid" CHECK ("analytics"."events"."tier" in ('essential', 'optional')),
	CONSTRAINT "analytics_events_subject_format" CHECK ("analytics"."events"."subject" is null or "analytics"."events"."subject" ~ '^a[0-9]+:[0-9a-f]{32}$'),
	CONSTRAINT "analytics_events_props_bounded" CHECK (jsonb_typeof("analytics"."events"."props") = 'object' and pg_column_size("analytics"."events"."props") <= 1024)
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_valid";--> statement-breakpoint
ALTER TABLE "data_erasure_requests" DROP CONSTRAINT "data_erasure_requests_scope_valid";--> statement-breakpoint
ALTER TABLE "ops"."jobs" DROP CONSTRAINT "jobs_type_valid";--> statement-breakpoint
CREATE INDEX "analytics_events_event_day_idx" ON "analytics"."events" USING btree ("event","day");--> statement-breakpoint
CREATE INDEX "analytics_events_subject_idx" ON "analytics"."events" USING btree ("subject","event");--> statement-breakpoint
CREATE INDEX "analytics_events_day_idx" ON "analytics"."events" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_events_once_key" ON "analytics"."events" USING btree ("subject","event") WHERE "analytics"."events"."event" in ('account_created', 'creator_profile_completed', 'passport_generated') and "analytics"."events"."subject" is not null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('creator', 'risk_admin', 'ops_admin', 'partnerships_admin', 'analyst', 'super_admin'));--> statement-breakpoint
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_scope_valid" CHECK ("data_erasure_requests"."scope" in ('social_account_data', 'professional_graph', 'identity_lookup', 'financial_inputs', 'access_requests', 'product_analytics_events', 'financial_funnel_events'));--> statement-breakpoint
ALTER TABLE "ops"."jobs" ADD CONSTRAINT "jobs_type_valid" CHECK ("ops"."jobs"."type" in ('expire_stale_applications', 'process_deferred_erasures', 'provider_health_check', 'purge_expired_fi_data', 'process_lender_proposals', 'deliver_partner_webhooks', 'expire_access_requests', 'analytics_maintenance'));