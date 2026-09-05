-- Add Yuval Erel's Israeli music/culture coverage via a validated Google News site-restricted RSS feed.
-- Direct WordPress-style feed URLs currently return HTML instead of RSS, so this avoids brittle HTML scraping.

INSERT INTO sources
  (slug, name, source_type, base_url, feed_url, default_category, language,
   trust_score, enabled, polling_minutes, scope, feed_group)
VALUES
  ('yuval-erel', 'הבלוג של יובל אראל', 'rss',
   'https://yuvalerel.com',
   'https://news.google.com/rss/search?q=site%3Ayuvalerel.com&hl=he&gl=IL&ceid=IL%3Ahe',
   'trending', 'he', 88, 1, 120, 'israel', 'hebrew')
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
VALUES (7, 'add_yuval_erel_source')
ON CONFLICT(version) DO NOTHING;
