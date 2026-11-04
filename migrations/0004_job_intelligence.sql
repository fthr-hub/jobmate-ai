-- Job intelligence: provider-sourced discovery records with explicit verification metadata.
-- The table stores public vacancy metadata only; private candidate profiles remain in the existing tables.
CREATE TABLE IF NOT EXISTS job_sources (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS discovered_jobs (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  source_domain TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT,
  location TEXT,
  employment_type TEXT,
  description TEXT,
  date_posted TEXT,
  valid_through TEXT,
  verification_status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (verification_status IN ('needs_review','structured_data','expired')),
  verified_at TEXT,
  search_query TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discovered_jobs_status_date
  ON discovered_jobs(verification_status, date_posted DESC);
CREATE INDEX IF NOT EXISTS idx_discovered_jobs_title_company
  ON discovered_jobs(title, company);

CREATE TABLE IF NOT EXISTS job_search_usage (
  telegram_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  search_count INTEGER NOT NULL DEFAULT 0 CHECK (search_count >= 0),
  PRIMARY KEY (telegram_id, usage_date)
);
