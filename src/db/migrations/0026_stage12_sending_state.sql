ALTER TABLE "fin"."credit_proposals" DROP CONSTRAINT "credit_proposals_status_valid";--> statement-breakpoint
DROP INDEX "fin"."credit_proposals_live_run_key";--> statement-breakpoint
CREATE UNIQUE INDEX "credit_proposals_run_key" ON "fin"."credit_proposals" USING btree ("underwriting_run_id") WHERE "fin"."credit_proposals"."status" <> 'withdrawn';--> statement-breakpoint
ALTER TABLE "fin"."credit_proposals" ADD CONSTRAINT "credit_proposals_status_valid" CHECK ("fin"."credit_proposals"."status" in ('held', 'queued', 'sending', 'submitted', 'decided', 'failed', 'withdrawn'));