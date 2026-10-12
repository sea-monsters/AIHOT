CREATE TABLE `research_ingestion_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`expected_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_ingestion_work` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`source_id` text NOT NULL,
	`channel` text NOT NULL,
	`origin_run_id` text NOT NULL,
	`origin_batch_key` text,
	`daily_cohort_key` text NOT NULL,
	`observed_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload_json` text NOT NULL,
	`checkpoint_json` text DEFAULT '{}' NOT NULL,
	`records` integer NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_ingestion_source` ON `research_ingestion_work` (`source_id`,`status`,`observed_at`,`ordinal`);--> statement-breakpoint
CREATE INDEX `idx_ingestion_batch` ON `research_ingestion_work` (`origin_batch_key`,`status`);--> statement-breakpoint
CREATE TABLE `research_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`run_id` text,
	`origin_run_id` text,
	`batch_key` text,
	`source_id` text,
	`provider` text,
	`phase` text NOT NULL,
	`state` text NOT NULL,
	`severity` text NOT NULL,
	`known` integer DEFAULT 0 NOT NULL,
	`reason` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`observed_at` text NOT NULL,
	`duration_ms` integer,
	`remaining_ms` integer DEFAULT 0 NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`statements` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_operations_request` ON `research_operations` (`request_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_operations_run` ON `research_operations` (`run_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_operations_batch` ON `research_operations` (`batch_key`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_operations_retention` ON `research_operations` (`observed_at`);
--> statement-breakpoint
CREATE TRIGGER research_ingestion_capacity BEFORE INSERT ON research_ingestion_work WHEN (SELECT count(*) FROM research_ingestion_work)>=512 BEGIN SELECT RAISE(ABORT,'research_ingestion_capacity'); END;
--> statement-breakpoint
CREATE TRIGGER research_ingestion_cas BEFORE INSERT ON research_ingestion_guards WHEN
 EXISTS(SELECT 1 FROM json_each(NEW.expected_json,'$.papers') e LEFT JOIN research_papers d ON d.id IS json_extract(e.value,'$.key.id') WHERE (json_extract(e.value,'$.exists')=0 AND d.id IS NOT NULL) OR (json_extract(e.value,'$.exists')=1 AND (d.id IS NULL OR NOT(d.id IS json_extract(e.value,'$.row.id') AND d.doi IS json_extract(e.value,'$.row.doi') AND d.title IS json_extract(e.value,'$.row.title') AND d.normalized_title IS json_extract(e.value,'$.row.normalized_title') AND d.url IS json_extract(e.value,'$.row.url') AND d.publisher IS json_extract(e.value,'$.row.publisher') AND d.journal IS json_extract(e.value,'$.row.journal') AND d.source_id IS json_extract(e.value,'$.row.source_id') AND d.issn IS json_extract(e.value,'$.row.issn') AND d.published_at IS json_extract(e.value,'$.row.published_at') AND d.date_precision IS json_extract(e.value,'$.row.date_precision') AND d.authors_json IS json_extract(e.value,'$.row.authors_json') AND d.affiliations_json IS json_extract(e.value,'$.row.affiliations_json') AND d.abstract IS json_extract(e.value,'$.row.abstract') AND d.keywords_json IS json_extract(e.value,'$.row.keywords_json') AND d.topics_json IS json_extract(e.value,'$.row.topics_json') AND d.provenance_json IS json_extract(e.value,'$.row.provenance_json') AND d.relevance IS json_extract(e.value,'$.row.relevance') AND d.priority IS json_extract(e.value,'$.row.priority') AND d.reasons_json IS json_extract(e.value,'$.row.reasons_json') AND d.rule_version IS json_extract(e.value,'$.row.rule_version') AND d.source_indexed_at IS json_extract(e.value,'$.row.source_indexed_at') AND d.first_seen IS json_extract(e.value,'$.row.first_seen') AND d.last_seen IS json_extract(e.value,'$.row.last_seen') AND d.updated_at IS json_extract(e.value,'$.row.updated_at') AND d.content_hash IS json_extract(e.value,'$.row.content_hash') AND d.metadata_hash IS json_extract(e.value,'$.row.metadata_hash') AND d.metadata_revision IS json_extract(e.value,'$.row.metadata_revision') AND d.metadata_checked_at IS json_extract(e.value,'$.row.metadata_checked_at') AND d.metadata_status IS json_extract(e.value,'$.row.metadata_status')))))
 OR EXISTS(SELECT 1 FROM json_each(NEW.expected_json,'$.queues') e LEFT JOIN research_enrichment_queue d ON d.doi IS json_extract(e.value,'$.key.doi') AND d.source_id IS json_extract(e.value,'$.key.source_id') WHERE (json_extract(e.value,'$.exists')=0 AND d.doi IS NOT NULL) OR (json_extract(e.value,'$.exists')=1 AND (d.doi IS NULL OR NOT(d.doi IS json_extract(e.value,'$.row.doi') AND d.source_id IS json_extract(e.value,'$.row.source_id') AND d.paper_json IS json_extract(e.value,'$.row.paper_json') AND d.input_hash IS json_extract(e.value,'$.row.input_hash') AND d.scope_pending IS json_extract(e.value,'$.row.scope_pending') AND d.status IS json_extract(e.value,'$.row.status') AND d.next_attempt_at IS json_extract(e.value,'$.row.next_attempt_at') AND d.updated_at IS json_extract(e.value,'$.row.updated_at') AND d.first_seen IS json_extract(e.value,'$.row.first_seen') AND d.origin_run_id IS json_extract(e.value,'$.row.origin_run_id') AND d.origin_batch_key IS json_extract(e.value,'$.row.origin_batch_key') AND d.daily_cohort_key IS json_extract(e.value,'$.row.daily_cohort_key') AND d.provider_json IS json_extract(e.value,'$.row.provider_json') AND d.ready_reason IS json_extract(e.value,'$.row.ready_reason')))))
 OR EXISTS(SELECT 1 FROM json_each(NEW.expected_json,'$.members') e LEFT JOIN research_batch_members d ON d.paper_id IS json_extract(e.value,'$.key.paper_id') WHERE (json_extract(e.value,'$.exists')=0 AND d.paper_id IS NOT NULL) OR (json_extract(e.value,'$.exists')=1 AND (d.paper_id IS NULL OR NOT(d.paper_id IS json_extract(e.value,'$.row.paper_id') AND d.run_id IS json_extract(e.value,'$.row.run_id') AND d.batch_key IS json_extract(e.value,'$.row.batch_key') AND d.first_seen IS json_extract(e.value,'$.row.first_seen') AND d.snapshot_json IS json_extract(e.value,'$.row.snapshot_json') AND d.snapshot_at IS json_extract(e.value,'$.row.snapshot_at') AND d.daily_cohort_key IS json_extract(e.value,'$.row.daily_cohort_key')))))
 OR EXISTS(SELECT 1 FROM json_each(NEW.expected_json,'$.records') e LEFT JOIN research_records d ON d.id IS json_extract(e.value,'$.key.id') WHERE (json_extract(e.value,'$.exists')=0 AND d.id IS NOT NULL) OR (json_extract(e.value,'$.exists')=1 AND (d.id IS NULL OR NOT(d.id IS json_extract(e.value,'$.row.id') AND d.paper_id IS json_extract(e.value,'$.row.paper_id') AND d.source_id IS json_extract(e.value,'$.row.source_id') AND d.channel IS json_extract(e.value,'$.row.channel') AND d.record_url IS json_extract(e.value,'$.row.record_url') AND d.retrieved_at IS json_extract(e.value,'$.row.retrieved_at') AND d.fields_json IS json_extract(e.value,'$.row.fields_json')))))
 OR EXISTS(SELECT 1 FROM json_each(NEW.expected_json,'$.settings') e LEFT JOIN research_settings d ON d.key IS json_extract(e.value,'$.key.key') WHERE (json_extract(e.value,'$.exists')=0 AND d.key IS NOT NULL) OR (json_extract(e.value,'$.exists')=1 AND (d.key IS NULL OR NOT(d.key IS json_extract(e.value,'$.row.key') AND d.value IS json_extract(e.value,'$.row.value')))))
 OR EXISTS(SELECT 1 FROM json_each(NEW.expected_json,'$.work') e LEFT JOIN research_ingestion_work d ON d.id IS json_extract(e.value,'$.key.id') WHERE (json_extract(e.value,'$.exists')=0 AND d.id IS NOT NULL) OR (json_extract(e.value,'$.exists')=1 AND (d.id IS NULL OR NOT(d.id IS json_extract(e.value,'$.row.id') AND d.group_id IS json_extract(e.value,'$.row.group_id') AND d.ordinal IS json_extract(e.value,'$.row.ordinal') AND d.source_id IS json_extract(e.value,'$.row.source_id') AND d.channel IS json_extract(e.value,'$.row.channel') AND d.origin_run_id IS json_extract(e.value,'$.row.origin_run_id') AND d.origin_batch_key IS json_extract(e.value,'$.row.origin_batch_key') AND d.daily_cohort_key IS json_extract(e.value,'$.row.daily_cohort_key') AND d.observed_at IS json_extract(e.value,'$.row.observed_at') AND d.status IS json_extract(e.value,'$.row.status') AND d.payload_json IS json_extract(e.value,'$.row.payload_json') AND d.checkpoint_json IS json_extract(e.value,'$.row.checkpoint_json') AND d.records IS json_extract(e.value,'$.row.records') AND d.added IS json_extract(e.value,'$.row.added') AND d.updated IS json_extract(e.value,'$.row.updated') AND d.finished_at IS json_extract(e.value,'$.row.finished_at')))))
BEGIN SELECT RAISE(ABORT,'research_ingestion_conflict'); END;
