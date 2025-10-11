// app.js – טעינה מהירה (שלב 1) + הידרציה (שלב 2), קאש פר-טאב
const FEED_ENDPOINT = 'https://music-aggregator.dustrial.workers.dev/api/music';

const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

let state = { genre: 'all' };

// קאש בזיכרון לפי מפתח (genre + פרמטרים רלוונטיים)
let memoryCache = {
  ttl: 5 * 60 * 1000, // 5 דקות
  byKey: new Map(),   // key -> { data, ts }
};

const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Skeleton
function setBusy(isBusy) {
  if (!feedEl) return;
  feedEl.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  if (isBusy) {
    // הצג סקלטון רק אם אין תוכן
    if (!feedEl.querySelector('.news-card')) {
      feedEl.innerHTML = '<div class="skeleton"></div>'.repeat(6);
    }
  } else {
    const spinner = document.getElementById('scroll-spinner');
    if (spinner) spinner.remove();
  }
}

// זמן יחסי ושעון
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

// --- URL builder עם פרמטרים דינמיים ---
function buildUrl({ forGenre = state.genre, days = 7, limit = 200, lite = false } = {}) {
  const u = new URL(FEED_ENDPOINT);
  u.searchParams.set('days', days.toString());
  u.searchParams.set('limit', limit.toString());
  if (lite) u.searchParams.set('lite', '1'); // יתעלם אם ה-Worker לא מכיר, זה בסדר.

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

// --- רנדר ---
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
        ? `<img class="news-cover" src="${it.cover}" alt="" loading="lazy" decoding="async">`
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

// --- קאש ---
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

function filterForInternational(items) {
  return items.filter(x => (x.genre || '').toLowerCase() !== 'hebrew');
}

// --- פטצ' עם timeout ---
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

// --- טעינה דו-שלבית: מהיר → מלא ---
async function loadNews(forceRefresh = false) {
  setBusy(true);

  const genreKey = (state.genre || 'all').toLowerCase();

  // 1) קאש (אם לא בכפייה)
  if (!forceRefresh) {
    const cached = getCache(genreKey);
    if (cached) {
      renderNews(cached);
      setBusy(false);
      // עדיין נרענן ברקע אחרי הצגה
      hydrateFullInBackground(genreKey).catch(()=>{});
      return;
    }
  }

  // 2) שלב מהיר: מעט פריטים (limit=24)
  try {
    const initialUrl = buildUrl({
      forGenre: pickFetchGenre(),
      limit: 24,        // מעט פריטים להצגה מהירה
      lite: true        // יתעלם אם ה-Worker לא תומך
    });

    const fastRes = await timedFetch(initialUrl, 15000, { cache: 'default' });
    if (!fastRes.ok) throw new Error(`HTTP ${fastRes.status}`);
    const ct = fastRes.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Not JSON response');
    const fastData = await fastRes.json();
    let items = Array.isArray(fastData) ? fastData : (fastData.items || []);

    // סינון לפי טאב "international"
    items = (state.genre === 'international') ? filterForInternational(items) : items;

    // הצג מהר ושמור קאש
    renderNews(items);
    setCache(genreKey, items);
  } catch (e) {
    console.error('Fast load error:', e);
    // ננסה לפחות להציג הודעה מכובדת אם אין כלום
    if (!feedEl.querySelector('.news-card')) {
      feedEl.innerHTML = `<p class="error">שגיאה בטעינה הראשונית (${e.message})</p>`;
    }
  } finally {
    setBusy(false);
  }

  // 3) הידרציה: גרסה מלאה ברקע (limit=200)
  hydrateFullInBackground(genreKey).catch(err => console.warn('Hydrate error:', err));
}

function pickFetchGenre() {
  return (state.genre === 'hebrew' || state.genre === 'electronic') ? state.genre : 'all';
}

async function hydrateFullInBackground(genreKey) {
  const fullUrl = buildUrl({
    forGenre: pickFetchGenre(),
    limit: 200,
    lite: false
  });

  const res = await timedFetch(fullUrl, 20000, { cache: 'default' });
  if (!res.ok) return;

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return;

  const data = await res.json();
  let items = Array.isArray(data) ? data : (data.items || []);
  items = (state.genre === 'international') ? filterForInternational(items) : items;

  // אם המלא מכיל יותר/חדש → החלף תצוגה וקאש
  const current = getCache(genreKey) || [];
  if (items.length > current.length) {
    setCache(genreKey, items);
    renderNews(items);
  }
}

// פילטרים ואירועים
function initFilters() {
  qsa('[data-genre]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.genre = (btn.getAttribute('data-genre') || 'all').toLowerCase();
      setActiveGenre(state.genre);
      persistStateToUrl();
      loadNews(); // יפעיל fast→hydrate לפי הז’אנר החדש
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadNews(true)); // רענון בכפייה
  }
}

function restoreStateFromUrl() {
  const url = new URL(location.href);
  const genre = (url.searchParams.get('genre') || 'all').toLowerCase();
  state.genre = ['all', 'electronic', 'hebrew', 'international'].includes(genre) ? genre : 'all';
  setActiveGenre(state.genre);
}

// חימום API קליל
function warmupAPI() {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      fetch(FEED_ENDPOINT, { method: 'HEAD' }).catch(() => {});
    });
  }
}

// אתחול
document.addEventListener('DOMContentLoaded', () => {
  restoreStateFromUrl();
  initFilters();
  loadNews(); 
  warmupAPI();
});
