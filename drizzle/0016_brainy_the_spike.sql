CREATE TABLE `research_brief_evidence` (
	`batch_key` text NOT NULL,
	`paper_id` text NOT NULL,
	`evidence_json` text NOT NULL,
	PRIMARY KEY(`batch_key`, `paper_id`)
);
