CREATE TABLE `research_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`config_hash` text NOT NULL,
	`config_json` text NOT NULL,
	`schema_version` text NOT NULL,
	`status` text NOT NULL,
	`gate_json` text NOT NULL,
	`result_json` text,
	`request_id` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_research_analyses_paper` ON `research_analyses` (`paper_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_research_analyses_queue` ON `research_analyses` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `research_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`channel` text NOT NULL,
	`fields_json` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_research_changes_paper` ON `research_changes` (`paper_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `research_papers` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `research_papers` ADD `metadata_hash` text;--> statement-breakpoint
ALTER TABLE `research_papers` ADD `metadata_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `research_papers` ADD `metadata_checked_at` text;