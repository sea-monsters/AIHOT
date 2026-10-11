CREATE TABLE `research_phase_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`batch_key` text,
	`run_id` text,
	`phase` text NOT NULL,
	`queued_at` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text NOT NULL,
	`gate_ms` integer DEFAULT 0 NOT NULL,
	`http_ms` integer DEFAULT 0 NOT NULL,
	`persist_ms` integer DEFAULT 0 NOT NULL,
	`outcome` text NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL,
	`budget_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_phase_events_run` ON `research_phase_events` (`run_id`,`phase`);--> statement-breakpoint
CREATE TABLE `research_ready_evidence` (
	`paper_id` text PRIMARY KEY NOT NULL,
	`daily_cohort_key` text NOT NULL,
	`origin_batch_key` text,
	`first_seen` text NOT NULL,
	`ready_at` text NOT NULL,
	`content_hash` text NOT NULL,
	`evidence_json` text NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ready_evidence_cohort` ON `research_ready_evidence` (`daily_cohort_key`,`first_seen`);--> statement-breakpoint
ALTER TABLE `research_enrichment_queue` ADD `first_seen` text;--> statement-breakpoint
ALTER TABLE `research_enrichment_queue` ADD `origin_run_id` text;--> statement-breakpoint
ALTER TABLE `research_enrichment_queue` ADD `origin_batch_key` text;--> statement-breakpoint
ALTER TABLE `research_enrichment_queue` ADD `daily_cohort_key` text;--> statement-breakpoint
ALTER TABLE `research_enrichment_queue` ADD `provider_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `research_enrichment_queue` ADD `ready_reason` text;--> statement-breakpoint
CREATE INDEX `idx_metadata_queue_due` ON `research_enrichment_queue` (`status`,`next_attempt_at`,`first_seen`);--> statement-breakpoint
ALTER TABLE `research_papers` ADD `metadata_status` text DEFAULT 'legacy_ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `research_runs` ADD `phase` text DEFAULT 'collection' NOT NULL;
--> statement-breakpoint
UPDATE research_enrichment_queue SET first_seen=updated_at WHERE first_seen IS NULL;

--> statement-breakpoint
UPDATE research_enrichment_queue SET status='legacy_deferred',ready_reason='legacy_unattributed' WHERE origin_run_id IS NULL AND daily_cohort_key IS NULL AND status IN ('pending','deferred','blocked','overflow');
