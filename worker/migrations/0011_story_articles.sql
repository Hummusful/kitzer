CREATE TABLE IF NOT EXISTS story_articles (
  url_hash TEXT PRIMARY KEY,
  article_url TEXT NOT NULL,
  title TEXT,
  source TEXT,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_story_articles_published_at
  ON story_articles(published_at DESC);

-- Existing summaries have no source-published timestamp, so preserve their
-- original creation time as the historical best available value.
INSERT OR IGNORE INTO story_articles (
  url_hash, article_url, title, source, published_at, created_at
)
SELECT url_hash, article_url, title, source, created_at, created_at
FROM article_summaries;

CREATE TABLE story_cluster_articles_new (
  story_cluster_id TEXT NOT NULL,
  article_url_hash TEXT NOT NULL,
  PRIMARY KEY (story_cluster_id, article_url_hash),
  FOREIGN KEY (story_cluster_id) REFERENCES story_clusters(id) ON DELETE CASCADE,
  FOREIGN KEY (article_url_hash) REFERENCES story_articles(url_hash) ON DELETE CASCADE
);

INSERT OR IGNORE INTO story_cluster_articles_new (story_cluster_id, article_url_hash)
SELECT story_cluster_id, article_url_hash
FROM story_cluster_articles;

DROP TABLE story_cluster_articles;
ALTER TABLE story_cluster_articles_new RENAME TO story_cluster_articles;

CREATE INDEX idx_story_cluster_articles_article_url_hash
  ON story_cluster_articles(article_url_hash);

INSERT INTO schema_migrations (version, name)
VALUES (11, 'story_articles')
ON CONFLICT(version) DO NOTHING;
