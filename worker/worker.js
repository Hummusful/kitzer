/**
 * music-aggregator-worker.js
 * גרסה מאובטחת וסופית - כולל תיקון חסימות, Parsing ושיפור thumbnails
 */

// ----------------------------------------------------
// 1. הגדרות אבטחה וכותרות (Security Headers)
// ----------------------------------------------------
function finalizeResponse(resp, ttlSecs) {
  const r = new Response(resp.body, resp);
  const h = r.headers;
  const origin = resp.headers.get("X-Allow-Origin");

  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  h.set("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none';");
  if (origin) {
    h.set("access-control-allow-origin", origin);
    h.set("Vary", "Origin");
    h.delete("X-Allow-Origin");
  } else {
    h.delete("access-control-allow-origin");
  }
  h.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
  h.set("access-control-allow-headers", "*");

  if (ttlSecs && !h.has("cache-control")) {
    h.set("cache-control", `public, max-age=${ttlSecs}, stale-while-revalidate=3600`);
  }
  return r;
}

function getAllowedOrigin(req) {
  const origin = req.headers.get("Origin");
  if (origin === "https://kitzer.net" || origin === "https://www.kitzer.net") {
    return origin;
  }
  return null;
}

// ----------------------------------------------------
// 2. Helpers לטיפול בתמונות ו-RSS
// ----------------------------------------------------
function cleanImageUrl(url) {
  if (!url || typeof url !== "string") return null;

  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  try {
    const u = new URL(trimmed);

    // Remove known tracking params without breaking signed or transformed image URLs.
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid"
    ];
    for (const key of trackingParams) {
      u.searchParams.delete(key);
    }
    u.hash = "";

    return u.toString();
  } catch {
    return trimmed;
  }
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isBadGenericImage(url, feedConfig) {
  if (!url || typeof url !== "string") return true;

  const lower = url.toLowerCase();

  // תמונות placeholder כלליות
  if (
    lower.includes("placeholder") ||
    lower.includes("/blank.") ||
    lower.includes("default-image") ||
    lower.includes("no-image")
  ) {
    return true;
  }

  return false;
}

function scoreImageUrl(url, feedConfig) {
  if (!url || typeof url !== "string") return -100;

  let score = 0;
  const lower = url.toLowerCase();

  // Prefer real editorial image URLs and larger variants.
  if (lower.includes("wp-content/uploads")) score += 7;
  if (lower.includes("wp-content") || lower.includes("uploads")) score += 4;
  if (lower.includes("image") || lower.includes("photo") || lower.includes("media")) score += 2;
  if (lower.includes("large") || lower.includes("full") || lower.includes("master")) score += 3;
  if (lower.includes("featured") || lower.includes("lead") || lower.includes("article")) score += 3;
  if (/(1200|1024|1000|960|900|800|768|640)[x_-]/i.test(lower)) score += 3;

  // Source-specific gentle hints.
  if (feedConfig?.source === "Rolling Stone" && lower.includes("rollingstone")) score += 4;
  if (feedConfig?.source === "THR (Music)" && (lower.includes("hollywoodreporter") || lower.includes("thr"))) score += 4;

  // Penalize small, generic, or brand assets.
  if (lower.includes("logo") || lower.includes("icon") || lower.includes("avatar")) score -= 10;
  if (lower.includes("placeholder") || lower.includes("default") || lower.includes("fallback")) score -= 12;
  if (/(16x16|32x32|48x48|64x64|80x80|100x100)/i.test(lower)) score -= 8;
  if (/(150x150|200x200|300x300)/i.test(lower)) score -= 3;

  return score;
}

function getBestImageUrl(candidates, feedConfig) {
  let best = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const cleaned = cleanImageUrl(candidate);
    if (!cleaned) continue;
    if (isBadGenericImage(cleaned, feedConfig)) continue;

    const score = scoreImageUrl(cleaned, feedConfig);
    if (score > bestScore) {
      bestScore = score;
      best = cleaned;
    }
  }

  return best;
}


