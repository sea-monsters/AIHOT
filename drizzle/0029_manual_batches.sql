ALTER TABLE `research_batches` ADD `mode` text NOT NULL DEFAULT 'scheduled';--> statement-breakpoint
CREATE INDEX `idx_research_batches_mode_started` ON `research_batches` (`mode`,`started_at`);
