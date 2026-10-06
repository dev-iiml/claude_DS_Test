CREATE TABLE "consent_withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_key" text NOT NULL,
	"definition_version" integer NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"effects" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"withdrawn_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_withdrawals_source_valid" CHECK ("consent_withdrawals"."source" in ('onboarding', 'settings', 'api', 'system')),
	CONSTRAINT "consent_withdrawals_reason_valid" CHECK ("consent_withdrawals"."reason" is null or "consent_withdrawals"."reason" in ('not_using', 'privacy', 'too_much_data', 'other')),
	CONSTRAINT "consent_withdrawals_effects_bounded" CHECK (jsonb_typeof("consent_withdrawals"."effects") = 'object' and pg_column_size("consent_withdrawals"."effects") <= 1024)
);
--> statement-breakpoint
ALTER TABLE "consent_withdrawals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "data_erasure_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"withdrawal_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"status" text NOT NULL,
	"hold_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"erased" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_erasure_requests_scope_valid" CHECK ("data_erasure_requests"."scope" in ('social_account_data', 'professional_graph', 'identity_lookup')),
	CONSTRAINT "data_erasure_requests_status_valid" CHECK ("data_erasure_requests"."status" in ('completed', 'deferred')),
	CONSTRAINT "data_erasure_requests_status_consistent" CHECK (("data_erasure_requests"."status" = 'completed' and "data_erasure_requests"."completed_at" is not null)
        or ("data_erasure_requests"."status" = 'deferred' and "data_erasure_requests"."completed_at" is null and cardinality("data_erasure_requests"."hold_reasons") > 0)),
	CONSTRAINT "data_erasure_requests_erased_bounded" CHECK (jsonb_typeof("data_erasure_requests"."erased") = 'object' and pg_column_size("data_erasure_requests"."erased") <= 512)
);
--> statement-breakpoint
ALTER TABLE "data_erasure_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_profiles" DROP CONSTRAINT "creator_profiles_profile_status_valid";--> statement-breakpoint
ALTER TABLE "consent_receipts" DROP CONSTRAINT "consent_receipts_source_valid";--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consent_withdrawals" ADD CONSTRAINT "consent_withdrawals_receipt_id_consent_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."consent_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_withdrawals" ADD CONSTRAINT "consent_withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_withdrawal_id_consent_withdrawals_id_fk" FOREIGN KEY ("withdrawal_id") REFERENCES "public"."consent_withdrawals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_withdrawals_receipt_key" ON "consent_withdrawals" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "consent_withdrawals_user_idx" ON "consent_withdrawals" USING btree ("user_id","withdrawn_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "data_erasure_requests_user_idx" ON "data_erasure_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "data_erasure_requests_deferred_idx" ON "data_erasure_requests" USING btree ("status") WHERE "data_erasure_requests"."status" = 'deferred';--> statement-breakpoint
CREATE UNIQUE INDEX "data_erasure_requests_withdrawal_scope_key" ON "data_erasure_requests" USING btree ("withdrawal_id","scope");--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_paused_state" CHECK (("creator_profiles"."profile_status" = 'paused') = ("creator_profiles"."paused_at" is not null)
        and ("creator_profiles"."profile_status" <> 'paused' or "creator_profiles"."completed_at" is not null));--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_profile_status_valid" CHECK ("creator_profiles"."profile_status" in ('draft', 'completed', 'paused', 'suspended'));--> statement-breakpoint
ALTER TABLE "consent_receipts" ADD CONSTRAINT "consent_receipts_source_valid" CHECK ("consent_receipts"."source" in ('onboarding', 'settings', 'api', 'system'));