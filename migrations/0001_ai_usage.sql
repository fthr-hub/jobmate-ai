-- Daily AI quotas are scoped to the verified Telegram owner account.
-- Counts reset by Asia/Jakarta calendar date (WIB); updates are atomic to prevent parallel-request bypasses.
CREATE TABLE IF NOT EXISTS ai_usage (
  telegram_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  text_count INTEGER NOT NULL DEFAULT 0 CHECK (text_count >= 0),
  image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  PRIMARY KEY (telegram_id, usage_date)
);
