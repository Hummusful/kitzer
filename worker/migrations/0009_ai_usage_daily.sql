CREATE TABLE IF NOT EXISTS ai_usage_daily (
  day_utc TEXT PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  neurons REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
