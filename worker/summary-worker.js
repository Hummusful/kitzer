/**
 * KITZER AI Summary Worker
 *
 * Bindings required in Cloudflare:
 * - AI                Workers AI binding
 * - KITZER_NEWS_DB    Existing KITZER D1 database
 *
 * POST /api/summarize
 * body: { url, title?, source? }
 */

const AI_MODEL = "@cf/zai-org/glm-4.7-flash";
const MAX_HTML_BYTES = 1_500_000;
const MAX_ARTICLE_CHARS = 24_000;
const FETCH_TIMEOUT_MS = 8_000;
const ALLOWED_ORIGINS = new Set([
  "https://kitzer.net",
  "https://www.kitzer.net"
]);

function allowedOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin && ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function responseHeaders(origin) {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    ...(origin ? {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Content-Type",
      "vary": "Origin"
    } : {})
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(origin)
  });
}

function normalizeUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    for (const key of [
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "fbclid", "gclid"
    ]) {
      url.searchParams.delete(key);
    }
    return url;
  } catch {
    return null;
  }
}

function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some(n => n < 0 || n > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.il", "org.il", "net.il", "ac.il",
  "co.uk", "org.uk", "com.au", "net.au", "co.nz", "com.br", "com.mx"
]);

function siteKey(hostname) {
  const labels = String(hostname || "").toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const suffix2 = labels.slice(-2).join(".");
  if (MULTI_LABEL_PUBLIC_SUFFIXES.has(suffix2) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

async function loadAllowedSiteKeys(env) {
  const result = await env.KITZER_NEWS_DB.prepare(`
    SELECT feed_url
    FROM sources
    WHERE enabled = 1
      AND source_type = 'rss'
      AND feed_url IS NOT NULL
  `).all();

  const keys = new Set();
  for (const row of result.results || []) {
    try {
      const host = new URL(row.feed_url).hostname;
      const key = siteKey(host);
      if (key) keys.add(key);
    } catch {}
  }
  return keys;
}

async function isAllowedArticleUrl(env, url) {
  if (!url || isPrivateOrLocalHost(url.hostname)) return false;
  const allowedKeys = await loadAllowedSiteKeys(env);
  return allowedKeys.has(siteKey(url.hostname));
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function decodeHtmlEntities(value) {
  if (!value) return "";
  const named = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
    hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’",
    ldquo: "“", rdquo: "”"
  };
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractJsonLdArticleBody(html) {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        if (typeof item.articleBody === "string" && item.articleBody.length > 300) {
          return stripTags(item.articleBody);
        }
        if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
      }
    } catch {}
  }
  return "";
}

function extractMetaDescription(html) {
  const patterns = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i
  ];
  for (const re of patterns) {
    const value = html.match(re)?.[1];
    if (value) return stripTags(value);
  }
  return "";
}

function extractArticleText(html) {
  const jsonLd = extractJsonLdArticleBody(html);
  if (jsonLd.length >= 500) return jsonLd.slice(0, MAX_ARTICLE_CHARS);

  const cleaned = html
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|form|nav|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const article = cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const main = cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  const scope = article || main || cleaned;

  const paragraphs = [...scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => stripTags(match[1]))
    .filter(text => text.length >= 35);

  let text = paragraphs.join("\n\n").trim();
  if (text.length < 500) text = stripTags(scope);
  return text.slice(0, MAX_ARTICLE_CHARS);
}

async function readResponseTextLimited(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("ARTICLE_TOO_LARGE");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("ARTICLE_TOO_LARGE");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

async function fetchArticleHtml(env, articleUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(articleUrl.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KitzerSummary/1.0; +https://kitzer.net)",
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"
      },
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`ARTICLE_HTTP_${response.status}`);
    const finalUrl = normalizeUrl(response.url || articleUrl.toString());
    if (!finalUrl || !(await isAllowedArticleUrl(env, finalUrl))) throw new Error("REDIRECT_NOT_ALLOWED");

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("ARTICLE_NOT_HTML");
    }
    return await readResponseTextLimited(response, MAX_HTML_BYTES);
  } finally {
    clearTimeout(timeout);
  }
}

function parseAiJson(raw) {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(text);
    return {
      summary: String(parsed.summary || "").trim(),
      why_it_matters: String(parsed.why_it_matters || "").trim()
    };
  } catch {
    return { summary: text, why_it_matters: "" };
  }
}

