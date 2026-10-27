CREATE TABLE `research_metadata_jobs` (
	`paper_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`fields_json` text NOT NULL,
	`status` text NOT NULL,
	`state_json` text NOT NULL,
	`baseline_json` text NOT NULL,
	`gain_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
