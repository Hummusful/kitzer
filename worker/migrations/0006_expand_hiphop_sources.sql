-- Expand KITZER hip-hop coverage with feeds validated from a GitHub-hosted runner.
-- Time Out topic feeds are tracked but disabled because Cloudflare currently returns HTTP 403 challenge pages.

INSERT INTO sources
  (slug, name, source_type, base_url, feed_url, default_category, language,
   trust_score, enabled, polling_minutes, scope, feed_group)
VALUES
  ('timeout-hiphop-il', 'Time Out תל אביב - היפ הופ', 'rss',
   'https://timeout.co.il',
   'https://timeout.co.il/topic/%D7%94%D7%99%D7%A4-%D7%94%D7%95%D7%A4/feed/',
   'trending', 'he', 88, 0, 180, 'israel', 'hebrew'),

  ('hiphopdx', 'HipHopDX', 'rss',
   'https://hiphopdx.com', 'https://hiphopdx.com/rss/news.xml',
   'trending', 'en', 94, 1, 90, 'international', 'international'),

  ('xxl', 'XXL Mag', 'rss',
   'https://www.xxlmag.com', 'https://www.xxlmag.com/feed/',
   'trending', 'en', 91, 1, 90, 'international', 'international'),

  ('allhiphop', 'AllHipHop', 'rss',
   'https://allhiphop.com', 'https://allhiphop.com/feed/',
   'trending', 'en', 89, 1, 90, 'international', 'international'),

  ('rap-radar', 'Rap Radar', 'rss',
   'https://rapradar.com', 'https://rapradar.com/feed/',
   'trending', 'en', 88, 1, 120, 'international', 'international'),

  ('hip-hop-wired', 'Hip-Hop Wired', 'rss',
   'https://hiphopwired.com', 'https://hiphopwired.com/feed/',
   'trending', 'en', 87, 1, 120, 'international', 'international')
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
VALUES (6, 'expand_hiphop_sources')
ON CONFLICT(version) DO NOTHING;
