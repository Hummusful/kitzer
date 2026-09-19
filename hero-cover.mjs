function normalizedUrl(value) {
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

function normalizedTitle(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validCover(value) {
  return normalizedUrl(value);
}

// Prefer an exact article URL, then a normalized headline. Only real HTTP/S
// covers are returned, leaving the existing no-cover view as the final fallback.
export function findHeroFeedCover(hero, feedItems) {
  const items = Array.isArray(feedItems) ? feedItems : [];
  const heroUrl = normalizedUrl(hero?.article?.url);
  const heroTitle = normalizedTitle(hero?.article?.title || hero?.cluster?.title);
  const byUrl = heroUrl && items.find(item => normalizedUrl(item?.link) === heroUrl);
  const byTitle = heroTitle && items.find(item => normalizedTitle(item?.title) === heroTitle);
  return validCover(byUrl?.cover) || validCover(byTitle?.cover) || null;
}
