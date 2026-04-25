/**
 * Kitzer — Smart Visual Pulse UI
 * Fast scanning, strong hierarchy, safe rendering.
 */
const FEED_ENDPOINT = 'https://music-aggregator.dustrial.workers.dev/api/music';
const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

let state = { genre: 'all' };
let currentController = null;

const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const HEB_RTF = new Intl.RelativeTimeFormat('he-IL', { numeric: 'auto' });
const TIMEZONE = 'Asia/Jerusalem';
const CACHE_VERSION = 'kitzer-pulse-v1';
const TTL_MS = 30 * 60 * 1000;

function cleanText(input, limit = 0) {
  if (!input) return '';
  try {
    const doc = new DOMParser().parseFromString(String(input), 'text/html');
    let text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    if (limit > 0 && text.length > limit) text = text.slice(0, limit).trim() + '...';
    return text;
  } catch {
    return '';
  }
}

function safeUrl(href) {
  try {
    const u = new URL(href);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : '#';
  } catch {
    return '#';
  }
}

function parseTime(dateStr) {
  const t = Date.parse(dateStr);
  return Number.isNaN(t) ? 0 : t;
}

function timeAgo(dateStr) {
  const t = parseTime(dateStr);
  if (!t) return '';
  const diff = Date.now() - t;
  const minutes = Math.round(diff / 60000);
  const hours = Math.round(diff / 3600000);
  if (minutes < 1) return 'עכשיו';
  if (minutes < 60) return HEB_RTF.format(-minutes, 'minute');
  if (hours < 24) return HEB_RTF.format(-hours, 'hour');
  return HEB_RTF.format(-Math.round(hours / 24), 'day');
}

function clockTime(dateStr) {
  const t = parseTime(dateStr);
  if (!t) return '';
  return new Date(t).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE
  });
}

function makeTags(it) {
  const tags = [];
  if (it.lang) tags.push(String(it.lang).toUpperCase());
  if (it.genre && !['general', 'all'].includes(it.genre)) tags.push(it.genre);
  return tags;
}

function classifyItem(it, index) {
  const ageMs = Date.now() - parseTime(it.date);
  return {
    isTop: index < 2,
    isFresh: ageMs > 0 && ageMs <= 6 * 60 * 60 * 1000,
    isOld: ageMs >= 24 * 60 * 60 * 1000
  };
}

function renderNews(items) {
  if (!feedEl) return;
  feedEl.innerHTML = '';

  if (!Array.isArray(items) || items.length === 0) {
    feedEl.innerHTML = '<p class="muted">אין חדשות כרגע.</p>';
    refreshBtn?.classList.remove('loading');
    feedEl.setAttribute('aria-busy', 'false');
    return;
  }

  const batchSize = 10;

  const renderBatch = (startIdx) => {
    const endIdx = Math.min(startIdx + batchSize, items.length);
    const frag = document.createDocumentFragment();

    for (let i = startIdx; i < endIdx; i++) {
      const it = items[i];
      const link = safeUrl(it.link);
      const title = cleanText(it.title);
      if (!title || link === '#') continue;

      const { isTop, isFresh, isOld } = classifyItem(it, i);
      const tags = makeTags(it);
      const el = document.createElement('article');
      el.className = ['news-card', isTop ? 'top-story' : 'pulse-item', isFresh ? 'fresh' : '', isOld ? 'old' : '']
        .filter(Boolean)
        .join(' ');
      el.setAttribute('role', 'article');

      const cover = safeUrl(it.cover);
      const shouldShowImage = cover !== '#' && (!isOld || isTop);
      const coverHTML = shouldShowImage
        ? `<a class="cover-link" href="${link}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><img src="${cover}" class="news-cover" loading="lazy" alt="" role="presentation"></a>`
        : `<div class="text-signal" aria-hidden="true">${isFresh ? '●' : '◇'}</div>`;

      const badge = isFresh ? '<span class="hot-badge">חדש</span>' : '';
      const summaryLimit = isTop ? 260 : 150;
      const summary = it.description ? cleanText(it.description, summaryLimit) : '';

      el.innerHTML = `
        ${coverHTML}
        <div class="news-details">
          <div class="news-kicker">
            ${badge}
            <span class="news-source">${cleanText(it.source)}</span>
            <time class="news-date" datetime="${cleanText(it.date)}">
              <span class="rel">${timeAgo(it.date)}</span>
              ${clockTime(it.date) ? `<span class="sep"> · </span><bdi class="clock">${clockTime(it.date)}\u200E</bdi>` : ''}
            </time>
          </div>
          <h2 class="news-title">
            <a href="${link}" target="_blank" rel="noopener noreferrer">${title}</a>
          </h2>
          ${summary ? `<p class="news-summary">${summary}</p>` : ''}
          <div class="news-footer-meta">
            <div class="news-tags">${tags.map(t => `<span class="tag">${cleanText(t)}</span>`).join('')}</div>
            <a class="read-link" href="${link}" target="_blank" rel="noopener noreferrer">לכתבה</a>
          </div>
        </div>`;

      frag.appendChild(el);
    }

    feedEl.appendChild(frag);
    if (endIdx < items.length) requestAnimationFrame(() => renderBatch(endIdx));
  };

  renderBatch(0);
  refreshBtn?.classList.remove('loading');
  feedEl.setAttribute('aria-busy', 'false');
}

function getCacheKey() {
  return `${CACHE_VERSION}:${state.genre.toLowerCase()}`;
}

function readCache() {
  try {
    const cached = localStorage.getItem(getCacheKey());
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    const valid = parsed?.ts && Date.now() - parsed.ts < TTL_MS && Array.isArray(parsed?.data);
    return valid ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCache(items) {
  try {
    localStorage.setItem(getCacheKey(), JSON.stringify({ data: items, ts: Date.now() }));
  } catch {}
}

async function loadNews(forceRefresh = false) {
  if (!feedEl) return;

  if (currentController) currentController.abort();
  currentController = new AbortController();
  feedEl.setAttribute('aria-busy', 'true');

  if (!forceRefresh) {
    const cached = readCache();
    if (cached) {
      renderNews(cached);
      return;
    }
  }

  feedEl.innerHTML = '<div class="skeleton"></div>'.repeat(6);

  try {
    const url = new URL(FEED_ENDPOINT);
    url.searchParams.set('days', '3');
    url.searchParams.set('limit', '120');
    if (state.genre !== 'all') url.searchParams.set('genre', state.genre);
    if (forceRefresh) url.searchParams.set('nocache', String(Date.now()));

    const res = await fetch(url, { signal: currentController.signal });
    if (!res.ok) throw new Error(`API Response Error: ${res.status}`);

    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    writeCache(items);
    renderNews(items);
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error('LoadNews Failure:', e);
    feedEl.setAttribute('aria-busy', 'false');
    feedEl.innerHTML = '<p class="error">שגיאה בטעינת נתונים</p>';
    refreshBtn?.classList.remove('loading');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  qsa('[data-genre]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.genre = btn.getAttribute('data-genre') || 'all';
      qsa('[data-genre]').forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      loadNews(false);
    });
  });

  refreshBtn?.addEventListener('click', () => {
    refreshBtn.classList.add('loading');
    loadNews(true);
  });

  loadNews(false);
});
