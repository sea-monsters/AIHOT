CREATE TABLE `research_papers` (
	`id` text PRIMARY KEY NOT NULL,
	`doi` text,
	`title` text NOT NULL,
	`normalized_title` text NOT NULL,
	`url` text NOT NULL,
	`publisher` text NOT NULL,
	`journal` text NOT NULL,
	`source_id` text NOT NULL,
	`issn` text NOT NULL,
	`published_at` text,
	`date_precision` text,
	`authors_json` text NOT NULL,
	`affiliations_json` text NOT NULL,
	`abstract` text,
	`keywords_json` text NOT NULL,
	`topics_json` text NOT NULL,
	`provenance_json` text NOT NULL,
	`relevance` integer NOT NULL,
	`priority` integer NOT NULL,
	`reasons_json` text NOT NULL,
	`rule_version` text NOT NULL,
	`source_indexed_at` text,
	`first_seen` text NOT NULL,
	`last_seen` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_papers_doi_unique` ON `research_papers` (`doi`);--> statement-breakpoint
CREATE INDEX `idx_research_papers_priority` ON `research_papers` (`priority`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_research_papers_publisher` ON `research_papers` (`publisher`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_research_papers_title` ON `research_papers` (`normalized_title`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_research_papers_source` ON `research_papers` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_research_papers_url` ON `research_papers` (`url`);--> statement-breakpoint
CREATE TABLE `research_records` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`source_id` text NOT NULL,
	`channel` text NOT NULL,
	`record_url` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`fields_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_research_records_paper` ON `research_records` (`paper_id`);--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`source_id` text,
	`added` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`publisher` text NOT NULL,
	`name` text NOT NULL,
	`issn` text NOT NULL,
	`rss_url` text NOT NULL,
	`last_checked` text,
	`last_success` text,
	`watermark` text,
	`cursor` text,
	`window_end` text,
	`window_start` text,
	`error` text,
	`rss_status` text,
	`rss_error` text,
	`count` integer DEFAULT 0 NOT NULL
);
