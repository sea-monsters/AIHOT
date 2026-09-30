CREATE TABLE `site_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`published_at` text,
	`discovered_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_items_url_unique` ON `site_items` (`url`);--> statement-breakpoint
CREATE INDEX `idx_site_items_time` ON `site_items` (`published_at`);--> statement-breakpoint
CREATE INDEX `idx_site_items_source` ON `site_items` (`source_id`);--> statement-breakpoint
CREATE TABLE `site_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`last_checked` text,
	`last_success` text,
	`error` text,
	`count` integer DEFAULT 0 NOT NULL
);
