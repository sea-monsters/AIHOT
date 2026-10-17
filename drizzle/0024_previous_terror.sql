ALTER TABLE `ai_receipts` ADD `phase` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `run_id` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `batch_key` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `cohort_key` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `paper_ids_json` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `config_revision` integer;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `protocol` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `started_at` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `attempt_no` integer;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `retry_of` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `provider_request_id` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `wall_time_ms` integer;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `outcome` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `usage_state` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `total_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `cached_input_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `cache_creation_input_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `reasoning_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `cache_semantics` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `cache_hit` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `cache_reuse` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `usage_source_json` text;--> statement-breakpoint
ALTER TABLE `ai_receipts` ADD `cost_json` text;--> statement-breakpoint
CREATE INDEX `idx_ai_receipts_usage_summary` ON `ai_receipts` (`owner_id`,`created_at`,`phase`,`model`,`outcome`);--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `cache_reuse_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `cache_last_reused_at` text;