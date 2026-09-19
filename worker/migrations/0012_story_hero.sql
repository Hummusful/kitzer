ALTER TABLE story_articles ADD COLUMN cover TEXT;

CREATE TABLE IF NOT EXISTS story_hero_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  cluster_id TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  FOREIGN KEY (cluster_id) REFERENCES story_clusters(id) ON DELETE CASCADE
);

INSERT INTO schema_migrations (version, name)
VALUES (12, 'story_hero')
ON CONFLICT(version) DO NOTHING;
