// app.js – קאש פר-טאב + תיקון מעבר טאבים (גרסה יציבה)
const FEED_ENDPOINT = 'https://music-aggregator.dustrial.workers.dev/api/music';

const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

let state = {
  genre: 'all',
  // state.days הוסר
};

// קאש בזיכרון לפי מפתח (genre)
let memoryCache = {
  ttl: 5 * 60 * 1000, // 5 דקות
  byKey: new Map(),   // key -> { data, ts }
};

const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// *** setBusy: מציג סקלטון מלא (טעינה רגילה) ***
function setBusy(isBusy) {
  if (!feedEl) return;
  feedEl.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  if (isBusy) {
    // מציג סקלטון מלא
    feedEl.innerHTML = '<div class="skeleton"></div>'.repeat(6);
  } else {
     // הסר סקלטון
     const spinner = document.getElementById('scroll-spinner'); // לוודא שלא נשאר ספינר
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

// *** buildUrl: ללא days ***
function buildUrl(forGenre = state.genre) {
  const u = new URL(FEED_ENDPOINT);
  
  if (forGenre === 'hebrew' || forGenre === 'electronic') {
    u.searchParams.set('genre', forGenre);
  }
  // days הוסר - ה-Worker יביא את ברירת המחדל (יום 1 או 3, תלוי בו)
  return u.toString();
}

// setActiveGenre (נשאר זהה)
function setActiveGenre(value) {
  qsa('[data-genre]').forEach(btn => {
    const active = (btn.getAttribute('data-genre') || '').toLowerCase() === value.toLowerCase();
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

// persistStateToUrl (נשאר זהה)
function persistStateToUrl() {
  const url = new URL(location.href);
  if (state.genre && state.genre !== 'all') url.searchParams.set('genre', state.genre);
  else url.searchParams.delete('genre');
  // days הוסר
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

// *** renderNews: רנדור רגיל (ללא סנטינל או הודעת סוף) ***
function renderNews(items) {
  if (!feedEl) return;
  
  feedEl.innerHTML = ''; // נקה
  // הוסר ניתוק ה-Observer והוספת הסנטינל/הודעת סוף

  if (!items || !items.length) {
    feedEl.innerHTML = `<p class="muted">אין חדשות כרגע.</p>`;
    return;
  }
  
  const frag = document.createDocumentFragment();

  // רינדור בבאצ'ים
  const renderBatch = (startIdx) => {
    const batchSize = 6;
    const endIdx = Math.min(startIdx + batchSize, items.length);

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

      const tagsHTML = makeTags(it)
        .map(t => `<span class="tag">${t}</span>`)
        .join(' ');
        
      el.innerHTML = `
        ${cover}
        <h3 class="news-title"><a href="${safeUrl(it.link)}" target="_blank" rel="noopener noreferrer">${it.headline || ''}</a></h3>
        <div class="news-meta">
          ${dateHTML}
          ${it.source ? `<span class="news-source"> · ${it.source}</span>` : ''}
          ${tagsHTML ? tagsHTML : ''}
        </div>
        ${it.summary ? `<p class="news-summary">${it.summary}</p>` : ''}
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

// *** loadNews: ללא isLoadMore או state.loading ***
async function loadNews(forceRefresh = false) {
  setBusy(true);

  const key = (state.genre || 'all').toLowerCase(); // המפתח לקאש הוא רק ה-genre

  // 1) נסה קאש
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

    const res = await fetch(url, { cache: 'default', signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Not JSON response');

    const data = await res.json();
    let items = Array.isArray(data) ? data : (data.items || []);

    // 3) סינון ושמירה בקאש
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
      feedEl.innerHTML = `<p class="error">שגיאה בטעינת החדשות (${e.message})</p>`;
    }
  } finally {
    setBusy(false);
  }
}

// *** initFilters: ללא איפוס days ***
function initFilters() {
  qsa('[data-genre]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.genre = (btn.getAttribute('data-genre') || 'all').toLowerCase();
      setActiveGenre(state.genre);
      persistStateToUrl();
      loadNews(); // תמיד טען לפי המפתח החדש
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadNews(true)); // force refresh
  }
}

// restoreStateFromUrl (ללא days)
function restoreStateFromUrl() {
  const url = new URL(location.href);
  const genre = (url.searchParams.get('genre') || 'all').toLowerCase();
  state.genre = ['all', 'electronic', 'hebrew', 'international'].includes(genre) ? genre : 'all';
  setActiveGenre(state.genre);
}

// טעינה מוקדמת של הAPI
function warmupAPI() {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      fetch(FEED_ENDPOINT, { method: 'HEAD' }).catch(() => {});
    });
  }
}

// *** הוסר: Intersection Observer ו-setupInfiniteScroll ***


// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  restoreStateFromUrl();
  initFilters();
  loadNews(); 
  warmupAPI();
});
