-- Adds the six electronic RSS sources previously kept only in FALLBACK_FEEDS.
-- Safe to run again: existing source rows are refreshed by slug.
INSERT INTO sources
  (slug, name, source_type, base_url, feed_url, default_category, language,
   trust_score, enabled, polling_minutes, scope, feed_group)
VALUES
  -- Currently returns HTTP 500; retain it disabled for future re-validation.
  ('your-edm', 'Your EDM', 'rss', 'https://www.youredm.com', 'https://www.youredm.com/feed/', 'trending', 'en', 85, 0, 120, 'international', 'electronic'),
  ('dancing-astronaut', 'Dancing Astronaut', 'rss', 'https://dancingastronaut.com', 'https://dancingastronaut.com/feed/', 'trending', 'en', 85, 1, 120, 'international', 'electronic'),
  ('dj-mag', 'DJ Mag', 'rss', 'https://djmag.com', 'https://djmag.com/rss.xml', 'trending', 'en', 90, 1, 120, 'international', 'electronic'),
  -- Currently blocks Worker-style requests with HTTP 403.
  ('edm-com', 'EDM.com', 'rss', 'https://edm.com', 'https://edm.com/.rss/full/', 'trending', 'en', 85, 0, 120, 'international', 'electronic'),
  ('mixmag', 'Mixmag', 'rss', 'https://mixmag.net', 'https://mixmag.net/rss.xml', 'trending', 'en', 90, 1, 120, 'international', 'electronic'),
  ('magnetic-mag', 'Magnetic Mag', 'rss', 'https://www.magneticmag.com', 'https://www.magneticmag.com/feed/', 'trending', 'en', 80, 1, 180, 'international', 'electronic')
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  source_type = excluded.source_type,
  base_url = excluded.base_url,
  feed_url = excluded.feed_url,
  default_category = excluded.default_category,
  language = excluded.language,
  trust_score = excluded.trust_score,
  enabled = excluded.enabled,
  polling_minutes = excluded.polling_minutes,
  scope = excluded.scope,
  feed_group = excluded.feed_group;

INSERT INTO schema_migrations (version, name)
VALUES (4, 'move_remaining_electronic_feeds_to_d1')
ON CONFLICT(version) DO NOTHING;
