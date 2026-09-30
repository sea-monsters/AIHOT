CREATE TABLE `runtime_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text NOT NULL,
	`severity` text NOT NULL,
	`component` text NOT NULL,
	`event` text NOT NULL,
	`outcome` text NOT NULL,
	`error_code` text,
	`http_status` integer,
	`phase` text,
	`correlation_id` text,
	`task_id` text,
	`request_id` text,
	`source_id` text,
	`duration_ms` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_runtime_logs_created` ON `runtime_logs` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_logs_severity` ON `runtime_logs` (`severity`,`id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_logs_component` ON `runtime_logs` (`component`,`id`);