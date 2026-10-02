CREATE TABLE `anysearch_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_anysearch_request_cache` ON `anysearch_requests` (`owner_id`,`fingerprint`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_anysearch_request_expiry` ON `anysearch_requests` (`expires_at`);--> statement-breakpoint
CREATE TABLE `anysearch_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`key_ciphertext` text,
	`enabled` integer DEFAULT 0 NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	`tested_at` text,
	`test_status` text,
	`test_code` text
);
--> statement-breakpoint
CREATE TABLE `anysearch_usage` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`used` integer NOT NULL,
	`next_allowed` integer NOT NULL
);
