CREATE TABLE `research_maintenance_ready` (
	`paper_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`ready_at` text NOT NULL,
	`content_hash` text NOT NULL,
	`metadata_revision` integer NOT NULL,
	`paper_updated_at` text NOT NULL,
	`provenance_json` text NOT NULL,
	`record_id` text NOT NULL,
	`record_fields_json` text NOT NULL,
	`record_url` text NOT NULL,
	`evidence_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_maintenance_ready_run` ON `research_maintenance_ready` (`run_id`);