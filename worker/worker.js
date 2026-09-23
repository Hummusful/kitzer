/**
 * music-aggregator-worker.js
 * גרסה מאובטחת וסופית - כולל תיקון חסימות, Parsing ושיפור thumbnails
 */

import { assignArticleToStoryCluster, extractMainEntity, isStrongStoryMatch } from "./story-radar.mjs";

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
    h.set("access-control-allow-credentials", "true");
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
  if (
    origin === "https://kitzer.net" ||
    origin === "https://www.kitzer.net" ||
    origin === "https://hummusful.github.io"
  ) {
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
  u.searchParams.set("_filterv", "balancedfresh4");
  return new Request(u.toString(), { method: "GET" });
}

function normalizeStoryArticleUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const HERO_LOOKBACK_MS = 72 * 60 * 60 * 1000;
const HERO_HOLD_MS = 2 * 60 * 60 * 1000;
const HERO_REPLACEMENT_MARGIN = 15;
const CROSS_LANGUAGE_STORY_IDENTITIES = [
  ["ed sheeran", "אד שירן"],
  ["macklemore", "מקלמור"]
].map((aliases, index) => ({ key: `identity-${index}`, aliases: aliases.map(normalizeStoryTitle) }));

function crossLanguageIdentityKeys(title) {
  const normalized = normalizeStoryTitle(title);
  return CROSS_LANGUAGE_STORY_IDENTITIES
    .filter(({ aliases }) => aliases.some(alias => normalized.includes(alias)))
    .map(({ key }) => key);
}

export function areCrossLanguageStoryMatches(left, right) {
  const leftTime = new Date(left?.published_at || left?.date).getTime();
  const rightTime = new Date(right?.published_at || right?.date).getTime();
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && Math.abs(leftTime - rightTime) > HERO_LOOKBACK_MS) return false;
  const leftKeys = crossLanguageIdentityKeys(left?.title || "");
  const rightKeys = new Set(crossLanguageIdentityKeys(right?.title || ""));
  // Require two named identities. This prevents every unrelated item about the
  // same artist from being folded into one story.
  return leftKeys.filter(key => rightKeys.has(key)).length >= 2;
}

export function isEligibleStoryHero(cluster, now = new Date()) {
  const updatedAt = new Date(cluster.last_updated).getTime();
  return cluster.status === "hero_candidate" &&
    Number(cluster.source_count) >= 3 &&
    Number.isFinite(updatedAt) &&
    updatedAt >= now.getTime() - HERO_LOOKBACK_MS;
}

export function hasUsableStoryHeroCover(cover) {
  return isHttpUrl(cover);
}

export function chooseStoryHeroArticle(articles) {
  return [...articles].sort((left, right) => {
    const coverOrder = Number(hasUsableStoryHeroCover(right.cover)) - Number(hasUsableStoryHeroCover(left.cover));
    return coverOrder || new Date(right.published_at).getTime() - new Date(left.published_at).getTime();
  })[0] || null;
}

const STORY_HERO_ARTICLE_ORDER = "CASE WHEN article.cover LIKE 'https://%' OR article.cover LIKE 'http://%' THEN 0 ELSE 1 END, article.published_at DESC";

export function chooseStoryHero(candidates, state, now = new Date()) {
  const eligible = candidates.filter(cluster => isEligibleStoryHero(cluster, now))
    .sort((left, right) => Number(right.story_score) - Number(left.story_score) ||
      new Date(right.last_updated).getTime() - new Date(left.last_updated).getTime());
  if (!eligible.length) return null;

  const current = eligible.find(cluster => cluster.id === state?.cluster_id);
  if (!current) return eligible[0];

  const selectedAt = new Date(state.selected_at).getTime();
  if (!Number.isFinite(selectedAt) || now.getTime() - selectedAt < HERO_HOLD_MS) return current;

  const challenger = eligible[0];
  if (challenger.id !== current.id && Number(challenger.story_score) >= Number(current.story_score) + HERO_REPLACEMENT_MARGIN) {
    return challenger;
  }
  return current;
}

// A confirmed Hero needs corroboration from several sources. Until then, a
// developing multi-source story can occupy the slot as a fallback.
export function isEligibleStoryHeroFallback(cluster, now = new Date()) {
  const updatedAt = new Date(cluster.last_updated).getTime();
  return Number(cluster.source_count) >= 2 &&
    (cluster.status === "watching" || cluster.status === "trending") &&
    Number.isFinite(updatedAt) &&
    updatedAt >= now.getTime() - HERO_LOOKBACK_MS &&
    typeof cluster.title === "string" && cluster.title.trim().length > 0 &&
    typeof cluster.url === "string" && isHttpUrl(cluster.url);
}

