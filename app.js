// app.js – טעינה דו-שלבית + קאש פר-טאב + UX חלק (ללא פלאש מיותר)
const FEED_ENDPOINT = 'https://music-aggregator.dustrial.workers.dev/api/music';

const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

let state = { genre: 'all' };

// קאש בזיכרון לפי מפתח (genre)
let memoryCache = {
  ttl: 5 * 60 * 1000, // 5 דקות
  byKey: new Map(),   // key -> { data, ts }
};

const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Skeleton – מוצג רק כשאין תוכן קיים כדי למנוע "פלאש"
function setBusy(isBusy) {
  if (!feedEl) return;
  feedEl.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  if (isBusy) {
    if (!feedEl.querySelector('.news-card')) {
      feedEl.innerHTML = '<div class="skeleton"></div>'.repeat(6);
    }
  } else {
    const spinner = document.getElementById('scroll-spinner');
    if (spinner) spinner.remove();
  }
}

// Hebrew relative time + absolute clock
const HEB_RTF = new Intl.RelativeTimeFormat('he-IL', { numeric: 'auto' });
const TZ = 'Asia/Jerusalem';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'לפני רגע';
  const min = Math.round(sec / 60);
  if (min < 60) return HEB_RTF.format(-min, 'minute');
  const hr = Math.round(min / 60);
  if (hr < 24) return HEB_RTF.format(-hr, 'hour');
  const day = Math.round(hr / 24);
  return HEB_RTF.format(-day, 'day');
}

function clockIL(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  } catch {
    return '';
  }
}

// URL builder – תומך ב-limit/lite וסינון ז'אנר
function buildUrl({ forGenre = state.genre, days = 7, limit = 200, lite = false } = {}) {
  const u = new URL(FEED_ENDPOINT);
  u.searchParams.set('days', days.toString());
  u.searchParams.set('limit', limit.toString());
  if (lite) u.searchParams.set('lite', '1'); // הנתמך ב-Worker
  const g = (forGenre || '').toLowerCase();
  if (g === 'hebrew' || g === 'electronic') u.searchParams.set('genre', g);
  return u.toString();
}

