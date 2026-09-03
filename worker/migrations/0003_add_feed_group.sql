-- Applied to D1 kitzer-news on 2026-09-02.
ALTER TABLE sources
ADD COLUMN feed_group TEXT NOT NULL DEFAULT 'international'
CHECK (feed_group IN ('hebrew', 'international', 'electronic'));

UPDATE sources
SET feed_group = CASE
  WHEN scope = 'israel' THEN 'hebrew'
  ELSE 'international'
END;

INSERT INTO schema_migrations (version, name)
VALUES (3, 'add_feed_group_and_move_active_fallback_feeds');
