CREATE TABLE `research_attribution_repairs` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`run_id` text NOT NULL,
	`previous_cohort` text,
	`daily_cohort_key` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`rule_version` text NOT NULL,
	`applied_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `research_batch_members` ADD `daily_cohort_key` text;--> statement-breakpoint
CREATE INDEX `idx_batch_members_cohort` ON `research_batch_members` (`daily_cohort_key`,`first_seen`);--> statement-breakpoint
ALTER TABLE `research_runs` ADD `entry_point` text DEFAULT 'legacy_unknown' NOT NULL;