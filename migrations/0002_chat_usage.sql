-- Keep chat usage separate from text vacancy analysis.
-- Existing daily quota rows are preserved; the new counter starts at zero.
ALTER TABLE ai_usage ADD COLUMN chat_count INTEGER NOT NULL DEFAULT 0 CHECK (chat_count >= 0);