export function chooseStoryHeroFallback(candidates, state, now = new Date()) {
  const eligible = candidates.filter(cluster => isEligibleStoryHeroFallback(cluster, now))
    .sort((left, right) => Number(right.story_score) - Number(left.story_score) ||
      new Date(right.last_updated).getTime() - new Date(left.last_updated).getTime());
  if (!eligible.length) return null;

  const current = eligible.find(cluster => cluster.id === state?.cluster_id);
  if (!current) return eligible[0];

  const selectedAt = new Date(state.selected_at).getTime();
  if (!Number.isFinite(selectedAt) || now.getTime() - selectedAt < HERO_HOLD_MS) return current;

  const challenger = eligible[0];
  if (challenger.id !== current.id && Number(challenger.story_score) >= Number(current.story_score) + HERO_REPLACEMENT_MARGIN) {
    return challenger;
  }
  return current;
}

export function getStoryHeroSelectionType(confirmedHero) {
  return confirmedHero ? "hero" : "fallback";
}

export function collectHeroSources(rows) {
  const seen = new Set();
  return rows
    .map(row => ({
      name: String(row?.source || "מקור מוזיקה").trim().slice(0, 120),
      title: String(row?.title || "").trim().slice(0, 300),
      url: String(row?.article_url || "").trim(),
      cover: hasUsableStoryHeroCover(row?.cover) ? String(row.cover).trim() : null
    }))
    .filter(source => isHttpUrl(source.url) && !seen.has(source.url) && seen.add(source.url));
}

export function buildCoherentHeroCandidate(cluster, rows) {
  const articles = rows.filter(row => isHttpUrl(row.article_url) && row.title && Number.isFinite(new Date(row.published_at).getTime()));
  let best = [];
  for (const anchor of articles) {
    const related = articles.filter(article => article === anchor ||
      isStrongStoryMatch(
        { title: article.title, publishedAt: article.published_at },
        { title: anchor.title, main_entity: extractMainEntity(anchor.title), last_updated: anchor.published_at }
      ) || areCrossLanguageStoryMatches(anchor, article));
    const sourceCount = new Set(related.map(article => article.source)).size;
    const bestSourceCount = new Set(best.map(article => article.source)).size;
    if (sourceCount > bestSourceCount || (sourceCount === bestSourceCount && related.length > best.length)) best = related;
  }
  const sourceCount = new Set(best.map(article => article.source)).size;
  if (sourceCount < 2) return null;
  const article = chooseStoryHeroArticle(best);
  return {
    ...cluster,
    title: article.title,
    article_title: article.title,
    url: article.article_url,
    cover: article.cover,
    source: article.source,
    published_at: article.published_at,
    article_count: best.length,
    source_count: sourceCount,
    story_score: Math.round(Number(cluster.story_score || 0) * best.length / Math.max(Number(cluster.article_count || 0), best.length)),
    status: sourceCount >= 3 ? "hero_candidate" : "trending",
    coherentRows: best
  };
}