// ----------------------------------------------------
// 2B. Smart Music Relevance Scoring
// ----------------------------------------------------
const STRONG_MUSIC_KEYWORDS = [
  "album", "single", "song", "track", "music", "musician", "artist", "band", "singer",
  "rapper", "rap", "hip-hop", "hip hop", "pop star", "rock", "metal", "jazz", "country",
  "dj", "producer", "remix", "ep", "lp", "record", "records", "label", "lyrics",
  "playlist", "spotify", "apple music", "youtube music", "soundcloud",
  "chart", "hot 100", "grammy", "tour", "concert", "festival", "gig", "venue",
  "stage", "performance", "performed", "release", "drops", "debut", "music video",
  "electronic", "edm", "trance", "techno", "house", "dubstep", "rave",
  "מוזיקה", "מוסיקה", "שיר", "שירים", "אלבום", "סינגל", "קליפ", "להיט",
  "זמר", "זמרת", "זמרים", "להקה", "להקות", "אמן", "אמנית", "אומנים", "אמנים",
  "יוצר", "יוצרת", "ראפר", "ראפ", "היפ הופ", "די ג'יי", "דיג'יי", "מפיק",
  "הופעה", "הופעות", "פסטיבל", "במה", "סיבוב הופעות", "טור", "מצעד", "פלייליסט"
];

const SOFT_MUSIC_KEYWORDS = [
  "soundtrack", "score", "vinyl", "guitar", "piano", "drums", "vocal", "vocals",
  "collaboration", "feat", "featuring", "duet", "cover", "tribute", "indie",
  "dance", "club", "nightlife", "radio", "streaming", "catalog", "publishing",
  "זכויות", "תמלוגים", "רדיו", "סטרימינג", "קאבר", "דואט", "מחווה"
];

const NON_MUSIC_RISK_KEYWORDS = [
  "election", "senate", "congress", "president", "minister", "government", "politics",
  "bible", "church", "christian", "religion", "religious", "jesus", "pastor",
  "war", "military", "army", "terror", "crime", "murder", "trial", "court",
  "sports", "nfl", "nba", "football", "soccer", "baseball", "movie review", "tv review",
  "trailer", "box office", "בחירות", "ממשלה", "כנסת", "פוליטיקה", "ראש הממשלה",
  "נשיא", "שר ", "תנך", "תנ״ך", "דת", "דתיים", "כנסייה", "ישו", "רב ",
  "מלחמה", "צבא", "פיגוע", "טרור", "רצח", "משפט", "בית משפט", "מעצר",
  "כדורגל", "כדורסל", "ספורט", "סרט", "סדרה", "טריילר"
];

const TRUSTED_MUSIC_SOURCES = new Set([
  "Mako מוזיקה", "מעריב מוזיקה", "Walla מוזיקה", "קולומבוס", "הבלוג של יובל אראל",
  "Trancentral", "Your EDM",
  "Dancing Astronaut", "DJ Mag", "EDM.com", "EDM Sauce", "Mixmag", "Magnetic Mag",
  "Rolling Stone", "NY Times", "Pitchfork", "Stereogum", "The FADER",
  "SPIN", "XXL Mag", "The Source", "Complex Music", "Loudwire", "MBW", "Hypebot", "DMN"
]);

function countKeywordHits(text, keywords) {
  let hits = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword.toLowerCase())) hits++;
  }
  return hits;
}

function scoreMusicRelevance(title, description, feedConfig) {
  const text = `${title || ""} ${description || ""}`.toLowerCase();
  const strongHits = countKeywordHits(text, STRONG_MUSIC_KEYWORDS);
  const softHits = countKeywordHits(text, SOFT_MUSIC_KEYWORDS);
  const riskHits = countKeywordHits(text, NON_MUSIC_RISK_KEYWORDS);

  let score = 0;
  score += strongHits * 4;
  score += softHits * 2;

  // Source is only a small hint. A bad item from a music feed can still be filtered.
  if (TRUSTED_MUSIC_SOURCES.has(feedConfig?.source)) score += 1;
  if (feedConfig?.genre === "electronic") score += 2;
  if (feedConfig?.genre === "hebrew") score += 1;

  // Stronger penalty for clearly non-music topics.
  if (riskHits > 0 && strongHits === 0) score -= riskHits * 8;
  if (riskHits > 0 && strongHits > 0) score -= riskHits * 2;

  return score;
}

