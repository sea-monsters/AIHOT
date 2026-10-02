CREATE TABLE `paper_reader_state` (
	`owner_id` text NOT NULL,
	`paper_id` text NOT NULL,
	`read_at` text,
	`favorite_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `paper_id`),
	FOREIGN KEY (`paper_id`) REFERENCES `research_papers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_paper_reader_favorites` ON `paper_reader_state` (`owner_id`,`favorite_at`);