CREATE TABLE IF NOT EXISTS article_summaries (
  url_hash TEXT PRIMARY KEY,
  article_url TEXT NOT NULL,
  title TEXT,
  source TEXT,
  summary TEXT NOT NULL,
  why_it_matters TEXT,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_article_summaries_created_at
  ON article_summaries(created_at DESC);