async function summarizeWithAi(env, { title, source, articleText, limited }) {
  if (!env.AI) throw new Error("AI_BINDING_MISSING");

  const messages = [
    {
      role: "system",
      content: [
        "אתה עורך חדשות המוזיקה של KITZER.",
        "סכם אך ורק עובדות שמופיעות בטקסט שסופק. אל תנחש ואל תוסיף מידע חיצוני.",
        "כתוב בעברית טבעית, ברורה וקצרה, גם אם המקור באנגלית.",
        "שמות אמנים, שירים, אלבומים, חברות ומותגים השאר בשפת המקור כאשר זה טבעי.",
        "החזר JSON תקין בלבד ללא Markdown במבנה:",
        '{"summary":"2-3 משפטים קצרים","why_it_matters":"משפט קצר אחד או מחרוזת ריקה"}',
        "אם אין מספיק מידע כדי להסביר למה זה מעניין, החזר why_it_matters ריק."
      ].join("\n")
    },
    {
      role: "user",
      content: `כותרת: ${title || "לא סופקה"}\nמקור: ${source || "לא סופק"}\n${limited ? "הערה: הטקסט הזמין חלקי בלבד.\n" : ""}\nטקסט הכתבה:\n${articleText}`
    }
  ];

  const result = await env.AI.run(AI_MODEL, {
    messages,
    max_tokens: 260,
    temperature: 0.2
  });

  const raw = result?.response ?? result?.result?.response ?? "";
  const parsed = parseAiJson(raw);
  if (!parsed.summary || parsed.summary.length < 20) throw new Error("AI_EMPTY_SUMMARY");
  return parsed;
}

async function getCachedSummary(env, key) {
  return await env.KITZER_NEWS_DB.prepare(`
    SELECT summary, why_it_matters, model, created_at
    FROM article_summaries
    WHERE url_hash = ?
    LIMIT 1
  `).bind(key).first();
}

async function saveSummary(env, row) {
  const now = new Date().toISOString();
  await env.KITZER_NEWS_DB.prepare(`
    INSERT INTO article_summaries (
      url_hash, article_url, title, source, summary, why_it_matters, model, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url_hash) DO UPDATE SET
      title = excluded.title,
      source = excluded.source,
      summary = excluded.summary,
      why_it_matters = excluded.why_it_matters,
      model = excluded.model,
      updated_at = excluded.updated_at
  `).bind(
    row.url_hash,
    row.article_url,
    row.title || null,
    row.source || null,
    row.summary,
    row.why_it_matters || null,
    AI_MODEL,
    now,
    now
  ).run();
}

async function handleSummary(request, env, origin) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);
  if (!origin) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403, null);
  if (!env.KITZER_NEWS_DB) return json({ error: "D1_BINDING_MISSING" }, 503, origin);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400, origin);
  }

  const articleUrl = normalizeUrl(body?.url);
  if (!articleUrl || isPrivateOrLocalHost(articleUrl.hostname)) {
    return json({ error: "INVALID_URL" }, 400, origin);
  }
  if (!(await isAllowedArticleUrl(env, articleUrl))) {
    return json({ error: "SOURCE_NOT_ALLOWED" }, 403, origin);
  }

  const normalized = articleUrl.toString();
  const key = await sha256Hex(normalized);
  const cached = await getCachedSummary(env, key);
  if (cached?.summary) {
    return json({
      ok: true,
      cached: true,
      summary: cached.summary,
      why_it_matters: cached.why_it_matters || "",
      model: cached.model,
      created_at: cached.created_at
    }, 200, origin);
  }

  try {
    const html = await fetchArticleHtml(env, articleUrl);
    const meta = extractMetaDescription(html);
    let articleText = extractArticleText(html);
    let limited = false;

    if (articleText.length < 500) {
      limited = true;
      articleText = [String(body?.title || "").trim(), meta].filter(Boolean).join("\n\n");
    }
    if (articleText.length < 120) {
      return json({ error: "NOT_ENOUGH_ARTICLE_TEXT" }, 422, origin);
    }

    const title = String(body?.title || "").trim().slice(0, 500);
    const source = String(body?.source || "").trim().slice(0, 200);
    const ai = await summarizeWithAi(env, { title, source, articleText, limited });

    await saveSummary(env, {
      url_hash: key,
      article_url: normalized,
      title,
      source,
      summary: ai.summary,
      why_it_matters: ai.why_it_matters
    });

    return json({
      ok: true,
      cached: false,
      limited,
      summary: ai.summary,
      why_it_matters: ai.why_it_matters,
      model: AI_MODEL
    }, 200, origin);
  } catch (error) {
    const code = error?.name === "AbortError" ? "ARTICLE_TIMEOUT" : String(error?.message || "SUMMARY_FAILED");
    console.error("KITZER summary failed", code);
    const status = code === "AI_BINDING_MISSING" ? 503 : 502;
    return json({ error: code }, status, origin);
  }
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: responseHeaders(origin) });
    }

    if (path === "/health") {
      return json({
        ok: true,
        ai_binding: Boolean(env.AI),
        d1_binding: Boolean(env.KITZER_NEWS_DB),
        model: AI_MODEL
      }, 200, origin);
    }

    if (path === "/api/summarize") {
      return handleSummary(request, env, origin);
    }

    return json({ error: "NOT_FOUND" }, 404, origin);
  }
};