async function handleStoryHero(request, env, allowedOrigin) {
  if (request.method !== "GET") {
    return finalizeResponse(new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", ...(allowedOrigin ? { "X-Allow-Origin": allowedOrigin } : {}) }
    }), 0);
  }
  if (!env.KITZER_NEWS_DB) {
    return finalizeResponse(new Response(JSON.stringify({ error: "D1_BINDING_MISSING" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", ...(allowedOrigin ? { "X-Allow-Origin": allowedOrigin } : {}) }
    }), 0);
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - HERO_LOOKBACK_MS).toISOString();
  try {
    const [candidatesResult, state] = await Promise.all([
      env.KITZER_NEWS_DB.prepare(`
        SELECT
          cluster.id, cluster.title, cluster.story_score, cluster.source_count,
          cluster.article_count, cluster.status, cluster.last_updated,
          (
            SELECT article.title
            FROM story_cluster_articles AS link
            JOIN story_articles AS article ON article.url_hash = link.article_url_hash
            WHERE link.story_cluster_id = cluster.id
            ORDER BY ${STORY_HERO_ARTICLE_ORDER}
            LIMIT 1
          ) AS article_title,
          (
            SELECT article.article_url
            FROM story_cluster_articles AS link
            JOIN story_articles AS article ON article.url_hash = link.article_url_hash
            WHERE link.story_cluster_id = cluster.id
            ORDER BY ${STORY_HERO_ARTICLE_ORDER}
            LIMIT 1
          ) AS url,
          (
            SELECT article.cover
            FROM story_cluster_articles AS link
            JOIN story_articles AS article ON article.url_hash = link.article_url_hash
            WHERE link.story_cluster_id = cluster.id
            ORDER BY ${STORY_HERO_ARTICLE_ORDER}
            LIMIT 1
          ) AS cover,
          (
            SELECT article.source
            FROM story_cluster_articles AS link
            JOIN story_articles AS article ON article.url_hash = link.article_url_hash
            WHERE link.story_cluster_id = cluster.id
            ORDER BY ${STORY_HERO_ARTICLE_ORDER}
            LIMIT 1
          ) AS source,
          (
            SELECT article.published_at
            FROM story_cluster_articles AS link
            JOIN story_articles AS article ON article.url_hash = link.article_url_hash
            WHERE link.story_cluster_id = cluster.id
            ORDER BY ${STORY_HERO_ARTICLE_ORDER}
            LIMIT 1
          ) AS published_at
        FROM story_clusters AS cluster
        WHERE cluster.last_updated >= ?
        ORDER BY cluster.story_score DESC, cluster.last_updated DESC
        LIMIT 30
      `).bind(cutoff).all(),
      env.KITZER_NEWS_DB.prepare(`
        SELECT cluster_id, selected_at
        FROM story_hero_state
        WHERE singleton = 1
      `).first()
    ]);

    const rawCandidates = candidatesResult.results || [];
    const ids = rawCandidates.map(candidate => candidate.id);
    const linkedArticles = ids.length ? await env.KITZER_NEWS_DB.prepare(`
      SELECT link.story_cluster_id, article.source, article.title, article.article_url, article.cover, article.published_at
      FROM story_cluster_articles AS link
      JOIN story_articles AS article ON article.url_hash = link.article_url_hash
      WHERE link.story_cluster_id IN (${ids.map(() => "?").join(",")})
      ORDER BY article.published_at DESC
    `).bind(...ids).all() : { results: [] };
    const rowsByCluster = new Map();
    for (const row of linkedArticles.results || []) {
      if (!rowsByCluster.has(row.story_cluster_id)) rowsByCluster.set(row.story_cluster_id, []);
      rowsByCluster.get(row.story_cluster_id).push(row);
    }
    const candidates = rawCandidates
      .map(candidate => buildCoherentHeroCandidate(candidate, rowsByCluster.get(candidate.id) || []))
      .filter(Boolean);
    const confirmedHero = chooseStoryHero(candidates, state, now);
    const hero = confirmedHero || chooseStoryHeroFallback(candidates, state, now);
    if (!hero) {
      if (state) await env.KITZER_NEWS_DB.prepare("DELETE FROM story_hero_state WHERE singleton = 1").run();
      return finalizeResponse(new Response(JSON.stringify({ hero: null }), {
        headers: { "Content-Type": "application/json; charset=utf-8", ...(allowedOrigin ? { "X-Allow-Origin": allowedOrigin } : {}) }
      }), 0);
    }

    if (hero.id !== state?.cluster_id) {
      await env.KITZER_NEWS_DB.prepare(`
        INSERT INTO story_hero_state (singleton, cluster_id, selected_at)
        VALUES (1, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET cluster_id = excluded.cluster_id, selected_at = excluded.selected_at
      `).bind(hero.id, now.toISOString()).run();
    }

    const recentArticles = await env.KITZER_NEWS_DB.prepare(`
        SELECT source, title, article_url, cover, published_at
        FROM story_articles
        WHERE published_at >= ?
        ORDER BY published_at DESC
        LIMIT 120
      `).bind(cutoff).all();
    const siblingSources = (recentArticles.results || []).filter(article => areCrossLanguageStoryMatches(hero.article_title ? { title: hero.article_title, published_at: hero.published_at } : hero, article));
    const sources = collectHeroSources([...hero.coherentRows, ...siblingSources]);

    return finalizeResponse(new Response(JSON.stringify({
      hero: {
        selection_type: getStoryHeroSelectionType(confirmedHero),
        cluster: {
          id: hero.id,
          title: hero.title,
          score: hero.story_score,
          source_count: hero.source_count,
          article_count: hero.article_count
        },
        article: {
          title: hero.article_title,
          url: hero.url,
          cover: hero.cover,
          source: hero.source,
          published_at: hero.published_at
        },
        sources
      }
    }), {
      headers: { "Content-Type": "application/json; charset=utf-8", ...(allowedOrigin ? { "X-Allow-Origin": allowedOrigin } : {}) }
    }), 0);
  } catch (error) {
    console.error("Story Hero unavailable", String(error?.message || error));
    return finalizeResponse(new Response(JSON.stringify({ error: "STORY_HERO_UNAVAILABLE" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", ...(allowedOrigin ? { "X-Allow-Origin": allowedOrigin } : {}) }
    }), 0);
  }
}

export async function ingestRssStoryArticles(db, items, {
  assign = assignArticleToStoryCluster,
  now = () => new Date()
} = {}) {
  const seen = new Set();
  const candidates = items
    .map(item => {
      const articleUrl = normalizeStoryArticleUrl(item.link);
      const publishedAt = new Date(item.date);
      return articleUrl && Number.isFinite(publishedAt.getTime()) ? { item, articleUrl, publishedAt } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.publishedAt - left.publishedAt)
    .filter(({ articleUrl }) => {
      if (seen.has(articleUrl)) return false;
      seen.add(articleUrl);
      return true;
    });

  let newArticles = 0;
  for (const { item, articleUrl, publishedAt } of candidates) {
    if (newArticles >= 250) break;
    try {
      const urlHash = await sha256Hex(articleUrl);
      const createdAt = now().toISOString();
      const result = await db.prepare(`
        INSERT OR IGNORE INTO story_articles (
          url_hash, article_url, title, source, published_at, created_at, cover
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        urlHash,
        articleUrl,
        String(item.title || "").slice(0, 500) || null,
        String(item.source || "").slice(0, 200) || null,
        publishedAt.toISOString(),
        createdAt,
        typeof item.cover === "string" && item.cover.startsWith("http") ? item.cover : null
      ).run();

      if (Number(result.meta?.changes) !== 1) {
        if (typeof item.cover === "string" && item.cover.startsWith("http")) {
          await db.prepare(`
            UPDATE story_articles
            SET cover = ?
            WHERE url_hash = ? AND (cover IS NULL OR trim(cover) = '')
          `).bind(item.cover, urlHash).run();
        }
        continue;
      }
      newArticles += 1;
      await assign(db, {
        urlHash,
        title: String(item.title || "").slice(0, 500),
        source: String(item.source || "").slice(0, 200),
        publishedAt: publishedAt.toISOString()
      }, new Date(createdAt));
    } catch (error) {
      // Background RSS ingestion must never delay or fail the public response.
      console.error("Story Radar RSS ingest failed", String(error?.message || error));
    }
  }
}

// ----------------------------------------------------
// 4B. Media Forest weekly charts
// ----------------------------------------------------
const MEDIA_FOREST_BASE = "https://mediaforest-group.com";
const MEDIA_FOREST_CHARTS = {
  israeliSongs: { file: "RadioHe.json", type: "songs" },
  internationalSongs: { file: "RadioEn.json", type: "songs" },
  israeliArtists: { file: "RadioArtistsHe.json", type: "artists" },
  internationalArtists: { file: "RadioArtistsEn.json", type: "artists" }
};

function chartNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).match(/\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function firstChartNumber(entry, keys) {
  for (const key of keys) {
    const number = chartNumber(entry?.[key]);
    if (number !== null) return number;
  }
  return null;
}

function findCurrentChartRank(entry) {
  const explicit = firstChartNumber(entry, [
    "thisweek", "thisWeek", "this_week", "thisWeekPosition", "this_week_position",
    "current", "currentPosition", "current_position", "currentRank", "current_rank",
    "currentPlace", "current_place", "position", "rank", "place"
  ]);
  if (explicit !== null) return explicit;

  // Media Forest has used different column names across chart families. Match only
  // fields that explicitly identify a current-week/current-rank value.
  for (const [key, value] of Object.entries(entry || {})) {
    const name = key.toLowerCase().replace(/[^a-z]/g, "");
    const isCurrent = /(?:this|current|now)/.test(name);
    const isRank = /(?:week|position|rank|place)/.test(name);
    const isHistorical = /(?:last|previous|peak|weeks)/.test(name);
    if (isCurrent && isRank && !isHistorical) {
      const rank = chartNumber(value);
      if (rank !== null) return rank;
    }
  }
  return null;
}

function normalizeMediaForestChart(payload, type) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return entries
    .map((entry, index) => ({
      // The weekly JSON is already ordered as the chart's top results.  Its
      // `thisweek` property is not a row number in the international feeds
      // (for example, the first result can report 12), so using it produces
      // a visibly broken sequence. Number the displayed chart by its source
      // order, consistently for every chart family.
      position: index + 1,
      sourceIndex: index,
      title: type === "songs" ? String(entry.title || entry.song || "").trim() : null,
      artist: String(entry.artist || entry.performer || entry.title || "").replace(/^>+/, "").trim(),
      lastWeek: firstChartNumber(entry, ["lastweek", "lastWeek", "last_week", "previousPosition", "previous_position"]),
      peak: Math.min(firstChartNumber(entry, ["peak", "peakPosition", "peak_position"]) ?? index + 1, index + 1)
    }))
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.sourceIndex - b.sourceIndex)
    .map(({ sourceIndex, ...entry }) => entry);
}

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Media Forest HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getLatestMediaForestWeek() {
  const currentYear = new Date().getUTCFullYear();
  for (const year of [currentYear, currentYear - 1]) {
    const weeks = await fetchJson(`${MEDIA_FOREST_BASE}/api/weekly_charts/weeks?year=${year}`);
    if (Array.isArray(weeks) && weeks.length) {
      return { year, weekPath: weeks.slice().sort().at(-1) };
    }
  }
  throw new Error("No Media Forest chart week is available");
}

async function buildWeeklyChartsResponse() {
  const { year, weekPath } = await getLatestMediaForestWeek();
  const base = `${MEDIA_FOREST_BASE}/weekly_charts/ISR/${year}/${encodeURIComponent(weekPath)}`;
  const chartPairs = await Promise.all(
    Object.entries(MEDIA_FOREST_CHARTS).map(async ([key, config]) => {
      const payload = await fetchJson(`${base}/${config.file}`);
      return [key, { payload, entries: normalizeMediaForestChart(payload, config.type) }];
    })
  );

  const chartMap = Object.fromEntries(chartPairs);
  const first = chartMap.israeliSongs.payload;
  return {
    source: "Media Forest",
    sourceUrl: `${MEDIA_FOREST_BASE}/weekly_charts.html`,
    year: chartNumber(first?.year) ?? year,
    week: chartNumber(first?.week),
    dateRange: {
      from: String(first?.from || "").slice(0, 10),
      to: String(first?.to || "").slice(0, 10)
    },
    charts: Object.fromEntries(
      Object.entries(chartMap).map(([key, value]) => [key, value.entries])
    ),
    generatedAt: new Date().toISOString()
  };
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

  const unavailableFeedUrls = new Set([
    "https://www.thefader.com/feed/rss",
    "https://www.complex.com/music/rss"
  ]);

  return (result.results || []).filter(row => !unavailableFeedUrls.has(row.feed_url)).map(row => ({
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

// International artists are often written in Hebrew in local coverage and in
// Latin characters elsewhere.  Keep a small, explicit alias list for the
// names most likely to appear across both feeds; matching by ordinary title
// tokens cannot bridge two scripts.
const BILINGUAL_ARTIST_ALIASES = [
  ["ed sheeran", "אד שירן"],
  ["taylor swift", "טיילור סוויפט"],
  ["billie eilish", "בילי אייליש"],
  ["the weeknd", "דה וויקנד"],
  ["dua lipa", "דואה ליפה"],
  ["justin bieber", "ג׳סטין ביבר", "ג'סטין ביבר"],
  ["ariana grande", "אריאנה גרנדה"],
  ["lady gaga", "ליידי גאגא"],
  ["bruno mars", "ברונו מארס"],
  ["coldplay", "קולדפליי"]
].map((aliases, index) => ({ key: `artist-${index}`, aliases: aliases.map(normalizeStoryTitle) }));

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

function storyEntityKeys(item) {
  const title = normalizeStoryTitle(item?.title || "");
  if (!title) return [];
  return BILINGUAL_ARTIST_ALIASES
    .filter(({ aliases }) => aliases.some(alias => title.includes(alias)))
    .map(({ key }) => key);
}

export function bilingualStoryBoost(item, allItems) {
  const itemLanguage = String(item?.lang || "").toUpperCase();
  const keys = storyEntityKeys(item);
  if (!itemLanguage || !keys.length) return 0;

  const itemTime = new Date(item.date).getTime();
  return allItems.some(candidate => {
    const candidateLanguage = String(candidate?.lang || "").toUpperCase();
    if (!candidateLanguage || candidateLanguage === itemLanguage) return false;
    const candidateTime = new Date(candidate.date).getTime();
    if (Number.isFinite(itemTime) && Number.isFinite(candidateTime) && Math.abs(itemTime - candidateTime) > 72 * 60 * 60 * 1000) return false;
    return storyEntityKeys(candidate).some(key => keys.includes(key));
  }) ? 1 : 0;
}

export function sortMusicItems(items) {
  return [...items].sort((a, b) => {
    // Every category shows the newest publication first. Coverage strength is
    // only a tie-breaker, never a reason to bury newer reporting.
    const aTime = new Date(a.date).getTime();
    const bTime = new Date(b.date).getTime();
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
    if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(bTime) ? 1 : -1;
    const bilingualOrder = bilingualStoryBoost(b, items) - bilingualStoryBoost(a, items);
    if (bilingualOrder) return bilingualOrder;
    const aTier = (a.music_score || 0) >= 7 ? 1 : 0;
    const bTier = (b.music_score || 0) >= 7 ? 1 : 0;
    if (aTier !== bTier) return bTier - aTier;
    return 0;
  });
}

export function selectBalancedMusicItems(sortedItems, limit) {
  const reserved = [
    ['hebrew', Math.ceil(limit * 0.25)],
    ['electronic', Math.ceil(limit * 0.15)]
  ];
  const selected = new Set();
  for (const [genre, count] of reserved) {
    let added = 0;
    for (const item of sortedItems) {
      if (added >= count) break;
      if (item.genre === genre && !selected.has(item)) {
        selected.add(item);
        added++;
      }
    }
  }
  for (const item of sortedItems) {
    if (selected.size >= limit) break;
    selected.add(item);
  }
  return sortedItems.filter(item => selected.has(item)).slice(0, limit);
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
const worker = {
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
      if (p === "/api/music-charts/weekly") {
        const cache = caches.default;
        const cacheKey = new Request(`${url.origin}/api/music-charts/weekly?v=5`, { method: "GET" });
        const cached = await cache.match(cacheKey);
        if (cached && !url.searchParams.has("nocache")) {
          const response = new Response(cached.body, cached);
          response.headers.set("X-Worker-Cache", "HIT");
          if (allowedOrigin) response.headers.set("X-Allow-Origin", allowedOrigin);
          return finalizeResponse(response);
        }

        const body = await buildWeeklyChartsResponse();
        const response = new Response(JSON.stringify(body), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=21600, stale-while-revalidate=604800",
            ...(allowedOrigin ? { "X-Allow-Origin": allowedOrigin } : {})
          }
        });
        const finalRes = finalizeResponse(response);
        ctx.waitUntil(cache.put(cacheKey, finalRes.clone()));
        return finalRes;
      }
      if (p === "/api/story-hero") {
        return handleStoryHero(req, env, allowedOrigin);
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
        { url: "https://thesource.com/feed/", source: "The Source", lang: "EN", genre: "international" },
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

      const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
      const rssItems = resultsArray.flat().filter(item => {
        const publishedAt = new Date(item.date).getTime();
        return Number.isFinite(publishedAt) && publishedAt >= cutoff;
      });

      // Keep the feed response independent of D1 writes and AI. Articles are
      // clustered before UI-only merging so each RSS source article is retained.
      ctx.waitUntil(ingestRssStoryArticles(env.KITZER_NEWS_DB, rssItems));

      let allItems = rssItems;

      // Add trending data from APIs
      if (!filterGenre || filterGenre === 'hebrew') {
        const spotifyItems = await fetchSpotifyTrending(env);
        allItems.push(...spotifyItems);
      }

      if (!filterGenre || filterGenre === 'international') {
        const lastfmItems = await fetchLastFmTrending(env);
        allItems.push(...lastfmItems);
      }

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

      allItems = sortMusicItems(allItems);
      const finalItems = !filterGenre || filterGenre === 'all'
        ? selectBalancedMusicItems(allItems, limit)
        : allItems.slice(0, limit);

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

      const ttl = 300;
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
  },

  async scheduled(controller, env, ctx) {
    // Refresh the same normalized cache key that the public news feed uses.
    await worker.fetch(
      new Request("https://api.kitzer.net/api/music?days=3&limit=40&nocache=scheduled"),
      env,
      ctx
    );
  }
};

export { normalizeMediaForestChart };
export default worker;
