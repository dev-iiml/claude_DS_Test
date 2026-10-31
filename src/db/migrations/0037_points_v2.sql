CREATE TABLE "points_task_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"marked_by" uuid,
	"note" text,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_task_completions_note_length" CHECK ("points_task_completions"."note" is null or char_length("points_task_completions"."note") <= 280)
);
--> statement-breakpoint
ALTER TABLE "points_task_completions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "points_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"points" integer NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"proposed_by" uuid,
	"proposed_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_tasks_status_valid" CHECK ("points_tasks"."status" in ('proposed', 'active', 'rejected', 'retired')),
	CONSTRAINT "points_tasks_category_valid" CHECK ("points_tasks"."category" in ('content', 'community', 'events', 'profile', 'brand')),
	CONSTRAINT "points_tasks_points_range" CHECK ("points_tasks"."points" between 50 and 1000),
	CONSTRAINT "points_tasks_title_length" CHECK (char_length("points_tasks"."title") between 4 and 80),
	CONSTRAINT "points_tasks_description_length" CHECK (char_length("points_tasks"."description") between 10 and 400),
	CONSTRAINT "points_tasks_four_eyes" CHECK ("points_tasks"."decided_by" is null or "points_tasks"."decided_by" <> "points_tasks"."proposed_by")
);
--> statement-breakpoint
ALTER TABLE "points_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."jobs" DROP CONSTRAINT "jobs_type_valid";--> statement-breakpoint
ALTER TABLE "creator_points_ledger" DROP CONSTRAINT "creator_points_ledger_type_valid";--> statement-breakpoint
ALTER TABLE "creator_points_ledger" DROP CONSTRAINT "creator_points_ledger_shape";--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "completed_by" uuid;--> statement-breakpoint
ALTER TABLE "points_task_completions" ADD CONSTRAINT "points_task_completions_task_id_points_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."points_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_task_completions" ADD CONSTRAINT "points_task_completions_creator_id_creator_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_task_completions" ADD CONSTRAINT "points_task_completions_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_tasks" ADD CONSTRAINT "points_tasks_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_tasks" ADD CONSTRAINT "points_tasks_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "points_task_completions_key" ON "points_task_completions" USING btree ("task_id","creator_id");--> statement-breakpoint
CREATE INDEX "points_task_completions_creator_idx" ON "points_task_completions" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "points_tasks_status_idx" ON "points_tasks" USING btree ("status");--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."jobs" ADD CONSTRAINT "jobs_type_valid" CHECK ("ops"."jobs"."type" in ('expire_stale_applications', 'process_deferred_erasures', 'provider_health_check', 'purge_expired_fi_data', 'process_lender_proposals', 'deliver_partner_webhooks', 'expire_access_requests', 'analytics_maintenance', 'rate_limit_purge', 'purge_auth_records', 'grant_membership_milestones'));--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_completed_shape" CHECK ("access_requests"."completed_at" is null or "access_requests"."status" = 'approved');--> statement-breakpoint
ALTER TABLE "creator_points_ledger" ADD CONSTRAINT "creator_points_ledger_type_valid" CHECK ("creator_points_ledger"."entry_type" in ('earn', 'hold', 'release', 'reverse'));--> statement-breakpoint
ALTER TABLE "creator_points_ledger" ADD CONSTRAINT "creator_points_ledger_shape" CHECK (case "creator_points_ledger"."entry_type"
        when 'earn' then "creator_points_ledger"."amount" > 0 and "creator_points_ledger"."rule" is not null and "creator_points_ledger"."rules_version" is not null and "creator_points_ledger"."earn_key" is not null
        when 'hold' then "creator_points_ledger"."amount" < 0 and "creator_points_ledger"."rule" is null and "creator_points_ledger"."earn_key" is null
        when 'release' then "creator_points_ledger"."amount" > 0 and "creator_points_ledger"."rule" is null and "creator_points_ledger"."earn_key" is null
        when 'reverse' then "creator_points_ledger"."amount" < 0 and "creator_points_ledger"."rule" is not null and "creator_points_ledger"."earn_key" like 'reverse:%'
      end);