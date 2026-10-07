CREATE TABLE `daily_content_versions` (
	`date` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_visits` (
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`seen_revision` integer NOT NULL,
	`visited_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `date`)
);
--> statement-breakpoint
CREATE TABLE `research_briefs` (
	`batch_key` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`slot` integer NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`evidence_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`method` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_research_briefs_date` ON `research_briefs` (`date`,`slot`);--> statement-breakpoint
CREATE INDEX `idx_research_briefs_updated` ON `research_briefs` (`updated_at`,`batch_key`);
--> statement-breakpoint
CREATE TRIGGER daily_date_archive_insert AFTER INSERT ON research_daily BEGIN
INSERT INTO daily_content_versions(date,revision) VALUES(NEW.date,1) ON CONFLICT(date) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER daily_date_archive_update AFTER UPDATE ON research_daily WHEN OLD.status IS NOT NEW.status OR OLD.content_hash IS NOT NEW.content_hash OR OLD.coverage_json IS NOT NEW.coverage_json OR OLD.selection_json IS NOT NEW.selection_json BEGIN
INSERT INTO daily_content_versions(date,revision) VALUES(NEW.date,1) ON CONFLICT(date) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER daily_date_group_update AFTER UPDATE ON research_daily_groups WHEN OLD.status IS NOT NEW.status OR OLD.result_json IS NOT NEW.result_json BEGIN
INSERT INTO daily_content_versions(date,revision) VALUES(NEW.date,1) ON CONFLICT(date) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER daily_date_brief_insert AFTER INSERT ON research_briefs BEGIN
INSERT INTO daily_content_versions(date,revision) VALUES(NEW.date,1) ON CONFLICT(date) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','daily',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER daily_date_brief_update AFTER UPDATE ON research_briefs WHEN OLD.content_hash IS NOT NEW.content_hash OR OLD.status IS NOT NEW.status OR OLD.summary IS NOT NEW.summary BEGIN
INSERT INTO daily_content_versions(date,revision) VALUES(NEW.date,1) ON CONFLICT(date) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','daily',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;
