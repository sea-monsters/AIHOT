CREATE TABLE `research_enrichment_queue` (
	`doi` text NOT NULL,
	`source_id` text NOT NULL,
	`paper_json` text NOT NULL,
	`input_hash` text DEFAULT '' NOT NULL,
	`scope_pending` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`next_attempt_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`doi`, `source_id`)
);
--> statement-breakpoint
CREATE TABLE `research_run_write_guards` (
	`run_id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE `research_batches` ADD `closed_at` text;--> statement-breakpoint
ALTER TABLE `research_batches` ADD `close_reason` text;--> statement-breakpoint
ALTER TABLE `research_runs` ADD `lease_until` text;--> statement-breakpoint
ALTER TABLE `research_runs` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `research_runs` ADD `lock_value` text;--> statement-breakpoint
ALTER TABLE `research_runs` ADD `closed_at` text;--> statement-breakpoint
ALTER TABLE `research_runs` ADD `close_reason` text;
--> statement-breakpoint
CREATE TRIGGER research_run_write_fence BEFORE INSERT ON research_run_write_guards
WHEN NOT EXISTS (
 SELECT 1 FROM research_runs r JOIN research_settings l ON l.key='lock:'||r.source_id AND l.value=r.lock_value
 WHERE r.id=NEW.run_id AND r.lease_token=r.id AND r.status='running'
 AND r.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND (r.batch_key IS NULL OR EXISTS(SELECT 1 FROM research_batches b WHERE b.key=r.batch_key AND b.status='running'))
)
BEGIN SELECT RAISE(ABORT,'research_run_fence'); END;
