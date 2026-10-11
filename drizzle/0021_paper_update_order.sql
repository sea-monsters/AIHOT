CREATE INDEX `idx_research_papers_update_day_priority` ON `research_papers` (date(updated_at,'+8 hours') DESC,priority DESC,id ASC);
