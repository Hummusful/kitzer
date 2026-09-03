-- Applied to D1 kitzer-news on 2026-09-03.
-- Adds the six electronic RSS sources previously kept only in FALLBACK_FEEDS.
INSERT INTO sources
  (slug, name, source_type, base_url, feed_url, default_category, language,
   trust_score, enabled, polling_minutes, scope, feed_group)
VALUES
  ('your-edm', 'Your EDM', 'rss', 'https://www.youredm.com', 'https://www.youredm.com/feed/', 'trending', 'en', 85, 1, 120, 'international', 'electronic'),
  ('dancing-astronaut', 'Dancing Astronaut', 'rss', 'https://dancingastronaut.com', 'https://dancingastronaut.com/feed/', 'trending', 'en', 85, 1, 120, 'international', 'electronic'),
  ('dj-mag', 'DJ Mag', 'rss', 'https://djmag.com', 'https://djmag.com/feeds/all', 'trending', 'en', 90, 1, 120, 'international', 'electronic'),
  ('edm-com', 'EDM.com', 'rss', 'https://edm.com', 'https://edm.com/.rss/full/', 'trending', 'en', 85, 1, 120, 'international', 'electronic'),
  ('mixmag', 'Mixmag', 'rss', 'https://mixmag.net', 'https://mixmag.net/rss', 'trending', 'en', 90, 1, 120, 'international', 'electronic'),
  ('magnetic-mag', 'Magnetic Mag', 'rss', 'https://www.magneticmag.com', 'https://www.magneticmag.com/feed/', 'trending', 'en', 80, 1, 180, 'international', 'electronic');

INSERT INTO schema_migrations (version, name)
VALUES (4, 'move_remaining_electronic_feeds_to_d1');
