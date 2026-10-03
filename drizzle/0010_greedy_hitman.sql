CREATE TABLE `navigation_content` (
	`scope` text NOT NULL,
	`page_key` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`scope`, `page_key`)
);
--> statement-breakpoint
CREATE TABLE `navigation_seen` (
	`owner_id` text NOT NULL,
	`page_key` text NOT NULL,
	`seen_revision` integer DEFAULT 0 NOT NULL,
	`seen_version` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`owner_id`, `page_key`)
);

--> statement-breakpoint
CREATE TRIGGER navigation_papers_insert AFTER INSERT ON research_papers BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','home',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','research',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','all',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','hot',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) SELECT owner_id,'starred',1 FROM paper_reader_state WHERE paper_id=NEW.id AND favorite_at IS NOT NULL GROUP BY owner_id ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_papers_update AFTER UPDATE ON research_papers WHEN OLD.doi IS NOT NEW.doi OR OLD.title IS NOT NEW.title OR OLD.url IS NOT NEW.url OR OLD.publisher IS NOT NEW.publisher OR OLD.journal IS NOT NEW.journal OR OLD.published_at IS NOT NEW.published_at OR OLD.date_precision IS NOT NEW.date_precision OR OLD.authors_json IS NOT NEW.authors_json OR OLD.affiliations_json IS NOT NEW.affiliations_json OR OLD.abstract IS NOT NEW.abstract OR OLD.keywords_json IS NOT NEW.keywords_json OR OLD.topics_json IS NOT NEW.topics_json OR OLD.provenance_json IS NOT NEW.provenance_json OR OLD.relevance IS NOT NEW.relevance OR OLD.priority IS NOT NEW.priority OR OLD.reasons_json IS NOT NEW.reasons_json OR OLD.rule_version IS NOT NEW.rule_version BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','home',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','research',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','all',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','hot',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) SELECT owner_id,'starred',1 FROM paper_reader_state WHERE paper_id=NEW.id AND favorite_at IS NOT NULL GROUP BY owner_id ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_papers_delete AFTER DELETE ON research_papers BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','home',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','research',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','all',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','hot',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) SELECT owner_id,'starred',1 FROM paper_reader_state WHERE paper_id=OLD.id AND favorite_at IS NOT NULL GROUP BY owner_id ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_analysis_insert AFTER INSERT ON research_analyses WHEN (NEW.status='completed' AND NEW.result_json IS NOT NULL) AND EXISTS(SELECT 1 FROM research_papers p WHERE p.id=NEW.paper_id AND p.content_hash=NEW.content_hash) BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','home',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','research',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','hot',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_analysis_update AFTER UPDATE ON research_analyses WHEN ((OLD.status='completed' OR NEW.status='completed') AND (OLD.status IS NOT NEW.status OR OLD.result_json IS NOT NEW.result_json)) AND EXISTS(SELECT 1 FROM research_papers p WHERE p.id=NEW.paper_id AND p.content_hash=NEW.content_hash) BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','home',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','research',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','hot',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_analysis_delete AFTER DELETE ON research_analyses WHEN (OLD.status='completed' AND OLD.result_json IS NOT NULL) AND EXISTS(SELECT 1 FROM research_papers p WHERE p.id=OLD.paper_id AND p.content_hash=OLD.content_hash) BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','home',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','research',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','hot',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_research_daily_insert AFTER INSERT ON research_daily WHEN NEW.date >= coalesce((SELECT max(date) FROM research_daily),NEW.date) BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','daily',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_research_daily_update AFTER UPDATE ON research_daily WHEN NEW.date >= coalesce((SELECT max(date) FROM research_daily),NEW.date) AND (OLD.status IS NOT NEW.status OR OLD.coverage_json IS NOT NEW.coverage_json OR OLD.selection_json IS NOT NEW.selection_json OR OLD.paper_ids_json IS NOT NEW.paper_ids_json OR OLD.content_hash IS NOT NEW.content_hash) BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','daily',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_research_daily_delete AFTER DELETE ON research_daily WHEN OLD.date >= coalesce((SELECT max(date) FROM research_daily),OLD.date) BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','daily',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_research_daily_groups_insert AFTER INSERT ON research_daily_groups WHEN NEW.date >= coalesce((SELECT max(date) FROM research_daily),NEW.date) AND (NEW.result_json IS NOT NULL) BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','daily',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_research_daily_groups_update AFTER UPDATE ON research_daily_groups WHEN NEW.date >= coalesce((SELECT max(date) FROM research_daily),NEW.date) AND (OLD.status IS NOT NEW.status OR OLD.result_json IS NOT NEW.result_json OR OLD.keyword IS NOT NEW.keyword OR OLD.input_json IS NOT NEW.input_json) AND (NEW.result_json IS NOT NULL OR OLD.result_json IS NOT NULL) BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','daily',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_research_daily_groups_delete AFTER DELETE ON research_daily_groups WHEN OLD.date >= coalesce((SELECT max(date) FROM research_daily),OLD.date) AND (OLD.result_json IS NOT NULL) BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES('','daily',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_favorite_insert AFTER INSERT ON paper_reader_state WHEN NEW.favorite_at IS NOT NULL BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(NEW.owner_id,'starred',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_favorite_update AFTER UPDATE ON paper_reader_state WHEN OLD.favorite_at IS NOT NEW.favorite_at BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(NEW.owner_id,'starred',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_favorite_delete AFTER DELETE ON paper_reader_state WHEN OLD.favorite_at IS NOT NULL BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(OLD.owner_id,'starred',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_ai_settings_insert AFTER INSERT ON ai_settings BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(NEW.owner_id,'settings',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_ai_settings_update AFTER UPDATE ON ai_settings WHEN OLD.endpoint IS NOT NEW.endpoint OR OLD.model IS NOT NEW.model OR OLD.protocol IS NOT NEW.protocol OR OLD.reasoning IS NOT NEW.reasoning OR OLD.enabled IS NOT NEW.enabled OR OLD.daily_limit IS NOT NEW.daily_limit OR OLD.max_tokens IS NOT NEW.max_tokens OR (OLD.key_ciphertext IS NULL) IS NOT (NEW.key_ciphertext IS NULL) BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(NEW.owner_id,'settings',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_ai_settings_delete AFTER DELETE ON ai_settings BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(OLD.owner_id,'settings',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_ai_preferences_insert AFTER INSERT ON ai_preferences BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(NEW.owner_id,'settings',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_ai_preferences_update AFTER UPDATE ON ai_preferences WHEN OLD.value_json IS NOT NEW.value_json BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(NEW.owner_id,'settings',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_ai_preferences_delete AFTER DELETE ON ai_preferences BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(OLD.owner_id,'settings',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_scholarly_settings_insert AFTER INSERT ON scholarly_settings BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(NEW.owner_id,'settings',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_scholarly_settings_update AFTER UPDATE ON scholarly_settings WHEN OLD.endpoint IS NOT NEW.endpoint OR (OLD.key_ciphertext IS NULL) IS NOT (NEW.key_ciphertext IS NULL) BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(NEW.owner_id,'settings',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_scholarly_settings_delete AFTER DELETE ON scholarly_settings BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(OLD.owner_id,'settings',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_anysearch_settings_insert AFTER INSERT ON anysearch_settings BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(NEW.owner_id,'settings',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_anysearch_settings_update AFTER UPDATE ON anysearch_settings WHEN OLD.endpoint IS NOT NEW.endpoint OR OLD.enabled IS NOT NEW.enabled OR (OLD.key_ciphertext IS NULL) IS NOT (NEW.key_ciphertext IS NULL) BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(NEW.owner_id,'settings',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;

--> statement-breakpoint
CREATE TRIGGER navigation_anysearch_settings_delete AFTER DELETE ON anysearch_settings BEGIN
INSERT INTO navigation_content(scope,page_key,revision) VALUES(OLD.owner_id,'settings',1) ON CONFLICT(scope,page_key) DO UPDATE SET revision=revision+1;
END;
