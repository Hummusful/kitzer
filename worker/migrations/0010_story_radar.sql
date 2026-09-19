-- Story Radar: durable editorial clusters and their member articles.
-- article_summaries is KITZER's existing article table; url_hash is its primary key.

CREATE TABLE story_clusters (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  summary TEXT,
  main_entity TEXT,
  first_seen TEXT NOT NULL,
  last_updated TEXT NOT NULL,
  story_score REAL NOT NULL DEFAULT 0,
  article_count INTEGER NOT NULL DEFAULT 0 CHECK (article_count >= 0),
  source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  status TEXT NOT NULL DEFAULT 'normal'
);

CREATE TABLE story_cluster_articles (
  story_cluster_id TEXT NOT NULL,
  article_url_hash TEXT NOT NULL,
  PRIMARY KEY (story_cluster_id, article_url_hash),
  FOREIGN KEY (story_cluster_id) REFERENCES story_clusters(id) ON DELETE CASCADE,
  FOREIGN KEY (article_url_hash) REFERENCES article_summaries(url_hash) ON DELETE CASCADE
);

CREATE INDEX idx_story_clusters_status_score
  ON story_clusters(status, story_score DESC, last_updated DESC);

CREATE INDEX idx_story_clusters_last_updated
  ON story_clusters(last_updated DESC);

CREATE INDEX idx_story_cluster_articles_article_url_hash
  ON story_cluster_articles(article_url_hash);

INSERT INTO schema_migrations (version, name)
VALUES (10, 'story_radar')
ON CONFLICT(version) DO NOTHING;
