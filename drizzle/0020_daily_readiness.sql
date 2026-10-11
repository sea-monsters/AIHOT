CREATE TABLE `research_daily_work` (
	`date` text PRIMARY KEY NOT NULL,
	`source_date` text NOT NULL,
	`status` text NOT NULL,
	`metadata_pending` integer DEFAULT 0 NOT NULL,
	`scoring_pending` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
