CREATE TABLE `research_batch_members` (
	`paper_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`batch_key` text,
	`first_seen` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`snapshot_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_batch_members_batch` ON `research_batch_members` (`batch_key`,`first_seen`);--> statement-breakpoint
CREATE TABLE `research_batches` (
	`key` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`slot` integer NOT NULL,
	`status` text NOT NULL,
	`sources_json` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `research_daily` (
	`date` text PRIMARY KEY NOT NULL,
	`source_date` text NOT NULL,
	`cutoff` text NOT NULL,
	`status` text NOT NULL,
	`coverage_json` text NOT NULL,
	`selection_json` text NOT NULL,
	`paper_ids_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`schema_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `research_daily_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`ordinal` integer NOT NULL,
	`keyword` text NOT NULL,
	`status` text NOT NULL,
	`input_json` text NOT NULL,
	`paper_ids_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`result_json` text,
	`config_json` text,
	`request_id` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_daily_groups_queue` ON `research_daily_groups` (`status`,`date`,`ordinal`);--> statement-breakpoint
CREATE INDEX `idx_daily_groups_date` ON `research_daily_groups` (`date`,`ordinal`);--> statement-breakpoint
ALTER TABLE `research_runs` ADD `batch_key` text;