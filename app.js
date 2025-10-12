// app.js – גרסה יציבה עם שיפורי Lighthouse (LCP) ושמירה על הלוגיקה המקורית
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

function escapeHTML(s){
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

// setBusy: מציג סקלטון מלא (טעינה רגילה)
function setBusy(isBusy) {
  if (!feedEl) return;
  feedEl.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  if (isBusy) {
    feedEl.innerHTML = '<div class="skeleton"></div>'.repeat(6);
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

// buildUrl: מוסיף lite=1 להקטנת נפח (מביא אותו מבנה שדות כפי שה-Worker שלך מחזיר)
function buildUrl(forGenre = state.genre) {
  const u = new URL(FEED_ENDPOINT);
  if (forGenre === 'hebrew' || forGenre === 'electronic') {
    u.searchParams.set('genre', forGenre);
  }
  u.searchParams.set('lite','1'); // צמצום payload → שיפור ביצועים
  return u.toString();
}

function setActiveGenre(value) {
  qsa('[data-genre]').forEach(btn => {
    const active = (btn.getAttribute('data-genre') || '').toLowerCase() === value.toLowerCase();
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function updateUrl(addHistory = false) {
  const url = new URL(location.href);
  if (state.genre && state.genre !== 'all') url.searchParams.set('genre', state.genre);
  else url.searchParams.delete('genre');
  (addHistory ? history.pushState : history.replaceState).call(history, null, '', url);
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

// רינדור לפי המודל של ה-Worker: headline/link/cover/date/summary
// שיפורי Lighthouse: לתמונה הראשונה (LCP) אין lazy ויש fetchpriority="high"
function renderNews(items) {
  if (!feedEl) return;
  feedEl.innerHTML = '';

  if (!items || !items.length) {
    feedEl.innerHTML = `<p class="muted">אין חדשות כרגע.</p>`;
    return;
  }

  const frag = document.createDocumentFragment();
  const renderBatch = (startIdx) => {
    const batchSize = 6;
    const endIdx = Math.min(startIdx + batchSize, items.length);

    for (let i = startIdx; i < endIdx; i++) {
      const it = items[i];
      const el = document.createElement('article');
      el.className = 'news-card';

      // LCP: הפריט הראשון בעמוד (i === 0) – בלי lazy, עם עדיפות רשת
      const isLCP = i === 0;
      const lazy  = isLCP ? '' : ' loading="lazy"';
      const prio  = isLCP ? ' fetchpriority="high" decoding="async"' : ' decoding="async"';

      const cover = it.cover
        ? `<img class="news-cover" src="${safeUrl(it.cover)}"${lazy}${prio} alt="">`
        : '';

      const absClock = it.date ? clockIL(it.date) : '';
      const relTime = it.date ? timeAgo(it.date) : '';

      const dateHTML = it.date
        ? `<time class="news-date" datetime="${it.date}">
             <span class="rel" dir="rtl">${escapeHTML(relTime)}</span>
             ${absClock ? `<span class="sep"> · </span><bdi class="clock">${escapeHTML(absClock)}\u200E</bdi>` : ''}
           </time>`
        : '';

      const tagsHTML = makeTags(it)
        .map(t => `<span class="tag">${escapeHTML(t)}</span>`)
        .join(' ');

      el.innerHTML = `
        ${cover}
        <div class="news-details">
          <span class="news-source">${escapeHTML(it.source || '')}</span>
          <h3 class="news-title"><a href="${safeUrl(it.link)}" target="_blank" rel="noopener noreferrer">${escapeHTML(it.headline || '')}</a></h3>
          ${it.summary ? `<p class="news-summary">${escapeHTML(it.summary)}</p>` : ''}
          <div class="news-footer-meta">
            ${dateHTML}
            <div class="news-tags">${tagsHTML}</div>
          </div>
        </div>
      `;
      frag.appendChild(el);
    }

    if (endIdx < items.length) {
      requestAnimationFrame(() => renderBatch(endIdx));
    }
  };

  renderBatch(0);
  feedEl.appendChild(frag);
}

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

// טעינה (ללא גלילה אינסופית)
async function loadNews(forceRefresh = false) {
  setBusy(true);
  const key = (state.genre || 'all').toLowerCase();

  if (!forceRefresh) {
    const cached = getCache(key);
    if (cached) {
      renderNews(cached);
      setBusy(false);
      return;
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const fetchGenre = (state.genre === 'hebrew' || state.genre === 'electronic') ? state.genre : 'all';
    const url = buildUrl(fetchGenre);

    const res = await fetch(url, { cache: 'default', signal: controller.signal, headers: { 'accept':'application/json' } });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) throw new Error('Not JSON response');

    const data = await res.json();
    let items = Array.isArray(data) ? data : (data.items || []);

    // אם תרצה לבטל את הסינון המקומי ל-international, שנה את הקטע הבא בהתאם
    let finalItems;
    if (state.genre === 'international') {
      finalItems = filterForInternational(items);
    } else {
      finalItems = items;
    }

    setCache(key, finalItems);
    renderNews(finalItems);

  } catch (e) {
    console.error('Load error:', e);
    if (e.name === 'AbortError') {
      feedEl.innerHTML = `<p class="error">הבקשה ארכה יותר מדי. אנא נסה שוב.</p>`;
    } else {
      feedEl.innerHTML = `<p class="error">שגיאה בטעינת החדשות (${escapeHTML(e.message)})</p>`;
    }
  } finally {
    setBusy(false);
  }
}

function initFilters() {
  qsa('[data-genre]').forEach(el => {
    el.addEventListener('click', (ev) => {
      if (el.tagName === 'A') ev.preventDefault();
      state.genre = (el.getAttribute('data-genre') || 'all').toLowerCase();
      setActiveGenre(state.genre);
      updateUrl(true);
      loadNews(true); // רענון מיידי לטאב החדש
    }, { passive: false });
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

// טעינה מוקדמת של ה-API (לא חוסם ציור)
function warmupAPI() {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      fetch(FEED_ENDPOINT, { method: 'HEAD' }).catch(() => {});
    });
  } else {
    setTimeout(() => { fetch(FEED_ENDPOINT, { method: 'HEAD' }).catch(() => {}); }, 1000);
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  restoreStateFromUrl();
  updateUrl(false);
  initFilters();
  loadNews();
  warmupAPI();
});

window.addEventListener('popstate', () => {
  restoreStateFromUrl();
  loadNews(true);
});