function hasHardNonMusicBlock(title, description) {
  const text = `${title || ""} ${description || ""}`.toLowerCase();

  const hardRisk = [
    "bible", "christian", "church", "religion", "religious", "jesus", "pastor",
    "election", "senate", "congress", "president", "government", "politics",
    "war", "military", "army", "terror", "murder", "trial", "court",
    "תנך", "תנ״ך", "נוצרי", "כנסייה", "דת", "בחירות", "פוליטיקה", "ממשלה",
    "מלחמה", "צבא", "פיגוע", "טרור", "רצח", "משפט"
  ];

  const strongHits = countKeywordHits(text, STRONG_MUSIC_KEYWORDS);
  const riskHits = countKeywordHits(text, hardRisk);

  return riskHits > 0 && strongHits === 0;
}

function isMusicRelevantEnough(title, description, feedConfig) {
  const score = scoreMusicRelevance(title, description, feedConfig);
  const hardBlocked = hasHardNonMusicBlock(title, description);
  return { keep: !hardBlocked && score >= 3, score, hardBlocked };
}



function decodeXmlEntities(value) {
  if (!value || typeof value !== "string") return "";

  const named = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
    hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’",
    ldquo: "“", rdquo: "”"
  };

  let decoded = value;
  for (let pass = 0; pass < 3; pass++) {
    const next = decoded
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function cleanFeedText(value, maxLength = 500) {
  return decodeXmlEntities(stripCdata(value || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function stripCdata(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .replace(/^<!\[CDATA\[/i, "")
    .replace(/\]\]>$/i, "")
    .trim();
}

function pushUrlCandidate(candidates, value) {
  const decoded = decodeXmlEntities(stripCdata(value || "")).trim();
  if (decoded) candidates.push(decoded);
}

function pushSrcsetCandidates(candidates, srcset) {
  const decoded = decodeXmlEntities(srcset || "");
  if (!decoded) return;

  decoded.split(",").forEach(part => {
    const url = part.trim().split(/\s+/)[0];
    if (url) candidates.push(url);
  });
}



// ----------------------------------------------------
// 3. מנוע פענוח RSS (RSS Parser Engine)
// ----------------------------------------------------
function extractCoverFromItemContent(content, feedConfig) {
  const candidates = [];

  // Direct RSS image attributes.
  const attrPatterns = [
    /<media:content[^>]*\surl=["']([^"']+)["'][^>]*>/gi,
    /<media:thumbnail[^>]*\surl=["']([^"']+)["'][^>]*>/gi,
    /<enclosure[^>]*\surl=["']([^"']+)["'][^>]*>/gi,
    /<itunes:image[^>]*\shref=["']([^"']+)["'][^>]*>/gi,
    /<image:image[^>]*\surl=["']([^"']+)["'][^>]*>/gi,
    /<thumbnail[^>]*\surl=["']([^"']+)["'][^>]*>/gi
  ];

  for (const pattern of attrPatterns) {
    for (const m of content.matchAll(pattern)) {
      pushUrlCandidate(candidates, m?.[1]);
    }
  }

  // Feed image/url blocks.
  const imageUrlPatterns = [
    /<image>[\s\S]*?<url>([\s\S]*?)<\/url>[\s\S]*?<\/image>/gi,
    /<(?:\w+:)?image[^>]*>(?:<!\[CDATA\[)?(https?:\/\/[\s\S]*?)(?:\]\]>)?<\/(?:\w+:)?image>/gi,
    /<(?:\w+:)?featuredImage[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:\w+:)?featuredImage>/gi,
    /<(?:\w+:)?thumbnail[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:\w+:)?thumbnail>/gi
  ];

  for (const pattern of imageUrlPatterns) {
    for (const m of content.matchAll(pattern)) {
      pushUrlCandidate(candidates, m?.[1]);
    }
  }

  // Decode item content once so encoded HTML like &lt;img src=&quot;...&quot;&gt; can be parsed.
  const decodedContent = decodeXmlEntities(content);

  const htmlBlockPatterns = [
    /<content:encoded[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/gi,
    /<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/gi,
    /<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/gi,
    /<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/gi
  ];

  const htmlBlocks = [decodedContent];

  for (const pattern of htmlBlockPatterns) {
    for (const m of decodedContent.matchAll(pattern)) {
      if (m?.[1]) htmlBlocks.push(decodeXmlEntities(m[1]));
    }
  }

  for (const htmlBlock of htmlBlocks) {
    const imgAttrPatterns = [
      { re: /<img[^>]*\ssrc=["']([^"']+)["']/gi, srcset: false },
      { re: /<img[^>]*\sdata-src=["']([^"']+)["']/gi, srcset: false },
      { re: /<img[^>]*\sdata-lazy-src=["']([^"']+)["']/gi, srcset: false },
      { re: /<img[^>]*\sdata-original=["']([^"']+)["']/gi, srcset: false },
      { re: /<img[^>]*\sdata-image=["']([^"']+)["']/gi, srcset: false },
      { re: /<meta[^>]*\sproperty=["']og:image["'][^>]*\scontent=["']([^"']+)["']/gi, srcset: false },
      { re: /<meta[^>]*\sname=["']twitter:image["'][^>]*\scontent=["']([^"']+)["']/gi, srcset: false },
      { re: /<source[^>]*\ssrcset=["']([^"']+)["']/gi, srcset: true },
      { re: /<img[^>]*\ssrcset=["']([^"']+)["']/gi, srcset: true }
    ];

    for (const item of imgAttrPatterns) {
      for (const m of htmlBlock.matchAll(item.re)) {
        const value = m?.[1];
        if (!value) continue;
        if (item.srcset) pushSrcsetCandidates(candidates, value);
        else pushUrlCandidate(candidates, value);
      }
    }

    // Raw image URLs inside item content.
    for (const m of htmlBlock.matchAll(/https?:\/\/[^\s"'<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]+)?/gi)) {
      pushUrlCandidate(candidates, m?.[0]);
    }
  }

  return getBestImageUrl(candidates, feedConfig);
}

function parseRSS(xmlText, feedConfig) {
  const items = [];

  // תיקון Regex: הוספת Flag 'i' וגמישות בתגיות
  const itemBlocks = xmlText.matchAll(
    /<\s*(?:\w+:)?(item|entry)\b[^>]*>([\s\S]*?)<\/\s*(?:\w+:)?\1\s*>/gi
  );

  for (const block of itemBlocks) {
    const content = block[2];

    const title =
      content.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || "";

    const guid =
      content.match(/<guid[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/guid>/i)?.[1] ||
      "";

    let link =
      content.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ||
      content.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ||
      content.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i)?.[1] ||
      (isHttpUrl(guid.trim()) ? guid : "") ||
      "";

    let pubDate =
      content.match(/<(pubDate|updated|published|dc:date)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ||
      content.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1] ||
      "";

    const descriptionRaw =
      content.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] ||
      content.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i)?.[1] ||
      content.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/i)?.[1] ||
      "";

    const cleanedTitle = cleanFeedText(title, 500);
    const cleanedDescription = cleanFeedText(descriptionRaw, 200);
    link = decodeXmlEntities(stripCdata(link)).trim();

    const cover = extractCoverFromItemContent(content, feedConfig);
    const relevance = isMusicRelevantEnough(cleanedTitle, cleanedDescription, feedConfig);

    if (cleanedTitle && link && relevance.keep) {
      items.push({
        title: cleanedTitle,
        link,
        date: pubDate,
        description: cleanedDescription,
        source: feedConfig.source,
        lang: feedConfig.lang,
        genre: feedConfig.genre || "general",
        music_score: relevance.score,
        cover: (typeof cover === "string" && cover.startsWith("http")) ? cover : null,
cover_text: feedConfig.source
      });
    }
  }

  return items;
}

// ----------------------------------------------------
// 4. פונקציית עזר לנרמול מפתח ה-Cache
// ----------------------------------------------------
function getNormalizedCacheKey(reqUrl) {
  const u = new URL(reqUrl);
  const cleanParams = new URLSearchParams();
  const allowed = ["days", "limit", "genre", "q", "lite"];
  allowed.forEach(p => {
    if (u.searchParams.has(p)) cleanParams.set(p, u.searchParams.get(p));
  });
  cleanParams.sort();
  u.search = cleanParams.toString();
  u.searchParams.set("_filterv", "healthdedup2");
  return new Request(u.toString(), { method: "GET" });
}

async function fetchWithConcurrencyLimit(tasks, limit = 6) {
  const results = [];
  const executing = [];

  for (const task of tasks) {
    const p = task().then(result => {
      executing.splice(executing.indexOf(p), 1);
      return result;
    });

    results.push(p);
    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

// Spotify Trending for Israel
// Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET via wrangler:
// wrangler secret put SPOTIFY_CLIENT_ID
// wrangler secret put SPOTIFY_CLIENT_SECRET
async function fetchSpotifyTrending(env) {
  try {
    const clientId = env.SPOTIFY_CLIENT_ID;
    const clientSecret = env.SPOTIFY_CLIENT_SECRET;
    console.log('Spotify - clientId exists:', !!clientId, 'clientSecret exists:', !!clientSecret);
    if (!clientId || !clientSecret) {
      console.log('Spotify credentials missing');
      return [];
    }

    // Get access token
    const authRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`
    });
    const auth = await authRes.json();
    console.log('Spotify auth response:', auth.access_token ? 'got token' : 'no token');
    if (!auth.access_token) {
      console.log('Spotify auth failed:', auth);
      return [];
    }

    // Get trending tracks (Israeli top 50)
    const res = await fetch('https://api.spotify.com/v1/playlists/37i9dQZEVXbJ6IpvItkve3', {
      headers: { 'Authorization': `Bearer ${auth.access_token}` }
    });
    console.log('Spotify playlist response:', res.status);
    if (!res.ok) {
      console.log('Spotify playlist failed:', res.status);
      return [];
    }

    const data = await res.json();
    const items = [];
    for (const track of data.tracks.items.slice(0, 10)) {
      items.push({
        title: `${track.name} — ${track.artists[0].name}`,
        link: track.external_urls.spotify,
        date: new Date().toISOString(),
        description: track.artists.map(a => a.name).join(', '),
        source: 'Spotify Trending IL',
        lang: 'HE',
        genre: 'hebrew',
        music_score: 9,
        cover: track.album.images[0]?.url || null,
        cover_text: 'Spotify'
      });
    }
    console.log('Spotify returned:', items.length, 'items');
    return items;
  } catch (err) {
    console.error('Spotify error:', err);
    return [];
  }
}

// Last.fm Trending (no auth required)
async function fetchLastFmTrending(env) {
  try {
    const apiKey = env.LASTFM_API_KEY;
    if (!apiKey) return [];

    const url = new URL('https://ws.audioscrobbler.com/2.0/');
    url.searchParams.set('method', 'chart.getTopTracks');
    url.searchParams.set('limit', '15');
    url.searchParams.set('format', 'json');
    url.searchParams.set('api_key', apiKey);
    const res = await fetch(url);
    console.log('Last.fm response:', res.status);
    if (!res.ok) {
      console.log('Last.fm failed:', res.status);
      return [];
    }

    const data = await res.json();
    console.log('Last.fm data received, tracks:', data.tracks?.track?.length);
    const items = [];
    for (const track of data.tracks.track.slice(0, 10)) {
      items.push({
        title: `${track.name} — ${track.artist.name}`,
        link: track.url,
        date: new Date().toISOString(),
        description: `Listeners: ${track.listeners}`,
        source: 'Last.fm Trending',
        lang: 'EN',
        genre: 'international',
        music_score: 8,
        cover: null,
        cover_text: 'Last.fm'
      });
    }
    console.log('Last.fm returned:', items.length, 'items');
    return items;
  } catch (err) {
    console.error('Last.fm error:', err);
    return [];
  }
}
async function loadEnabledRssFeeds(env) {
  const result = await env.KITZER_NEWS_DB.prepare(`
    SELECT
      id,
      slug,
      name,
      feed_url,
      language,
      feed_group
    FROM sources
    WHERE enabled = 1
      AND source_type = 'rss'
      AND feed_url IS NOT NULL
    ORDER BY trust_score DESC, name ASC
  `).all();

  return (result.results || []).map(row => ({
    sourceId: row.id,
    slug: row.slug,
    url: row.feed_url,
    source: row.name,
    lang: String(row.language || "en").toUpperCase(),
    genre: String(row.feed_group || "international").toLowerCase()
  }));
}
async function recordSourceHealth(env, feed, errorMessage = null) {
  if (!feed?.sourceId) return;

  const now = new Date().toISOString();
  const error = errorMessage ? String(errorMessage).slice(0, 500) : null;
  await env.KITZER_NEWS_DB.prepare(`
    UPDATE sources
    SET last_checked_at = ?,
        last_success_at = CASE WHEN ? IS NULL THEN ? ELSE last_success_at END,
        last_error = ?,
        updated_at = ?
    WHERE id = ?
  `).bind(now, error, now, error, now, feed.sourceId).run();
}

async function recordSourceHealthSafely(env, feed, errorMessage = null) {
  try {
    await recordSourceHealth(env, feed, errorMessage);
  } catch (healthError) {
    // Observability must never suppress otherwise valid articles.
    console.error("Source health update failed", feed?.source, healthError);
  }
}

const STORY_STOP_WORDS = new Set([
  "the","a","an","and","or","of","to","in","on","for","with","from","at","by",
  "new","music","song","album","video","says","after","about","into","their","his","her",
  "של","את","על","עם","לא","זה","זו","חדש","חדשה","שיר","אלבום","מוזיקה","מוסיקה",
  "אחרי","לקראת","מתוך","הוא","היא","וגם","אבל"
]);

function normalizeStoryTitle(title) {
  return decodeXmlEntities(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getStoryTokens(title) {
  return new Set(
    normalizeStoryTitle(title)
      .split(" ")
      .filter(token => token.length >= 3 && !STORY_STOP_WORDS.has(token))
  );
}

function areRelatedStories(a, b) {
  const aTitle = normalizeStoryTitle(a.title);
  const bTitle = normalizeStoryTitle(b.title);
  if (!aTitle || !bTitle) return false;
  if (aTitle === bTitle) return true;

  const timeA = new Date(a.date).getTime();
  const timeB = new Date(b.date).getTime();
  if (Number.isFinite(timeA) && Number.isFinite(timeB) &&
      Math.abs(timeA - timeB) > 72 * 60 * 60 * 1000) return false;

  const aTokens = getStoryTokens(a.title);
  const bTokens = getStoryTokens(b.title);
  const intersection = [...aTokens].filter(token => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection >= 3 && union > 0 && intersection / union >= 0.55;
}

function mergeRelatedStories(items) {
  const merged = [];

  for (const item of items) {
    const match = merged.find(existing => areRelatedStories(existing, item));
    if (!match) {
      merged.push({
        ...item,
        sources: [{ name: item.source, url: item.link }],
        source_count: 1
      });
      continue;
    }

    if (!match.sources.some(source => source.url === item.link)) {
      match.sources.push({ name: item.source, url: item.link });
      match.source_count = match.sources.length;
    }

    const itemScore = Number(item.music_score || 0);
    const matchScore = Number(match.music_score || 0);
    if (itemScore > matchScore || (!match.cover && item.cover)) {
      match.title = item.title;
      match.description = item.description;
      match.cover = item.cover || match.cover;
      match.cover_text = item.cover_text;
      match.music_score = item.music_score;
      match.link = item.link;
      match.source = item.source;
    }

    if (new Date(item.date).getTime() > new Date(match.date).getTime()) {
      match.date = item.date;
    }
  }

  return merged;
}

// ----------------------------------------------------
// 5. WORKER MAIN FETCH HANDLER
// ----------------------------------------------------
export default {
  async fetch(req, env, ctx) {
    let allowedOrigin = null;

    try {
      const url = new URL(req.url);
      allowedOrigin = getAllowedOrigin(req);

      if (req.method === "OPTIONS") {
        return finalizeResponse(new Response(null, {
          status: 204,
          headers: allowedOrigin ? { "X-Allow-Origin": allowedOrigin } : {}
        }));
      }

      const p = url.pathname.replace(/\/+$/, "");
      if (p === "/api/news-db-health") {
        const sourceResult = await env.KITZER_NEWS_DB.prepare(`
          SELECT
            id, slug, name, feed_group, enabled,
            last_checked_at, last_success_at, last_error,
            CASE
              WHEN enabled = 0 THEN 'disabled'
              WHEN last_checked_at IS NULL THEN 'never_checked'
              WHEN last_error IS NOT NULL THEN 'failed'
              ELSE 'ok'
            END AS status
          FROM sources
          ORDER BY feed_group, name
        `).all();

        const sources = sourceResult.results || [];
        const summary = sources.reduce((acc, source) => {
          acc.total++;
          if (source.enabled) acc.enabled++;
          acc[source.status] = (acc[source.status] || 0) + 1;
          return acc;
        }, { total: 0, enabled: 0, ok: 0, failed: 0, never_checked: 0, disabled: 0 });

        return finalizeResponse(
          new Response(JSON.stringify({ ok: summary.failed === 0, summary, sources }), {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              ...(allowedOrigin ? { "X-Allow-Origin": allowedOrigin } : {})
            }
          }),
          0
        );
      }
      if (!["", "/api", "/api/music"].includes(p)) {
        return finalizeResponse(new Response("Not Found", {
          status: 404,
          headers: allowedOrigin ? { "X-Allow-Origin": allowedOrigin } : {}
        }));
      }

      const cacheKey = getNormalizedCacheKey(req.url);
      const cache = caches.default;

      let cachedRes = await cache.match(cacheKey);
      if (cachedRes && !url.searchParams.has("nocache")) {
        const r = new Response(cachedRes.body, cachedRes);
        r.headers.set("X-Worker-Cache", "HIT");
        // Ensure CORS header is set for cached responses too
        if (allowedOrigin) {
          r.headers.set("X-Allow-Origin", allowedOrigin);
        }
        return finalizeResponse(r);
      }

      const filterQ = (url.searchParams.get("q") || "").slice(0, 50).toLowerCase();
      const filterGenre = (url.searchParams.get("genre") || "").slice(0, 30).toLowerCase();
      const limit = Math.min(parseInt(url.searchParams.get("limit")) || 40, 80);
      const daysBack = Math.min(parseInt(url.searchParams.get("days")) || 3, 365);

      const FALLBACK_FEEDS = [
        // HEBREW 🇮🇱
        { url: "https://rss.walla.co.il/feed/272", source: "Walla מוזיקה", lang: "HE", genre: "hebrew" },
        { url: "https://columbusmusicmagazine.com/feed/", source: "קולומבוס", lang: "HE", genre: "hebrew" },
        { url: "https://www.maariv.co.il/rss/rssfeedsmozika", source: "מעריב - מוזיקה", lang: "HE", genre: "hebrew" },
        // Ynet's official culture feed is broader than music, so every item still
        // passes through the worker's music relevance filter before publication.
        { url: "https://www.ynet.co.il/Integration/StoryRss538.xml", source: "Ynet תרבות", lang: "HE", genre: "hebrew" },

        // ELECTRONIC 🔊
        { url: "https://trancentral.tv/feed/", source: "Trancentral", lang: "EN", genre: "electronic" },
        { url: "https://dancingastronaut.com/feed/", source: "Dancing Astronaut", lang: "EN", genre: "electronic" },
        { url: "https://djmag.com/rss.xml", source: "DJ Mag", lang: "EN", genre: "electronic" },
        { url: "https://www.edmsauce.com/feed/", source: "EDM Sauce", lang: "EN", genre: "electronic" },
        { url: "https://mixmag.net/rss.xml", source: "Mixmag", lang: "EN", genre: "electronic" },
        { url: "https://news.google.com/rss/search?q=site%3Amagneticmag.com&hl=en-US&gl=US&ceid=US%3Aen", source: "Magnetic Mag", lang: "EN", genre: "electronic" },

        // INTERNATIONAL 🌎
        { url: "https://www.thefader.com/feed/rss", source: "The FADER", lang: "EN", genre: "international" },
        { url: "https://thesource.com/feed/", source: "The Source", lang: "EN", genre: "international" },
        { url: "https://www.complex.com/music/rss", source: "Complex Music", lang: "EN", genre: "international" },
        { url: "https://www.musicbusinessworldwide.com/feed/", source: "MBW", lang: "EN", genre: "international" },
        { url: "https://www.hollywoodreporter.com/c/music/music-news/feed/", source: "THR (Music)", lang: "EN", genre: "international" },
        { url: "https://news.google.com/rss/search?q=site%3Ahypebot.com&hl=en-US&gl=US&ceid=US%3Aen", source: "Hypebot", lang: "EN", genre: "international" },
        { url: "https://www.digitalmusicnews.com/feed/", source: "DMN", lang: "EN", genre: "international" }
        
      ];

      let FEEDS;

      try {
        const dbFeeds = await loadEnabledRssFeeds(env);
        if (dbFeeds.length === 0) {
          throw new Error("D1 returned no enabled RSS sources");
        }
        // D1 is the source of truth for ingestion whenever it is available.
        FEEDS = dbFeeds;
      } catch (error) {
        console.error("D1 source loading failed; using fallback feeds", error);
        FEEDS = FALLBACK_FEEDS;
      }

      // ✅ PERFORMANCE OPTIMIZATION: Filter feeds by genre BEFORE fetching
      // This reduces first-visit load time by 60-75% for specific genres
      let feedsToFetch = FEEDS;
      
      if (filterGenre && filterGenre !== 'all') {
        feedsToFetch = FEEDS.filter(f => f.genre === filterGenre);
        // Hebrew: fetch only the Israeli/music sources.
        // Electronic: 8 feeds instead of 27 (60% reduction)
        // International: 16 feeds instead of 27 (40% reduction)
      }

      const tasks = feedsToFetch.map(feed => async () => {
        let timeout;
        try {
          const controller = new AbortController();
          timeout = setTimeout(() => controller.abort(), 6000);

          const res = await fetch(feed.url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/xml, application/xml, application/rss+xml, */*"
            },
            signal: controller.signal
          });

          if (!res.ok) {
            await recordSourceHealthSafely(env, feed, `HTTP ${res.status}`);
            return [];
          }

          const text = await res.text();
          const items = parseRSS(text, feed);
          await recordSourceHealthSafely(env, feed);
          return items;
        } catch (error) {
          await recordSourceHealthSafely(
            env,
            feed,
            error?.name === "AbortError" ? "Timeout" : error?.message || "Fetch failed"
          );
          return [];
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      });

      const resultsArray = await fetchWithConcurrencyLimit(tasks, 10);

      let allItems = resultsArray.flat();

      // Add trending data from APIs
      if (!filterGenre || filterGenre === 'hebrew') {
        const spotifyItems = await fetchSpotifyTrending(env);
        allItems.push(...spotifyItems);
      }

      if (!filterGenre || filterGenre === 'international') {
        const lastfmItems = await fetchLastFmTrending(env);
        allItems.push(...lastfmItems);
      }

      const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

      allItems = allItems.filter(i => {
        const d = new Date(i.date).getTime();
        return !isNaN(d) && d >= cutoff;
      });

      if (filterQ) {
        allItems = allItems.filter(i =>
          (i.title || "").toLowerCase().includes(filterQ) ||
          (i.description || "").toLowerCase().includes(filterQ)
        );
      }

      // Only filter by genre if it's not 'all' (genre=all means fetch everything)
      if (filterGenre && filterGenre !== 'all') {
        allItems = allItems.filter(i => i.genre === filterGenre);
      }

      const storiesBeforeMerge = allItems.length;
      allItems = mergeRelatedStories(allItems);
      const duplicatesMerged = storiesBeforeMerge - allItems.length;

      allItems.sort((a, b) => {
        // Keep the feed fresh, but prevent weakly-related stories from becoming the top story.
        const aTier = (a.music_score || 0) >= 7 ? 1 : 0;
        const bTier = (b.music_score || 0) >= 7 ? 1 : 0;
        if (aTier !== bTier) return bTier - aTier;
        return new Date(b.date) - new Date(a.date);
      });
      const finalItems = allItems.slice(0, limit);

      const responseBody = JSON.stringify({
        meta: {
          count: finalItems.length,
          feeds_checked: feedsToFetch.length,
          duplicates_merged: duplicatesMerged,
          generated_at: new Date().toISOString()
},
        items: finalItems
      });

      const response = new Response(responseBody, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...(allowedOrigin ? { "X-Allow-Origin": allowedOrigin } : {})
        }
      });

      const ttl = filterQ ? 300 : 1800;
      const finalRes = finalizeResponse(response, ttl);

      ctx.waitUntil(cache.put(cacheKey, finalRes.clone()));
      return finalRes;
    } catch (err) {
      console.error("Worker failure:", err);
      return finalizeResponse(
        new Response(
          JSON.stringify({
            error: "Server Error"
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              ...(allowedOrigin ? { "X-Allow-Origin": allowedOrigin } : {})
            }
          }
        ),
        0
      );
    }
  }
};
