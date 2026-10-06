CREATE TABLE "fin"."offer_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"response" text NOT NULL,
	"terms_hash" text NOT NULL,
	"kfs_acknowledged" boolean DEFAULT false NOT NULL,
	"handoff_receipt_id" uuid,
	"decline_reason" text,
	"responded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_responses_response_valid" CHECK ("fin"."offer_responses"."response" in ('accepted', 'declined')),
	CONSTRAINT "offer_responses_hash_format" CHECK ("fin"."offer_responses"."terms_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "offer_responses_accept_shape" CHECK (("fin"."offer_responses"."response" = 'accepted') = ("fin"."offer_responses"."handoff_receipt_id" is not null and "fin"."offer_responses"."kfs_acknowledged")
          and ("fin"."offer_responses"."response" = 'declined' or "fin"."offer_responses"."decline_reason" is null)),
	CONSTRAINT "offer_responses_decline_reason_valid" CHECK ("fin"."offer_responses"."decline_reason" is null or "fin"."offer_responses"."decline_reason" in ('no_longer_needed', 'terms', 'other_lender', 'other'))
);
--> statement-breakpoint
ALTER TABLE "fin"."offer_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."partner_events" DROP CONSTRAINT "partner_events_type_valid";--> statement-breakpoint
ALTER TABLE "fin"."decision_reviews" ADD COLUMN "final_offer_terms" jsonb;--> statement-breakpoint
ALTER TABLE "fin"."decision_reviews" ADD COLUMN "final_offer_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD COLUMN "offer_terms" jsonb;--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD COLUMN "offer_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fin"."offer_responses" ADD CONSTRAINT "offer_responses_proposal_id_credit_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "fin"."credit_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."offer_responses" ADD CONSTRAINT "offer_responses_review_id_decision_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "fin"."decision_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."offer_responses" ADD CONSTRAINT "offer_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."offer_responses" ADD CONSTRAINT "offer_responses_handoff_receipt_id_consent_receipts_id_fk" FOREIGN KEY ("handoff_receipt_id") REFERENCES "public"."consent_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offer_responses_proposal_key" ON "fin"."offer_responses" USING btree ("proposal_id");--> statement-breakpoint
ALTER TABLE "fin"."decision_reviews" ADD CONSTRAINT "decision_reviews_offer_shape" CHECK (("fin"."decision_reviews"."final_offer_terms" is null) = ("fin"."decision_reviews"."final_offer_expires_at" is null)
          and ("fin"."decision_reviews"."final_outcome" <> 'declined' or "fin"."decision_reviews"."final_offer_terms" is null)
          and ("fin"."decision_reviews"."final_offer_terms" is null or pg_column_size("fin"."decision_reviews"."final_offer_terms") <= 4096));--> statement-breakpoint
ALTER TABLE "fin"."lender_decisions" ADD CONSTRAINT "lender_decisions_offer_shape" CHECK (("fin"."lender_decisions"."offer_terms" is null) = ("fin"."lender_decisions"."offer_expires_at" is null)
          and ("fin"."lender_decisions"."outcome" <> 'declined' or "fin"."lender_decisions"."offer_terms" is null)
          and ("fin"."lender_decisions"."offer_terms" is null or pg_column_size("fin"."lender_decisions"."offer_terms") <= 4096));--> statement-breakpoint
ALTER TABLE "ops"."partner_events" ADD CONSTRAINT "partner_events_type_valid" CHECK ("ops"."partner_events"."type" in ('proposal.submitted', 'decision.queried', 'decision.query_withdrawn', 'decision.confirmed', 'offer.accepted', 'offer.declined', 'ping'));