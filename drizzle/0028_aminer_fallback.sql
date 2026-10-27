CREATE TABLE `aminer_budget_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`contract_version` text NOT NULL,
	`config_revision` integer NOT NULL,
	`max_detail_calls` integer NOT NULL,
	`reserved_detail_calls` integer DEFAULT 0 NOT NULL,
	`max_search_calls` integer NOT NULL,
	`reserved_search_calls` integer DEFAULT 0 NOT NULL,
	`unit_cost_fen` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_aminer_grants_owner` ON `aminer_budget_grants` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `aminer_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`identity_key` text NOT NULL,
	`operation` text NOT NULL,
	`config_revision` integer NOT NULL,
	`grant_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`dispatch_token` text NOT NULL,
	`reserved_cost_fen` integer NOT NULL,
	`result_json` text,
	`error_code` text,
	`http_status` integer,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_aminer_requests_owner` ON `aminer_requests` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_aminer_requests_identity` ON `aminer_requests` (`owner_id`,`identity_key`,`operation`);--> statement-breakpoint
CREATE TABLE `aminer_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`credentials_ciphertext` text,
	`enabled` integer DEFAULT 0 NOT NULL,
	`data_use_authorized` integer DEFAULT 0 NOT NULL,
	`authorization_ref` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`blocked_code` text,
	`cooldown_until` integer DEFAULT 0 NOT NULL,
	`next_allowed` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_token` text
);
