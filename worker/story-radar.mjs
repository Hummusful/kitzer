const LOOKBACK_MS = 72 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const GENERIC_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "from", "at", "by",
  "music", "song", "new", "says", "release", "album", "video", "announces", "announced",
  "מוזיקה", "מוסיקה", "שיר", "חדש", "חדשה", "הזמר", "זמר", "זמרת", "אלבום", "וידאו",
  "של", "את", "על", "עם", "לא", "זה", "זו", "הוא", "היא", "וגם", "אבל", "אחרי", "לקראת"
]);
const ISRAEL_HIPHOP_WORDS = new Set(["היפ", "היפ-הופ", "ראפ", "ראפר", "ראפרית", "trap", "rapper", "rap", "hiphop", "hip-hop"]);

function normalizedText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function storyTokens(value) {
  return new Set(normalizedText(value).split(" ").filter(token => (
    token.length >= 3 && !GENERIC_WORDS.has(token)
  )));
}

export function extractMainEntity(title, suppliedEntity = "") {
  const explicit = normalizedText(suppliedEntity);
  if (explicit) return explicit;

  // Headlines normally place the artist/entity first. Keep up to two meaningful
  // tokens so a shared artist alone cannot make two unrelated stories a match.
  return [...storyTokens(title)].slice(0, 2).join(" ");
}

function overlap(left, right) {
  return [...left].filter(token => right.has(token));
}

export function isStrongStoryMatch(article, cluster) {
  const articleTime = new Date(article.publishedAt || article.createdAt).getTime();
  const clusterTime = new Date(cluster.last_updated).getTime();
  if (!Number.isFinite(articleTime) || !Number.isFinite(clusterTime) ||
      Math.abs(articleTime - clusterTime) > LOOKBACK_MS) return false;

  const articleTokens = storyTokens(article.title);
  const clusterTokens = storyTokens(cluster.title);
  const shared = overlap(articleTokens, clusterTokens);
  const unionSize = new Set([...articleTokens, ...clusterTokens]).size;
  const entity = extractMainEntity(article.title, article.mainEntity);
  const clusterEntity = normalizedText(cluster.main_entity);
  const entityMatches = entity && clusterEntity && entity === clusterEntity;

  // An entity match needs two additional headline terms. This is deliberately
  // strict: "artist releases album" must not join "artist announces tour".
  const sharedBeyondEntity = shared.filter(token => !entity.split(" ").includes(token));
  if (entityMatches && sharedBeyondEntity.length >= 2) return true;

  // Permit no-entity matches only for near-identical, information-rich headlines.
  return shared.length >= 3 && unionSize > 0 && shared.length / unionSize >= 0.6;
}

export function scoreStatus(score) {
  if (score >= 150) return "hero_candidate";
  if (score >= 100) return "trending";
  if (score >= 50) return "watching";
  return "normal";
}

export function calculateStoryScore({ uniqueSources, articlesLast6Hours, followUps, freshnessScore, israelHipHopBonus }) {
  const score = uniqueSources * 12 + articlesLast6Hours * 8 + followUps * 10 + freshnessScore + israelHipHopBonus;
  return { score, status: scoreStatus(score) };
}

function freshnessScore(lastUpdated, now) {
  const ageHours = Math.max(0, (now.getTime() - new Date(lastUpdated).getTime()) / (60 * 60 * 1000));
  return Math.max(0, Math.round(48 - ageHours));
}

function hasIsraelHipHopBonus(rows) {
  return rows.some(row => /[\u0590-\u05ff]/.test(row.title || "")) &&
    rows.some(row => [...storyTokens(row.title)].some(token => ISRAEL_HIPHOP_WORDS.has(token)));
}

export function clusterMetrics(rows, now = new Date()) {
  const uniqueSources = new Set(rows.map(row => String(row.source || "").trim()).filter(Boolean)).size;
  const articlesLast6Hours = rows.filter(row => now.getTime() - new Date(row.created_at).getTime() <= SIX_HOURS_MS).length;
  const followUps = Math.max(0, rows.length - 1);
  return {
    uniqueSources,
    articlesLast6Hours,
    followUps,
    ...calculateStoryScore({
    uniqueSources,
    articlesLast6Hours,
    followUps,
    freshnessScore: freshnessScore(rows.reduce((latest, row) => latest > row.created_at ? latest : row.created_at, rows[0]?.created_at), now),
    israelHipHopBonus: hasIsraelHipHopBonus(rows) ? 20 : 0
    })
  };
}

function makeSlug(title, id) {
  const base = normalizedText(title).replace(/\s+/g, "-").slice(0, 80) || "story";
  return `${base}-${id.slice(-8)}`;
}

export async function assignArticleToStoryCluster(db, article, now = new Date()) {
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const candidates = await db.prepare(`
    SELECT id, title, main_entity, last_updated
    FROM story_clusters
    WHERE last_updated >= ?
  `).bind(cutoff).all();
  const match = (candidates.results || []).find(cluster => isStrongStoryMatch(article, cluster));
  const clusterId = match?.id || crypto.randomUUID();

  if (!match) {
    await db.prepare(`
      INSERT INTO story_clusters (
        id, title, slug, main_entity, first_seen, last_updated, story_score, article_count, source_count, status
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 'normal')
    `).bind(
      clusterId,
      article.title,
      makeSlug(article.title, clusterId),
      extractMainEntity(article.title, article.mainEntity) || null,
      article.publishedAt || nowIso,
      nowIso
    ).run();
  }

  await db.prepare(`
    INSERT OR IGNORE INTO story_cluster_articles (story_cluster_id, article_url_hash)
    VALUES (?, ?)
  `).bind(clusterId, article.urlHash).run();

  const rows = await db.prepare(`
    SELECT article.source, article.title, article.published_at AS created_at
    FROM story_cluster_articles AS link
    JOIN story_articles AS article ON article.url_hash = link.article_url_hash
    WHERE link.story_cluster_id = ?
  `).bind(clusterId).all();
  const metrics = clusterMetrics(rows.results || [], now);
  const firstSeen = article.publishedAt || nowIso;

  await db.prepare(`
    UPDATE story_clusters
    SET article_count = ?,
        source_count = ?,
        first_seen = CASE WHEN first_seen > ? THEN ? ELSE first_seen END,
        last_updated = ?,
        story_score = ?,
        status = ?
    WHERE id = ?
  `).bind(
    (rows.results || []).length,
    metrics.uniqueSources,
    firstSeen,
    firstSeen,
    nowIso,
    metrics.score,
    metrics.status,
    clusterId
  ).run();

  return { id: clusterId, created: !match, ...metrics };
}
