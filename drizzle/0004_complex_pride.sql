CREATE TABLE `scholarly_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`service` text NOT NULL,
	`payload_json` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_scholarly_cache_owner` ON `scholarly_cache` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_scholarly_cache_expiry` ON `scholarly_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `scholarly_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`service` text NOT NULL,
	`endpoint` text NOT NULL,
	`key_ciphertext` text,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	`tested_at` text,
	`test_status` text,
	`test_code` text
);
--> statement-breakpoint
CREATE TABLE `scholarly_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`service` text NOT NULL,
	`day` text NOT NULL,
	`used` integer NOT NULL,
	`next_allowed` integer NOT NULL
);
