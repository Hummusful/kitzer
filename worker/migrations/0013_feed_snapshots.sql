-- The public feed must remain available even while an upstream RSS provider is
-- slow or unavailable. The scheduled Worker refreshes this durable snapshot.
CREATE TABLE IF NOT EXISTS feed_snapshots (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

INSERT INTO schema_migrations (version, name)
VALUES (13, 'feed_snapshots')
ON CONFLICT(version) DO NOTHING;
