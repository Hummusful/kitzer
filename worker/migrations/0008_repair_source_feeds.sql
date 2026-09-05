-- Repair source feeds that moved or reject direct Cloudflare requests.
-- Direct feeds are retained where they are healthy; blocked feeds use domain-restricted Google News RSS.

UPDATE sources
SET feed_url = CASE slug
  WHEN 'dj-mag' THEN 'https://djmag.com/rss.xml'
  WHEN 'mixmag' THEN 'https://mixmag.net/rss.xml'
  WHEN 'hypebot' THEN 'https://news.google.com/rss/search?q=site%3Ahypebot.com&hl=en-US&gl=US&ceid=US%3Aen'
  WHEN 'your-edm' THEN 'https://news.google.com/rss/search?q=site%3Ayouredm.com&hl=en-US&gl=US&ceid=US%3Aen'
  WHEN 'edm-com' THEN 'https://news.google.com/rss/search?q=site%3Aedm.com&hl=en-US&gl=US&ceid=US%3Aen'
  WHEN 'magnetic-mag' THEN 'https://news.google.com/rss/search?q=site%3Amagneticmag.com&hl=en-US&gl=US&ceid=US%3Aen'
END,
last_error = NULL,
updated_at = CURRENT_TIMESTAMP
WHERE slug IN ('dj-mag', 'mixmag', 'hypebot', 'your-edm', 'edm-com', 'magnetic-mag');

INSERT INTO schema_migrations (version, name)
VALUES (8, 'repair_source_feeds')
ON CONFLICT(version) DO NOTHING;