function setActiveGenre(value) {
  qsa('[data-genre]').forEach(btn => {
    const active = (btn.getAttribute('data-genre') || '').toLowerCase() === value.toLowerCase();
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function persistStateToUrl() {
  const url = new URL(location.href);
  if (state.genre && state.genre !== 'all') url.searchParams.set('genre', state.genre);
  else url.searchParams.delete('genre');
  history.replaceState(null, '', url);
}

function safeUrl(href) {
  try {
    const u = new URL(href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '#';
  } catch {
    return '#';
  }
}

function makeTags(it) {
  const tags = [];
  if (it.language) tags.push((it.language || '').toUpperCase());
  const g = (it.genre || '').toLowerCase();
  if (g && g !== 'hebrew') tags.push(g);
  return tags;
}

// רנדר כרטיסים בבאצ'ים כדי לשמור על פריימים חלקים
function renderNews(items) {
  if (!feedEl) return;
  feedEl.innerHTML = '';

  if (!items || !items.length) {
    feedEl.innerHTML = `<p class="muted">אין חדשות כרגע.</p>`;
    return;
  }

  const renderBatch = (startIdx) => {
    const batchSize = 24;
    const endIdx = Math.min(startIdx + batchSize, items.length);
    const frag = document.createDocumentFragment();

    for (let i = startIdx; i < endIdx; i++) {
      const it = items[i];
      const el = document.createElement('article');
      el.className = 'news-card';

      const cover = it.cover
        ? `<img class="news-cover" src="${it.cover}" alt="" loading="lazy" decoding="async" fetchpriority="low">`
        : '';

      const absClock = it.date ? clockIL(it.date) : '';
      const relTime = it.date ? timeAgo(it.date) : '';
      const dateHTML = it.date
        ? `<time class="news-date" datetime="${it.date}">
             <span class="rel" dir="rtl">${relTime}</span>
             ${absClock ? `<span class="sep"> · </span><bdi class="clock">${absClock}\u200E</bdi>` : ''}
           </time>`
        : '';

      const tagsHTML = makeTags(it).map(t => `<span class="tag">${t}</span>`).join(' ');

      el.innerHTML = `
        ${cover}
        <div class="news-details">
          <span class="news-source">${it.source || ''}</span>
          <h3 class="news-title"><a href="${safeUrl(it.link)}" target="_blank" rel="noopener noreferrer">${it.headline || ''}</a></h3>
          ${it.summary ? `<p class="news-summary">${it.summary}</p>` : ''}
          <div class="news-footer-meta">
            ${dateHTML}
            <div class="news-tags">${tagsHTML}</div>
          </div>
        </div>
      `;
      frag.appendChild(el);
    }

    feedEl.appendChild(frag);
    if (endIdx < items.length) requestAnimationFrame(() => renderBatch(endIdx));
  };

  renderBatch(0);
}

// קאש בזיכרון
function getCache(key) {
  const rec = memoryCache.byKey.get(key);
  if (!rec) return null;
  if ((Date.now() - rec.ts) > memoryCache.ttl) {
    memoryCache.byKey.delete(key);
    return null;
  }
  return rec.data;
}
function setCache(key, data) {
  memoryCache.byKey.set(key, { data, ts: Date.now() });
}

// "בינלאומי" = כל מה שלא hebrew
function filterForInternational(items) {
  return items.filter(x => (x.genre || '').toLowerCase() !== 'hebrew');
}

// עוזר לבחירת ז'אנר עבור הבקשה לשרת (all/hebrew/electronic)
function pickFetchGenre() {
  return (state.genre === 'hebrew' || state.genre === 'electronic') ? state.genre : 'all';
}

// בקשה עם טיימאאוט
async function timedFetch(url, ms = 15000, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, ...opts });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// --- טעינה דו-שלבית: מהיר (limit=24,lite=1) → הידרציה מלאה (limit=200) ---
async function loadNews(forceRefresh = false) {
  const key = (state.genre || 'all').toLowerCase();

  // 1) אם יש קאש, נציג אותו מיד וללא סקלטון
  if (!forceRefresh) {
    const cached = getCache(key);
    if (cached) {
      renderNews(cached);
      // הידרציה ברקע (לא חובה, אבל מומלץ כדי לעדכן)
      hydrateFullInBackground(key).catch(()=>{});
      return;
    }
  }

  // אין קאש → מציגים סקלטון בזמן שמביאים "מהיר"
  setBusy(true);

  try {
    // שלב מהיר
    const fastUrl = buildUrl({ forGenre: pickFetchGenre(), limit: 24, lite: true });
    const fastRes = await timedFetch(fastUrl, 15000, { cache: 'default' });
    if (!fastRes.ok) throw new Error(`HTTP ${fastRes.status}`);
    const ct1 = fastRes.headers.get('content-type') || '';
    if (!ct1.includes('application/json')) throw new Error('Not JSON response');

    const fastData = await fastRes.json();
    let fastItems = Array.isArray(fastData) ? fastData : (fastData.items || []);
    fastItems = (state.genre === 'international') ? filterForInternational(fastItems) : fastItems;

    renderNews(fastItems);
    setCache(key, fastItems);

  } catch (e) {
    console.error('Fast load error:', e);
    feedEl.innerHTML = `<p class="error">שגיאה בטעינה הראשונית (${e.message})</p>`;
  } finally {
    setBusy(false);
  }

  // הידרציה מלאה ברקע
  hydrateFullInBackground(key).catch(err => console.warn('Hydrate error:', err));
}

// מביא רשימה מלאה ומחליף רק אם היא יותר ארוכה/חדשה
async function hydrateFullInBackground(cacheKey) {
  const fullUrl = buildUrl({ forGenre: pickFetchGenre(), limit: 200, lite: false });
  const res = await timedFetch(fullUrl, 20000, { cache: 'default' });
  if (!res.ok) return;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return;

  const data = await res.json();
  let items = Array.isArray(data) ? data : (data.items || []);
  items = (state.genre === 'international') ? filterForInternational(items) : items;

  const current = getCache(cacheKey) || [];
  // החלפה רק אם באמת יש יותר/חדש (פשוט בודקים אורך)
  if (items.length > current.length) {
    setCache(cacheKey, items);
    renderNews(items);
  }
}

function initFilters() {
  qsa('[data-genre]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.genre = (btn.getAttribute('data-genre') || 'all').toLowerCase();
      setActiveGenre(state.genre);
      persistStateToUrl();
      loadNews(); // יפעיל fast→hydrate בהתאם לז'אנר
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadNews(true)); // force refresh
  }
}

function restoreStateFromUrl() {
  const url = new URL(location.href);
  const genre = (url.searchParams.get('genre') || 'all').toLowerCase();
  state.genre = ['all', 'electronic', 'hebrew', 'international'].includes(genre) ? genre : 'all';
  setActiveGenre(state.genre);
}

// חימום API (HEAD) בזמן סרק
function warmupAPI() {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      fetch(FEED_ENDPOINT, { method: 'HEAD' }).catch(() => {});
    });
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  restoreStateFromUrl();
  initFilters();
  loadNews();
  warmupAPI();
});
