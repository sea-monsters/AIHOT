ALTER TABLE `scholarly_usage` ADD `lease_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scholarly_usage` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `scholarly_usage` ADD `cooldown_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scholarly_usage` ADD `blocked_code` text;
--> statement-breakpoint
INSERT OR IGNORE INTO scholarly_usage(id,owner_id,service,day,used,next_allowed)
SELECT '__site__|'||service,'__site__',service,strftime('%Y-%m-%d','now'),sum(CASE WHEN day=strftime('%Y-%m-%d','now') THEN used ELSE 0 END),max(next_allowed) FROM scholarly_usage GROUP BY service;
--> statement-breakpoint
INSERT INTO scholarly_usage(id,owner_id,service,day,used,next_allowed)
SELECT '__site__|openalex','__site__','openalex',strftime('%Y-%m-%d','now'),100,0 WHERE EXISTS(SELECT 1 FROM research_runs WHERE started_at>=strftime('%Y-%m-%d','now')||'T00:00:00.000Z') OR EXISTS(SELECT 1 FROM research_keyword_jobs WHERE requests>0 AND updated_at>=strftime('%Y-%m-%d','now')||'T00:00:00.000Z') OR EXISTS(SELECT 1 FROM research_settings WHERE key='keyword-import-audit' AND json_valid(value) AND json_extract(value,'$.productionRequests')>0 AND json_extract(value,'$.finishedAt')>=strftime('%Y-%m-%d','now')||'T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET day=excluded.day,used=max(scholarly_usage.used,100);
