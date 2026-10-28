CREATE TABLE "creator_status_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"graph_run_id" uuid NOT NULL,
	"rules_version" text NOT NULL,
	"tier" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_status_runs_tier_valid" CHECK ("creator_status_runs"."tier" in ('member', 'onyx', 'icon')),
	CONSTRAINT "creator_status_runs_rules_version_format" CHECK ("creator_status_runs"."rules_version" ~ '^cs-[0-9]+\.[0-9]+\.[0-9]+$'),
	CONSTRAINT "creator_status_runs_criteria_bounded" CHECK (jsonb_typeof("creator_status_runs"."criteria") = 'array' and pg_column_size("creator_status_runs"."criteria") <= 4096)
);
--> statement-breakpoint
ALTER TABLE "creator_status_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"amount" integer NOT NULL,
	"milestone" text,
	"access_request_id" uuid,
	"rules_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_points_ledger_entry_type_valid" CHECK ("creator_points_ledger"."entry_type" in ('earn', 'hold', 'release')),
	CONSTRAINT "creator_points_ledger_milestone_valid" CHECK ("creator_points_ledger"."milestone" is null or "creator_points_ledger"."milestone" in ('welcome', 'verified_mobile', 'tier_onyx', 'tier_icon')),
	CONSTRAINT "creator_points_ledger_amount_sign" CHECK (("creator_points_ledger"."entry_type" = 'hold' and "creator_points_ledger"."amount" < 0) or ("creator_points_ledger"."entry_type" <> 'hold' and "creator_points_ledger"."amount" > 0)),
	CONSTRAINT "creator_points_ledger_shape" CHECK (("creator_points_ledger"."entry_type" = 'earn') = ("creator_points_ledger"."milestone" is not null)
          and ("creator_points_ledger"."entry_type" = 'earn') = ("creator_points_ledger"."access_request_id" is null)),
	CONSTRAINT "creator_points_ledger_rules_version_format" CHECK ("creator_points_ledger"."rules_version" ~ '^pts-[0-9]+\.[0-9]+\.[0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "creator_points_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "access_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"brand_name" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"summary" text NOT NULL,
	"min_tier" text NOT NULL,
	"points_cost" integer NOT NULL,
	"places" integer NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"is_preview" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_opportunities_slug_format" CHECK ("access_opportunities"."slug" ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
	CONSTRAINT "access_opportunities_kind_valid" CHECK ("access_opportunities"."kind" in ('pr_drop', 'programme', 'experience', 'event')),
	CONSTRAINT "access_opportunities_status_valid" CHECK ("access_opportunities"."status" in ('open', 'closed')),
	CONSTRAINT "access_opportunities_min_tier_valid" CHECK ("access_opportunities"."min_tier" in ('member', 'onyx', 'icon')),
	CONSTRAINT "access_opportunities_points_cost_range" CHECK ("access_opportunities"."points_cost" between 0 and 100000),
	CONSTRAINT "access_opportunities_places_range" CHECK ("access_opportunities"."places" between 1 and 1000),
	CONSTRAINT "access_opportunities_window_valid" CHECK ("access_opportunities"."closes_at" > "access_opportunities"."opens_at"),
	CONSTRAINT "access_opportunities_preview_only" CHECK ("access_opportunities"."is_preview"),
	CONSTRAINT "access_opportunities_text_bounded" CHECK (char_length("access_opportunities"."brand_name") between 2 and 60 and char_length("access_opportunities"."title") between 3 and 80
          and char_length("access_opportunities"."category") between 2 and 40 and char_length("access_opportunities"."summary") between 10 and 600)
);
--> statement-breakpoint
ALTER TABLE "access_opportunities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"note" text,
	"points_held" integer NOT NULL,
	"consent_receipt_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decline_reason" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_requests_status_valid" CHECK ("access_requests"."status" in ('requested', 'approved', 'declined', 'cancelled', 'expired')),
	CONSTRAINT "access_requests_points_held_range" CHECK ("access_requests"."points_held" >= 0),
	CONSTRAINT "access_requests_note_bounded" CHECK ("access_requests"."note" is null or char_length("access_requests"."note") between 1 and 280),
	CONSTRAINT "access_requests_expiry_after_request" CHECK ("access_requests"."expires_at" > "access_requests"."requested_at"),
	CONSTRAINT "access_requests_decline_reason_valid" CHECK ("access_requests"."decline_reason" is null or "access_requests"."decline_reason" in ('places_filled', 'not_a_fit', 'profile_incomplete', 'other')),
	CONSTRAINT "access_requests_cancel_reason_valid" CHECK ("access_requests"."cancel_reason" is null or "access_requests"."cancel_reason" in ('creator', 'membership_paused', 'consent_withdrawn')),
	CONSTRAINT "access_requests_outcome_shape" CHECK (("access_requests"."status" = 'requested') = ("access_requests"."decided_at" is null)
          and ("access_requests"."status" in ('approved', 'declined')) = ("access_requests"."decided_by" is not null)
          and ("access_requests"."status" = 'declined') = ("access_requests"."decline_reason" is not null)
          and ("access_requests"."status" = 'cancelled') = ("access_requests"."cancel_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "access_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_valid";--> statement-breakpoint
ALTER TABLE "data_erasure_requests" DROP CONSTRAINT "data_erasure_requests_scope_valid";--> statement-breakpoint
ALTER TABLE "ops"."jobs" DROP CONSTRAINT "jobs_type_valid";--> statement-breakpoint
ALTER TABLE "creator_status_runs" ADD CONSTRAINT "creator_status_runs_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_status_runs" ADD CONSTRAINT "creator_status_runs_graph_run_id_professional_graph_runs_id_fk" FOREIGN KEY ("graph_run_id") REFERENCES "public"."professional_graph_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_points_ledger" ADD CONSTRAINT "creator_points_ledger_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_opportunities" ADD CONSTRAINT "access_opportunities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_opportunities" ADD CONSTRAINT "access_opportunities_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_opportunity_id_access_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."access_opportunities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_consent_receipt_id_consent_receipts_id_fk" FOREIGN KEY ("consent_receipt_id") REFERENCES "public"."consent_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_status_runs_reproducible_key" ON "creator_status_runs" USING btree ("graph_run_id","rules_version");--> statement-breakpoint
CREATE INDEX "creator_status_runs_creator_idx" ON "creator_status_runs" USING btree ("creator_id","computed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "creator_points_ledger_creator_idx" ON "creator_points_ledger" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_points_ledger_milestone_key" ON "creator_points_ledger" USING btree ("creator_id","milestone") WHERE "creator_points_ledger"."milestone" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_points_ledger_request_entry_key" ON "creator_points_ledger" USING btree ("access_request_id","entry_type") WHERE "creator_points_ledger"."access_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "access_opportunities_slug_key" ON "access_opportunities" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "access_opportunities_listing_idx" ON "access_opportunities" USING btree ("status","closes_at");--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_active_key" ON "access_requests" USING btree ("creator_id","opportunity_id") WHERE "access_requests"."status" in ('requested', 'approved');--> statement-breakpoint
CREATE INDEX "access_requests_queue_idx" ON "access_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "access_requests_opportunity_idx" ON "access_requests" USING btree ("opportunity_id","status");--> statement-breakpoint
CREATE INDEX "access_requests_creator_idx" ON "access_requests" USING btree ("creator_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "access_requests_expiry_idx" ON "access_requests" USING btree ("expires_at") WHERE "access_requests"."status" = 'requested';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('creator', 'risk_admin', 'ops_admin', 'partnerships_admin', 'super_admin'));--> statement-breakpoint
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_scope_valid" CHECK ("data_erasure_requests"."scope" in ('social_account_data', 'professional_graph', 'identity_lookup', 'financial_inputs', 'access_requests'));--> statement-breakpoint
ALTER TABLE "ops"."jobs" ADD CONSTRAINT "jobs_type_valid" CHECK ("ops"."jobs"."type" in ('expire_stale_applications', 'process_deferred_erasures', 'provider_health_check', 'purge_expired_fi_data', 'process_lender_proposals', 'deliver_partner_webhooks', 'expire_access_requests'));