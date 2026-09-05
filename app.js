/**
 * Kitzer Revolution — RADIO/SIGNAL frontend + Album Strip
 */
const FEED_ENDPOINT = window.CONFIG?.API_ENDPOINT || '/api/music';
const FETCH_TIMEOUT = window.CONFIG?.FETCH_TIMEOUT || 10000;
const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');
const themeToggle = document.getElementById('themeToggle');

let state = { genre: 'all' };
let currentController = null;

// ============================================================
// Theme Management
// ============================================================
const THEME_STORAGE_KEY = 'kitzer-theme-preference';
const DEFAULT_THEME = 'dark';

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function setTheme(theme) {
  const validTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', validTheme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, validTheme);
  } catch {
    // Silently ignore storage errors
  }
  updateThemeButton(validTheme);
}

function updateThemeButton(theme) {
  if (themeToggle) {
    themeToggle.textContent = theme === 'light' ? '🌙' : '☀️';
    themeToggle.setAttribute('aria-label', theme === 'light' ? 'החלף לעיצוב כהה' : 'החלף לעיצוב בהיר');
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  setTheme(newTheme);
}

// Initialize theme
(function initTheme() {
  const storedTheme = getStoredTheme();
  setTheme(storedTheme);
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
})();

// ============================================================

const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const HEB_RTF = new Intl.RelativeTimeFormat('he-IL', { numeric: 'auto' });
const TIMEZONE = 'Asia/Jerusalem';
const CACHE_VERSION = 'kitzer-radio-revolution-images-v2';
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

function classifyItem(it) {
  const ageMs = Date.now() - parseTime(it.date);
  return {
    isFresh: ageMs > 0 && ageMs <= 6 * 60 * 60 * 1000,
    isOld: ageMs >= 24 * 60 * 60 * 1000
  };
}

function createTextSignal() {
  const signal = document.createElement('div');
  signal.className = 'text-signal';
  signal.setAttribute('aria-hidden', 'true');
  signal.textContent = '♫';
  return signal;
}

function buildCoverNode(cover) {
  if (cover !== '#') {
    const wrap = document.createElement('div');
    wrap.className = 'cover-link';
    wrap.setAttribute('aria-hidden', 'true');

    const img = document.createElement('img');
    img.src = cover;
    img.className = 'news-cover';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.setAttribute('role', 'presentation');
    img.addEventListener('error', () => wrap.replaceWith(createTextSignal()), { once: true });

    wrap.appendChild(img);
    return wrap;
  }

  return createTextSignal();
}

function appendText(parent, tagName, className, text) {
  const el = document.createElement(tagName);
  if (className) el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function renderStatus(message, type = 'muted', showRetry = false) {
  if (!feedEl) return;
  feedEl.replaceChildren();
  const status = document.createElement('div');
  status.className = `feed-status ${type}`;
  status.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const p = document.createElement('p');
  p.textContent = message;
  status.appendChild(p);

  if (showRetry) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn status-action';
    retry.textContent = 'נסה שוב';
    retry.addEventListener('click', () => loadNews(true));
    status.appendChild(retry);
  }

  feedEl.appendChild(status);
  refreshBtn?.classList.remove('loading');
  feedEl.setAttribute('aria-busy', 'false');
}

function renderLoading() {
  if (!feedEl) return;
  feedEl.replaceChildren();

  const loadingLabel = document.createElement('div');
  loadingLabel.className = 'loading-label';
  loadingLabel.setAttribute('role', 'status');
  loadingLabel.innerHTML = `
    <span class="loader-equalizer" aria-hidden="true">
      <span></span><span></span><span></span><span></span><span></span>
    </span>
    <span>מכוונים תדר...</span>
  `;
  feedEl.appendChild(loadingLabel);

  for (let i = 0; i < 8; i++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    feedEl.appendChild(skeleton);
  }
}

function renderNews(items) {
  if (!feedEl) return;
  feedEl.replaceChildren();

  if (!Array.isArray(items) || items.length === 0) {
    renderStatus('אין מבזקי מוזיקה כרגע.', 'muted');
    return;
  }

  const batchSize = 16;
  const renderBatch = (startIdx) => {
    const endIdx = Math.min(startIdx + batchSize, items.length);
    const frag = document.createDocumentFragment();

    for (let i = startIdx; i < endIdx; i++) {
      const it = items[i];
      const link = safeUrl(it.link);
      const title = cleanText(it.title);
      if (!title || link === '#') continue;

      const { isFresh, isOld } = classifyItem(it);
      const tags = makeTags(it);
      const el = document.createElement('article');
      const titleId = `news-title-${startIdx}-${i}`;

      el.className = ['news-card', 'signal-entry', isFresh ? 'fresh' : '', isOld ? 'old' : ''].filter(Boolean).join(' ');
      el.style.setProperty('--entry-index', String(i % batchSize));
      el.setAttribute('role', 'article');
      el.setAttribute('aria-labelledby', titleId);

      const cover = safeUrl(it.cover);
      el.appendChild(buildCoverNode(cover));

      const details = document.createElement('div');
      details.className = 'news-details';

      const kicker = document.createElement('div');
      kicker.className = 'news-kicker';

      if (isFresh) appendText(kicker, 'span', 'fresh-badge', 'LIVE');
      appendText(kicker, 'span', 'news-source', cleanText(it.source));

      const time = document.createElement('time');
      time.className = 'news-date';
      time.dateTime = cleanText(it.date);
      appendText(time, 'span', 'rel', timeAgo(it.date));
      const clock = clockTime(it.date);
      if (clock) {
        appendText(time, 'span', 'sep', ' · ');
        const bdi = appendText(time, 'bdi', 'clock', `${clock}\u200E`);
        bdi.dir = 'ltr';
      }
      kicker.appendChild(time);
      details.appendChild(kicker);

      const h2 = document.createElement('h2');
      h2.className = 'news-title';
      h2.id = titleId;
      const titleLink = document.createElement('a');
      titleLink.href = link;
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.textContent = title;
      h2.appendChild(titleLink);
      details.appendChild(h2);

      const summary = it.description ? cleanText(it.description, 190) : '';
      if (summary) appendText(details, 'p', 'news-summary', summary);

      const footer = document.createElement('div');
      footer.className = 'news-footer-meta';

      const tagWrap = document.createElement('div');
      tagWrap.className = 'news-tags';
      for (const tag of tags) appendText(tagWrap, 'span', 'tag', cleanText(tag));
      footer.appendChild(tagWrap);

      const readLink = document.createElement('a');
      readLink.className = 'read-link';
      readLink.href = link;
      readLink.target = '_blank';
      readLink.rel = 'noopener noreferrer';
      readLink.textContent = 'לפרטים';
      footer.appendChild(readLink);

      details.appendChild(footer);
      el.appendChild(details);
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

  renderLoading();

  let timeoutId = null;
  try {
    timeoutId = setTimeout(() => currentController.abort(), FETCH_TIMEOUT);

    const url = new URL(FEED_ENDPOINT);
    url.searchParams.set('days', '3');
    url.searchParams.set('limit', '40');
    if (state.genre !== 'all') url.searchParams.set('genre', state.genre);
    if (forceRefresh) url.searchParams.set('nocache', String(Date.now()));

    const res = await fetch(url, {
      signal: currentController.signal,
      credentials: 'include'
    });
    if (!res.ok) throw new Error(`API Response Error: ${res.status}`);

    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    writeCache(items);
    renderNews(items);
  } catch (e) {
    if (e.name === 'AbortError') {
      const message = !navigator.onLine 
        ? 'אין חיבור אינטרנט. בדוק את ההגדרות שלך.'
        : 'הבקשה ארכה יותר מדי. אנא נסה שוב.';
      renderStatus(message, 'error', true);
      return;
    }
    console.error('LoadNews Failure:', e);
    const message = e.message?.includes('JSON')
      ? 'תגובה שגויה מהשרת'
      : e.message?.includes('Response Error: 5')
      ? 'שגיאה בשרת. אנא נסה שוב בעוד דקה.'
      : 'שגיאה בטעינת המבזקים. אפשר לנסות שוב בעוד רגע.';
    renderStatus(message, 'error', true);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
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
