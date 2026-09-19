/**
 * Kitzer Revolution — RADIO/SIGNAL frontend + Album Strip
 */
const WORKER_ORIGIN = 'https://api.kitzer.net';
const FEED_ENDPOINT = window.CONFIG?.API_ENDPOINT || `${WORKER_ORIGIN}/api/music`;
const CHARTS_ENDPOINT = window.CONFIG?.CHARTS_ENDPOINT || `${WORKER_ORIGIN}/api/music-charts/weekly`;
const STORY_HERO_ENDPOINT = window.CONFIG?.STORY_HERO_ENDPOINT || `${WORKER_ORIGIN}/api/story-hero`;
const FETCH_TIMEOUT = window.CONFIG?.FETCH_TIMEOUT || 10000;
const feedEl = document.getElementById('newsFeed');
const storyHeroEl = document.getElementById('storyHero');
const refreshBtn = document.getElementById('refreshBtn');
const themeToggle = document.getElementById('themeToggle');

let state = { genre: 'all' };
let currentController = null;
let currentTimeoutId = null;
let chartsData = null;
let activeChart = 'israeliSongs';

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

function hideStoryHero() {
  if (!storyHeroEl) return;
  storyHeroEl.replaceChildren();
  storyHeroEl.hidden = true;
}

function renderStoryHero(hero) {
  if (!storyHeroEl || !hero?.cluster || !hero?.article) return hideStoryHero();
  const url = safeUrl(hero.article.url);
  if (url === '#') return hideStoryHero();

  storyHeroEl.replaceChildren();
  const card = document.createElement('article');
  card.className = 'story-hero-card';
  card.dataset.summarySource = cleanText(hero.article.source, 120) || 'מקור מוזיקה';
  const image = safeUrl(hero.article.cover);
  const hasCover = image !== '#';
  if (hasCover) {
    const img = document.createElement('img');
    img.className = 'story-hero-image';
    img.src = image;
    img.alt = '';
    img.loading = 'eager';
    img.decoding = 'async';
    img.addEventListener('error', () => img.remove(), { once: true });
    card.appendChild(img);
  } else {
    card.classList.add('no-cover');
  }
  const content = document.createElement('div');
  content.className = 'story-hero-content';
  appendText(content, 'p', 'story-hero-kicker', hero.selection_type === 'fallback' ? 'במוקד' : 'STORY RADAR · HERO');
  const title = document.createElement('h2');
  title.id = 'storyHeroTitle';
  title.dir = 'auto';
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = cleanText(hero.cluster.title, 300);
  title.appendChild(link);
  content.appendChild(title);
  const meta = document.createElement('p');
  meta.className = 'story-hero-meta';
  meta.textContent = `${cleanText(hero.article.source, 120) || 'מקור מוזיקה'} · ${Number(hero.cluster.source_count) || 0} מקורות · ${Number(hero.cluster.article_count) || 0} כתבות`;
  content.appendChild(meta);
  const action = document.createElement('a');
  action.className = 'story-hero-link';
  action.href = url;
  action.target = '_blank';
  action.rel = 'noopener noreferrer';
  action.textContent = 'לסיפור המלא';
  content.appendChild(action);
  card.appendChild(content);
  storyHeroEl.appendChild(card);
  storyHeroEl.hidden = false;
}

async function loadStoryHero() {
  try {
    const response = await fetch(STORY_HERO_ENDPOINT, { credentials: 'include' });
    if (!response.ok) throw new Error(`Hero response ${response.status}`);
    const body = await response.json();
    const hero = body?.hero || null;
    if (hero?.article && safeUrl(hero.article.cover) === '#') {
      try {
        const feedUrl = new URL(FEED_ENDPOINT, window.location.origin);
        feedUrl.searchParams.set('days', '3');
        feedUrl.searchParams.set('limit', '80');
        const feedResponse = await fetch(feedUrl, { credentials: 'include' });
        if (feedResponse.ok) {
          const { findHeroFeedCover } = await import('./hero-cover.mjs');
          const feed = await feedResponse.json();
          const cover = findHeroFeedCover(hero, feed?.items);
          if (cover) hero.article.cover = cover;
        }
      } catch {
        // The Hero remains usable without a cover when the feed lookup fails.
      }
    }
    renderStoryHero(hero);
  } catch {
    hideStoryHero();
  }
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

function formatChartDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('he-IL', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
  });
}

function chartDataAgeSuffix(dateRange) {
  const end = dateRange?.to;
  if (!end) return '';
  const endTime = new Date(`${end}T23:59:59Z`).getTime();
  if (Number.isNaN(endTime)) return '';
  const days = Math.floor((Date.now() - endTime) / 86400000);
  return days >= 8 ? ` · נתוני המקור בני ${days} ימים` : '';
}

function chartMovement(item) {
  if (!item.lastWeek) return { text: 'חדש', className: 'new' };
  if (item.lastWeek > item.position) return { text: `▲ ${item.lastWeek - item.position}`, className: 'up' };
  if (item.lastWeek < item.position) return { text: `▼ ${item.position - item.lastWeek}`, className: 'down' };
  return { text: '—', className: 'same' };
}

