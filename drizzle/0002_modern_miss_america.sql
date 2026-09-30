CREATE TABLE `ai_preferences` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_proposals_owner` ON `ai_proposals` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`response_json` text,
	`usage_json` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_ai_receipts_budget` ON `ai_receipts` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`model` text NOT NULL,
	`protocol` text NOT NULL,
	`reasoning` text NOT NULL,
	`key_ciphertext` text,
	`enabled` integer DEFAULT 0 NOT NULL,
	`daily_limit` integer DEFAULT 20 NOT NULL,
	`max_tokens` integer DEFAULT 4096 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`tested_at` text,
	`test_status` text
);
