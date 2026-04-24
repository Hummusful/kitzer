/**
 * Global Configuration & State
 */
const FEED_ENDPOINT = 'https://music-aggregator.dustrial.workers.dev/api/music';
const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

let state = { genre: 'all' };
let currentController = null;

/**
 * Utility: Scoped QuerySelector proxy
 */
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Sanitizes HTML input and decodes entities using DOMParser.
 * Protects against XSS by extracting textContent only.
 */
function cleanText(input, limit = 0) {
  if (!input) return '';
  try {
    const doc = new DOMParser().parseFromString(input, 'text/html');
    let text = doc.body.textContent || "";
    if (limit > 0 && text.length > limit) {
      text = text.slice(0, limit).trim() + '...';
    }
    return text;
  } catch (e) { 
    console.error("Sanitization error:", e);
    return ''; 
  }
}

/**
 * URL Sanitizer: Restricts protocols to HTTP/HTTPS for security.
 */
function safeUrl(href) {
  try {
    const u = new URL(href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '#';
  } catch { return '#'; }
}

/**
 * Localization: Hebrew Relative Time and Jerusalem Timezone.
 */
const HEB_RTF = new Intl.RelativeTimeFormat('he-IL', { numeric: 'auto' });
const TIMEZONE = 'Asia/Jerusalem';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const hr = Math.round(diff / 3600000);
  if (hr < 1) return 'לפני רגע';
  if (hr < 24) return HEB_RTF.format(-hr, 'hour');
  return HEB_RTF.format(-Math.round(hr / 24), 'day');
}

/**
 * Logic: Extracts and formats tags for display.
 */
function makeTags(it) {
  const tags = [];
  if (it.lang) tags.push(it.lang.toUpperCase());
  if (it.genre && !['general', 'all'].includes(it.genre)) tags.push(it.genre);
  return tags;
}

/**
 * UI Renderer: Optimized batch processing using DocumentFragments.
 */
function renderNews(items) {
  if (!feedEl) return;
  feedEl.innerHTML = '';
  if (!items?.length) {
    feedEl.innerHTML = `<p class="muted">אין חדשות כרגע.</p>`;
    return;
  }

  const batchSize = 8;
  const renderBatch = (startIdx) => {
    const endIdx = Math.min(startIdx + batchSize, items.length);
    const frag = document.createDocumentFragment();

    for (let i = startIdx; i < endIdx; i++) {
      const it = items[i];
      const el = document.createElement('article');
      el.className = 'news-card';

      const coverHTML = it.cover 
        ? `<img src="${safeUrl(it.cover)}" class="news-cover" loading="lazy" alt="" role="presentation">` 
        : '';

      const tags = makeTags(it);

      el.innerHTML = `
        ${coverHTML}
        <div class="news-details">
          <span class="news-source">${cleanText(it.source)}</span>
          <h3 class="news-title">
            <a href="${safeUrl(it.link)}" target="_blank" rel="noopener noreferrer">
                ${cleanText(it.title)}
            </a>
          </h3>
          ${it.description ? `<p class="news-summary">${cleanText(it.description, 200)}</p>` : ''}
          <div class="news-footer-meta">
            <time class="news-date">
               <span class="rel">${timeAgo(it.date)}</span>
               <span class="sep"> · </span><bdi class="clock">${new Date(it.date).toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit', timeZone:TIMEZONE})}\u200E</bdi>
            </time>
            <div class="news-tags">${tags.map(t => `<span class="tag">${cleanText(t)}</span>`).join(' ')}</div>
          </div>
        </div>`;
      frag.appendChild(el);
    }
    feedEl.appendChild(frag);
    if (endIdx < items.length) requestAnimationFrame(() => renderBatch(endIdx));
  };
  renderBatch(0);
}

/**
 * Controller: Handles API requests with Cache-First strategy.
 */
async function loadNews(forceRefresh = false) {
  const key = state.genre.toLowerCase();
  const cacheKey = `kitzer-feed-v1:${key}`;

  if (currentController) {
    currentController.abort();
    currentController = null;
  }

  // Set loading state for screen readers
  if (feedEl) feedEl.setAttribute('aria-busy', 'true');

    const TTL_MS = 30 * 60 * 1000; // match worker: 1800s
  if (!forceRefresh) {
    let cached = null;
    try {
      cached = localStorage.getItem(cacheKey);
    } catch {
      cached = null;
    }
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const isFresh = parsed?.ts && (Date.now() - parsed.ts) < TTL_MS;
        const hasValidCachedItems = Array.isArray(parsed?.data) &&
          parsed.data.every(it =>
            it &&
            typeof it === 'object' &&
            typeof it.title === 'string' &&
            typeof it.link === 'string'
          );
        if (isFresh && hasValidCachedItems) {
          renderNews(parsed.data);
          return; // ✅ don't immediately refetch if cache is fresh
        }
      } catch {
        // ignore corrupt cache
      }
    }
  }


  if (!feedEl.children.length) {
    feedEl.innerHTML = '<div class="skeleton"></div>'.repeat(6);
  }

  try {
    const url = new URL(FEED_ENDPOINT);
    if (state.genre !== 'all') url.searchParams.set('genre', state.genre);

    if (forceRefresh) {
      url.searchParams.set('nocache', '1');
    }

if (currentController) {
  currentController.abort();
}

currentController = new AbortController();

const res = await fetch(url, {
  signal: currentController.signal
});
    if (!res.ok) throw new Error("API Response Error");
    
    const data = await res.json();
    const items = data.items || [];

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data: items, ts: Date.now() }));
    } catch {}
    renderNews(items);
    if (feedEl) feedEl.setAttribute('aria-busy', 'false');
  } catch (e) {
  if (e.name === 'AbortError') return;
  console.error("LoadNews Failure:", e);
    if (feedEl) {
      feedEl.setAttribute('aria-busy', 'false');
      feedEl.innerHTML = `<p class="error">שגיאה בטעינת נתונים</p>`;
    }
  }
}

/**
 * Initialization: Application Bootstrap.
 */
document.addEventListener('DOMContentLoaded', () => {
  qsa('[data-genre]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.genre = btn.getAttribute('data-genre') || 'all';
      qsa('[data-genre]').forEach(b => b.classList.toggle('active', b === btn));
      loadNews();
    });
  });
  refreshBtn?.addEventListener('click', () => loadNews(true));
  loadNews();
});