function renderChart() {
  const content = document.getElementById('chartContent');
  if (!content || !chartsData) return;
  const items = [...(chartsData.charts?.[activeChart] || [])].sort((a, b) => {
    const aPosition = Number.parseInt(a.position, 10);
    const bPosition = Number.parseInt(b.position, 10);
    return (Number.isFinite(aPosition) ? aPosition : Infinity) - (Number.isFinite(bPosition) ? bPosition : Infinity);
  });
  content.replaceChildren();

  if (!items.length) {
    appendText(content, 'p', 'feed-status muted', 'אין נתונים למצעד הזה כרגע.');
    return;
  }

  const list = document.createElement('ol');
  list.className = 'chart-list';
  for (const item of items) {
    const row = document.createElement('li');
    row.className = 'chart-row signal-entry';
    const position = appendText(row, 'span', 'chart-position', String(item.position));
    position.setAttribute('aria-label', `מקום ${item.position}`);

    const identity = document.createElement('div');
    identity.className = 'chart-identity';
    if (item.title) appendText(identity, 'strong', 'chart-song', cleanText(item.title));
    appendText(identity, item.title ? 'span' : 'strong', 'chart-artist', cleanText(item.artist));
    row.appendChild(identity);

    const movement = chartMovement(item);
    appendText(row, 'span', `chart-movement ${movement.className}`, movement.text);
    appendText(row, 'span', 'chart-stat', item.lastWeek ? `קודם ${item.lastWeek}` : 'קודם —');
    appendText(row, 'span', 'chart-stat', item.peak ? `שיא ${item.peak}` : 'שיא —');
    list.appendChild(row);
  }
  content.appendChild(list);
}

async function loadCharts(forceRefresh = false) {
  const content = document.getElementById('chartContent');
  if (!content) return;
  content.innerHTML = '<div class="loading-label"><span class="loader-equalizer" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></span><span>טוענים את המצעד...</span></div>';
  try {
    const url = new URL(CHARTS_ENDPOINT, window.location.origin);
    if (forceRefresh) url.searchParams.set('nocache', String(Date.now()));
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`Charts API response: ${response.status}`);
    chartsData = await response.json();
    const range = document.getElementById('chartsDateRange');
    if (range) range.textContent = `${formatChartDate(chartsData.dateRange?.from)}–${formatChartDate(chartsData.dateRange?.to)} · שבוע ${chartsData.week || ''}${chartDataAgeSuffix(chartsData.dateRange)}`;
    renderChart();
  } catch (error) {
    console.error('LoadCharts Failure:', error);
    content.replaceChildren();
    appendText(content, 'p', 'feed-status error', 'לא הצלחנו לטעון את המצעד כרגע.');
  }
}

function setView(view) {
  const showingCharts = view === 'charts';
  document.getElementById('chartsPanel')?.toggleAttribute('hidden', !showingCharts);
  feedEl?.toggleAttribute('hidden', showingCharts);
  document.querySelector('.news-controls')?.toggleAttribute('hidden', showingCharts);
  document.querySelector('.chart-controls')?.toggleAttribute('hidden', !showingCharts);
  qsa('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (showingCharts && !chartsData) loadCharts();
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

  void loadStoryHero();

  if (currentController) currentController.abort();
  if (currentTimeoutId) clearTimeout(currentTimeoutId);

  const controller = new AbortController();
  currentController = controller;
  currentTimeoutId = null;
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
    timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    currentTimeoutId = timeoutId;

    const url = new URL(FEED_ENDPOINT, window.location.origin);
    url.searchParams.set('days', '3');
    url.searchParams.set('limit', '40');
    if (state.genre !== 'all') url.searchParams.set('genre', state.genre);
    if (forceRefresh) url.searchParams.set('nocache', String(Date.now()));

    const res = await fetch(url, {
      signal: controller.signal,
      credentials: 'include'
    });
    if (!res.ok) throw new Error(`API Response Error: ${res.status}`);

    const data = await res.json();
    // A newer filter/refresh request has taken ownership of the feed.
    if (controller !== currentController) return;
    const items = Array.isArray(data.items) ? data.items : [];
    writeCache(items);
    renderNews(items);
  } catch (e) {
    // Cancelling an older request is expected; do not overwrite newer content.
    if (controller !== currentController) return;
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
    if (currentTimeoutId === timeoutId) currentTimeoutId = null;
    if (currentController === controller) currentController = null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  qsa('[data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
  qsa('[data-chart]').forEach(btn => btn.addEventListener('click', () => {
    activeChart = btn.dataset.chart;
    qsa('[data-chart]').forEach(tab => {
      const active = tab === btn;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.getElementById('chartContent')?.setAttribute('aria-labelledby', `chart-${activeChart}`);
    renderChart();
  }));
  qsa('[data-chart]').forEach(btn => btn.addEventListener('keydown', event => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const tabs = qsa('[data-chart]');
    const index = tabs.indexOf(btn);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  }));
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
