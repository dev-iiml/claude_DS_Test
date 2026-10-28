CREATE TABLE "creator_status_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"graph_run_id" uuid NOT NULL,
	"rules_version" text NOT NULL,
	"tier" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"inputs_hash" text NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_status_runs_tier_valid" CHECK ("creator_status_runs"."tier" in ('member', 'onyx', 'icon')),
	CONSTRAINT "creator_status_runs_inputs_hash_format" CHECK ("creator_status_runs"."inputs_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "creator_status_runs_criteria_bounded" CHECK (jsonb_typeof("creator_status_runs"."criteria") = 'array' and pg_column_size("creator_status_runs"."criteria") <= 4096)
);
--> statement-breakpoint
ALTER TABLE "creator_status_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "access_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"summary" text NOT NULL,
	"details" text NOT NULL,
	"min_tier" text DEFAULT 'member' NOT NULL,
	"points_cost" integer NOT NULL,
	"seats" integer NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_sample" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_opportunities_kind_valid" CHECK ("access_opportunities"."kind" in ('pr_drop', 'programme', 'experience', 'event')),
	CONSTRAINT "access_opportunities_status_valid" CHECK ("access_opportunities"."status" in ('draft', 'live', 'closed')),
	CONSTRAINT "access_opportunities_min_tier_valid" CHECK ("access_opportunities"."min_tier" in ('member', 'onyx', 'icon')),
	CONSTRAINT "access_opportunities_cost_range" CHECK ("access_opportunities"."points_cost" between 0 and 100000),
	CONSTRAINT "access_opportunities_seats_range" CHECK ("access_opportunities"."seats" between 1 and 1000),
	CONSTRAINT "access_opportunities_window" CHECK ("access_opportunities"."closes_at" > "access_opportunities"."opens_at"),
	CONSTRAINT "access_opportunities_title_length" CHECK (char_length("access_opportunities"."title") between 3 and 80),
	CONSTRAINT "access_opportunities_summary_length" CHECK (char_length("access_opportunities"."summary") between 3 and 200),
	CONSTRAINT "access_opportunities_details_length" CHECK (char_length("access_opportunities"."details") between 3 and 2000)
);
--> statement-breakpoint
ALTER TABLE "access_opportunities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"points_held" integer NOT NULL,
	"tier_at_request" text NOT NULL,
	"note" text,
	"consent_receipt_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decline_reason" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_requests_status_valid" CHECK ("access_requests"."status" in ('requested', 'approved', 'declined', 'cancelled', 'expired')),
	CONSTRAINT "access_requests_tier_valid" CHECK ("access_requests"."tier_at_request" in ('member', 'onyx', 'icon')),
	CONSTRAINT "access_requests_decline_reason_valid" CHECK ("access_requests"."decline_reason" is null or "access_requests"."decline_reason" in ('no_seats', 'not_a_fit', 'profile_incomplete', 'other')),
	CONSTRAINT "access_requests_points_range" CHECK ("access_requests"."points_held" between 0 and 100000),
	CONSTRAINT "access_requests_note_length" CHECK ("access_requests"."note" is null or char_length("access_requests"."note") <= 280),
	CONSTRAINT "access_requests_decision_shape" CHECK (("access_requests"."status" in ('approved', 'declined')) = ("access_requests"."decided_at" is not null)
        and ("access_requests"."status" = 'declined') = ("access_requests"."decline_reason" is not null)
        and ("access_requests"."status" = 'requested') = ("access_requests"."closed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "access_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"is_sample" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_name_length" CHECK (char_length("brands"."name") between 2 and 80)
);
--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"amount" integer NOT NULL,
	"rule" text,
	"rules_version" text,
	"earn_key" text,
	"request_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_points_ledger_type_valid" CHECK ("creator_points_ledger"."entry_type" in ('earn', 'hold', 'release')),
	CONSTRAINT "creator_points_ledger_shape" CHECK (case "creator_points_ledger"."entry_type"
        when 'earn' then "creator_points_ledger"."amount" > 0 and "creator_points_ledger"."rule" is not null and "creator_points_ledger"."rules_version" is not null and "creator_points_ledger"."earn_key" is not null
        when 'hold' then "creator_points_ledger"."amount" < 0 and "creator_points_ledger"."rule" is null and "creator_points_ledger"."earn_key" is null
        when 'release' then "creator_points_ledger"."amount" > 0 and "creator_points_ledger"."rule" is null and "creator_points_ledger"."earn_key" is null
      end)
);
--> statement-breakpoint
ALTER TABLE "creator_points_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_valid";--> statement-breakpoint
ALTER TABLE "data_erasure_requests" DROP CONSTRAINT "data_erasure_requests_scope_valid";--> statement-breakpoint
ALTER TABLE "ops"."jobs" DROP CONSTRAINT "jobs_type_valid";--> statement-breakpoint
ALTER TABLE "creator_status_runs" ADD CONSTRAINT "creator_status_runs_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_status_runs" ADD CONSTRAINT "creator_status_runs_graph_run_id_professional_graph_runs_id_fk" FOREIGN KEY ("graph_run_id") REFERENCES "public"."professional_graph_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_opportunities" ADD CONSTRAINT "access_opportunities_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_opportunities" ADD CONSTRAINT "access_opportunities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_opportunity_id_access_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."access_opportunities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_consent_receipt_id_consent_receipts_id_fk" FOREIGN KEY ("consent_receipt_id") REFERENCES "public"."consent_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_points_ledger" ADD CONSTRAINT "creator_points_ledger_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_status_runs_creator_idx" ON "creator_status_runs" USING btree ("creator_id","computed_at" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "creator_status_runs_graph_run_idx" ON "creator_status_runs" USING btree ("graph_run_id");--> statement-breakpoint
CREATE INDEX "access_opportunities_status_idx" ON "access_opportunities" USING btree ("status","closes_at");--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_active_key" ON "access_requests" USING btree ("opportunity_id","creator_id") WHERE "access_requests"."status" in ('requested', 'approved');--> statement-breakpoint
CREATE INDEX "access_requests_queue_idx" ON "access_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "access_requests_user_idx" ON "access_requests" USING btree ("user_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "brands_name_key" ON "brands" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "creator_points_ledger_earn_key" ON "creator_points_ledger" USING btree ("creator_id","earn_key") WHERE "creator_points_ledger"."earn_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_points_ledger_request_entry_key" ON "creator_points_ledger" USING btree ("request_id","entry_type") WHERE "creator_points_ledger"."request_id" is not null;--> statement-breakpoint
CREATE INDEX "creator_points_ledger_creator_idx" ON "creator_points_ledger" USING btree ("creator_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('creator', 'risk_admin', 'ops_admin', 'partnerships_admin', 'super_admin'));--> statement-breakpoint
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_scope_valid" CHECK ("data_erasure_requests"."scope" in ('social_account_data', 'professional_graph', 'identity_lookup', 'financial_inputs', 'access_requests'));--> statement-breakpoint
ALTER TABLE "ops"."jobs" ADD CONSTRAINT "jobs_type_valid" CHECK ("ops"."jobs"."type" in ('expire_stale_applications', 'process_deferred_erasures', 'provider_health_check', 'purge_expired_fi_data', 'process_lender_proposals', 'deliver_partner_webhooks', 'expire_access_requests'));