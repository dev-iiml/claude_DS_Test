CREATE TABLE "fin"."decision_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"message" text NOT NULL,
	"resolved_decision_id" uuid,
	"resolved_at" timestamp with time zone,
	"withdrawn_by" uuid,
	"withdrawn_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_queries_message_length" CHECK (char_length("fin"."decision_queries"."message") between 10 and 500),
	CONSTRAINT "decision_queries_resolved" CHECK (("fin"."decision_queries"."resolved_at" is null) = ("fin"."decision_queries"."resolved_decision_id" is null and "fin"."decision_queries"."withdrawn_by" is null)
          and ("fin"."decision_queries"."resolved_decision_id" is null or "fin"."decision_queries"."withdrawn_by" is null)
          and ("fin"."decision_queries"."withdrawn_by" is null) = ("fin"."decision_queries"."withdrawn_reason" is null)),
	CONSTRAINT "decision_queries_withdrawn_reason" CHECK ("fin"."decision_queries"."withdrawn_reason" is null or char_length("fin"."decision_queries"."withdrawn_reason") between 10 and 500)
);
--> statement-breakpoint
ALTER TABLE "fin"."decision_queries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."partner_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"label" text NOT NULL,
	"scopes" text[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"replaces_key_id" uuid,
	"overlap_hours" integer,
	"proposed_by" uuid,
	"proposed_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_api_keys_prefix_format" CHECK ("ops"."partner_api_keys"."prefix" ~ '^cck_(test|live)_[a-z0-9]{8}$'),
	CONSTRAINT "partner_api_keys_hash_format" CHECK ("ops"."partner_api_keys"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "partner_api_keys_label_length" CHECK (char_length("ops"."partner_api_keys"."label") between 2 and 80),
	CONSTRAINT "partner_api_keys_status_valid" CHECK ("ops"."partner_api_keys"."status" in ('pending', 'active', 'revoked', 'rejected', 'expired', 'cancelled')),
	CONSTRAINT "partner_api_keys_scopes_valid" CHECK (cardinality("ops"."partner_api_keys"."scopes") between 1 and 3 and "ops"."partner_api_keys"."scopes" <@ array['proposals:read', 'decisions:write', 'events:read']::text[]),
	CONSTRAINT "partner_api_keys_four_eyes" CHECK ("ops"."partner_api_keys"."decided_by" is null or "ops"."partner_api_keys"."proposed_by" is null or "ops"."partner_api_keys"."decided_by" <> "ops"."partner_api_keys"."proposed_by"),
	CONSTRAINT "partner_api_keys_approved" CHECK ("ops"."partner_api_keys"."status" in ('pending', 'expired', 'cancelled') or "ops"."partner_api_keys"."proposed_by" is null or ("ops"."partner_api_keys"."decided_by" is not null and "ops"."partner_api_keys"."decided_at" is not null)),
	CONSTRAINT "partner_api_keys_revoked" CHECK (("ops"."partner_api_keys"."status" = 'revoked') = ("ops"."partner_api_keys"."revoked_at" is not null and "ops"."partner_api_keys"."revoked_by" is not null)),
	CONSTRAINT "partner_api_keys_revoke_reason" CHECK ("ops"."partner_api_keys"."revoke_reason" is null or char_length("ops"."partner_api_keys"."revoke_reason") between 3 and 500),
	CONSTRAINT "partner_api_keys_overlap" CHECK ("ops"."partner_api_keys"."overlap_hours" is null or "ops"."partner_api_keys"."overlap_hours" between 0 and 720)
);
--> statement-breakpoint
ALTER TABLE "ops"."partner_api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."partner_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"partner_id" uuid NOT NULL,
	"type" text NOT NULL,
	"proposal_id" uuid,
	"query_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_events_type_valid" CHECK ("ops"."partner_events"."type" in ('proposal.submitted', 'decision.queried', 'decision.query_withdrawn', 'decision.confirmed', 'ping')),
	CONSTRAINT "partner_events_proposal_needed" CHECK ("ops"."partner_events"."type" = 'ping' or "ops"."partner_events"."proposal_id" is not null),
	CONSTRAINT "partner_events_query_needed" CHECK ("ops"."partner_events"."type" not in ('decision.queried', 'decision.query_withdrawn') or "ops"."partner_events"."query_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "ops"."partner_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."partner_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_http_status" integer,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_webhook_deliveries_status_valid" CHECK ("ops"."partner_webhook_deliveries"."status" in ('pending', 'delivered', 'dead')),
	CONSTRAINT "partner_webhook_deliveries_attempts" CHECK ("ops"."partner_webhook_deliveries"."attempts" between 0 and 50),
	CONSTRAINT "partner_webhook_deliveries_error_length" CHECK ("ops"."partner_webhook_deliveries"."last_error" is null or char_length("ops"."partner_webhook_deliveries"."last_error") <= 40),
	CONSTRAINT "partner_webhook_deliveries_delivered" CHECK (("ops"."partner_webhook_deliveries"."status" = 'delivered') = ("ops"."partner_webhook_deliveries"."delivered_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "ops"."partner_webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."partner_webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"secret_version" integer DEFAULT 1 NOT NULL,
	"previous_secret_version" integer,
	"previous_secret_until" timestamp with time zone,
	"proposed_by" uuid,
	"proposed_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_webhook_endpoints_status_valid" CHECK ("ops"."partner_webhook_endpoints"."status" in ('pending', 'active', 'retired', 'rejected', 'expired', 'cancelled')),
	CONSTRAINT "partner_webhook_endpoints_url_length" CHECK (char_length("ops"."partner_webhook_endpoints"."url") between 10 and 500),
	CONSTRAINT "partner_webhook_endpoints_url_scheme" CHECK ("ops"."partner_webhook_endpoints"."url" ~ '^https?://'),
	CONSTRAINT "partner_webhook_endpoints_four_eyes" CHECK ("ops"."partner_webhook_endpoints"."decided_by" is null or "ops"."partner_webhook_endpoints"."proposed_by" is null or "ops"."partner_webhook_endpoints"."decided_by" <> "ops"."partner_webhook_endpoints"."proposed_by"),
	CONSTRAINT "partner_webhook_endpoints_approved" CHECK ("ops"."partner_webhook_endpoints"."status" in ('pending', 'expired', 'cancelled') or "ops"."partner_webhook_endpoints"."proposed_by" is null or ("ops"."partner_webhook_endpoints"."decided_by" is not null and "ops"."partner_webhook_endpoints"."decided_at" is not null)),
	CONSTRAINT "partner_webhook_endpoints_secret_version" CHECK ("ops"."partner_webhook_endpoints"."secret_version" >= 1),
	CONSTRAINT "partner_webhook_endpoints_previous_secret" CHECK (("ops"."partner_webhook_endpoints"."previous_secret_version" is null) = ("ops"."partner_webhook_endpoints"."previous_secret_until" is null))
);
--> statement-breakpoint
ALTER TABLE "ops"."partner_webhook_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"environment" text NOT NULL,
	"lender_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_key_format" CHECK ("ops"."partners"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "partners_lender_key_format" CHECK ("ops"."partners"."lender_key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "partners_name_length" CHECK (char_length("ops"."partners"."name") between 2 and 80),
	CONSTRAINT "partners_environment_valid" CHECK ("ops"."partners"."environment" in ('sandbox', 'live')),
	CONSTRAINT "partners_status_valid" CHECK ("ops"."partners"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
ALTER TABLE "ops"."partners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_type_valid";--> statement-breakpoint
ALTER TABLE "ops"."jobs" DROP CONSTRAINT "jobs_type_valid";--> statement-breakpoint
DROP INDEX "fin"."lender_decisions_proposal_key";--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD COLUMN "source" text DEFAULT 'lender_poll' NOT NULL;--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD COLUMN "request_hash" text;--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD COLUMN "api_key_prefix" text;--> statement-breakpoint
ALTER TABLE "fin"."decision_queries" ADD CONSTRAINT "decision_queries_proposal_id_credit_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "fin"."credit_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."decision_queries" ADD CONSTRAINT "decision_queries_decision_id_lender_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "fin"."lender_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."decision_queries" ADD CONSTRAINT "decision_queries_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."decision_queries" ADD CONSTRAINT "decision_queries_resolved_decision_id_lender_decisions_id_fk" FOREIGN KEY ("resolved_decision_id") REFERENCES "fin"."lender_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."decision_queries" ADD CONSTRAINT "decision_queries_withdrawn_by_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_api_keys" ADD CONSTRAINT "partner_api_keys_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "ops"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_api_keys" ADD CONSTRAINT "partner_api_keys_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_api_keys" ADD CONSTRAINT "partner_api_keys_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_api_keys" ADD CONSTRAINT "partner_api_keys_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_events" ADD CONSTRAINT "partner_events_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "ops"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_events" ADD CONSTRAINT "partner_events_proposal_id_credit_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "fin"."credit_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_events" ADD CONSTRAINT "partner_events_query_id_decision_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "fin"."decision_queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_webhook_deliveries" ADD CONSTRAINT "partner_webhook_deliveries_event_id_partner_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "ops"."partner_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_webhook_deliveries" ADD CONSTRAINT "partner_webhook_deliveries_endpoint_id_partner_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "ops"."partner_webhook_endpoints"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_webhook_endpoints" ADD CONSTRAINT "partner_webhook_endpoints_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "ops"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_webhook_endpoints" ADD CONSTRAINT "partner_webhook_endpoints_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_webhook_endpoints" ADD CONSTRAINT "partner_webhook_endpoints_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partners" ADD CONSTRAINT "partners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_queries_decision_key" ON "fin"."decision_queries" USING btree ("decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_queries_one_open" ON "fin"."decision_queries" USING btree ("proposal_id") WHERE "fin"."decision_queries"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_api_keys_prefix_uq" ON "ops"."partner_api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "partner_api_keys_partner_idx" ON "ops"."partner_api_keys" USING btree ("partner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "partner_events_seq_uq" ON "ops"."partner_events" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "partner_events_partner_seq_idx" ON "ops"."partner_events" USING btree ("partner_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_webhook_deliveries_event_endpoint_uq" ON "ops"."partner_webhook_deliveries" USING btree ("event_id","endpoint_id");--> statement-breakpoint
CREATE INDEX "partner_webhook_deliveries_due_idx" ON "ops"."partner_webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_webhook_endpoints_one_active" ON "ops"."partner_webhook_endpoints" USING btree ("partner_id") WHERE "ops"."partner_webhook_endpoints"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "partner_webhook_endpoints_one_pending" ON "ops"."partner_webhook_endpoints" USING btree ("partner_id") WHERE "ops"."partner_webhook_endpoints"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "partners_key_uq" ON "ops"."partners" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_lender_key_uq" ON "ops"."partners" USING btree ("lender_key");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_reviews_proposal_key" ON "fin"."decision_reviews" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lender_decisions_revision_key" ON "fin"."lender_decisions" USING btree ("proposal_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "lender_decisions_idempotency_key" ON "fin"."lender_decisions" USING btree ("proposal_id","idempotency_key") WHERE "fin"."lender_decisions"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_type_valid" CHECK ("audit_events"."actor_type" in ('user', 'system', 'partner'));--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD CONSTRAINT "lender_decisions_revision_positive" CHECK ("fin"."lender_decisions"."revision" >= 1);--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD CONSTRAINT "lender_decisions_source_valid" CHECK ("fin"."lender_decisions"."source" in ('lender_poll', 'partner_api'));--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD CONSTRAINT "lender_decisions_partner_fields" CHECK (("fin"."lender_decisions"."source" = 'partner_api') = ("fin"."lender_decisions"."idempotency_key" is not null and "fin"."lender_decisions"."request_hash" is not null and "fin"."lender_decisions"."api_key_prefix" is not null));--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD CONSTRAINT "lender_decisions_idempotency_format" CHECK ("fin"."lender_decisions"."idempotency_key" is null or "fin"."lender_decisions"."idempotency_key" ~ '^[A-Za-z0-9_.:-]{8,100}$');--> statement-breakpoint
ALTER TABLE "ops"."jobs" ADD CONSTRAINT "jobs_type_valid" CHECK ("ops"."jobs"."type" in ('expire_stale_applications', 'process_deferred_erasures', 'provider_health_check', 'purge_expired_fi_data', 'process_lender_proposals', 'deliver_partner_webhooks'));