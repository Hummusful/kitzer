// app.js – קאש פר-טאב + תיקון מעבר טאבים + הקשחות קלות
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

// escape בסיסי ל־HTML
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setBusy(isBusy) {
  if (!feedEl) return;
  feedEl.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  if (isBusy) {
    // השתמש בסקלטון רק אם אין תוכן ישן להציג
    if (!feedEl.querySelector('.news-item')) {
      feedEl.innerHTML = '<div class="skeleton"></div>'.repeat(6);
    }
  }
}

// Hebrew relative time + absolute clock
const HEB_RTF = new Intl.RelativeTimeFormat('he-IL', { numeric: 'auto' });
const TZ = 'Asia/Jerusalem';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return '';
  let diff = Date.now() - t;

  // אם התאריך בעתיד בפער קטן – הצמד ל"עכשיו"
  if (diff < 0 && Math.abs(diff) < 5 * 60 * 1000) diff = 0;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return HEB_RTF.format(-seconds, 'second'); // "לפני X שניות"
  if (minutes < 60) return HEB_RTF.format(-minutes, 'minute');
  if (hours < 24) return HEB_RTF.format(-hours, 'hour');
  if (days < 7) return HEB_RTF.format(-days, 'day');

  // מעל 7 ימים מציג תאריך ושעה מדויקים
  return new Date(t).toLocaleString('he-IL', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderNews(items) {
  if (!feedEl) return;
  if (!Array.isArray(items) || items.length === 0) {
    feedEl.innerHTML = '<p class="empty-state">לא נמצאו כתבות עדכניות בז׳אנר הזה ב-7 הימים האחרונים.</p>';
    return;
  }

  feedEl.innerHTML = items.map(item => {
    const timeDisplay = timeAgo(item.date);
    const hasImage = item.cover && item.cover.length > 0;

    // escape לשדות טקסטואליים
    const headline = escapeHtml(item.headline);
    const summary  = escapeHtml(item.summary);
    const source   = escapeHtml(item.source);
    const link     = item.link || '#';
    const cover    = item.cover || '';

    return `
      <a href="${link}" target="_blank" rel="noopener noreferrer" class="news-item ${hasImage ? 'has-image' : ''}">
        ${hasImage ? `<div class="image-container"><img src="${cover}" alt="תמונת כתבה" onerror="this.closest('.news-item').classList.remove('has-image'); this.remove();"></div>` : ''}
        <div class="content-container">
          <h2 class="headline">${headline}</h2>
          <p class="summary">${summary}</p>
          <div class="meta-data">
            <span class="source-tag">${source}</span>
            <span class="time muted">${timeDisplay}</span>
          </div>
        </div>
      </a>
    `;
  }).join('');
}

function setActiveGenre(genre) {
  qsa('[data-genre]').forEach(btn => {
    const btnGenre = (btn.getAttribute('data-genre') || 'all').toLowerCase();
    const isActive = btnGenre === genre;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function persistStateToUrl() {
  const url = new URL(location.href);
  if (state.genre !== 'all') {
    url.searchParams.set('genre', state.genre);
  } else {
    url.searchParams.delete('genre');
  }
  history.pushState(null, '', url.toString());
}

// מונה גלובלי למניעת מרוץ בקשות
let requestCounter = 0;

async function loadNews(forceRefresh = false) {
  const key = state.genre;
  const myReqId = ++requestCounter;

  // 1) נסה לטעון מקאש בזיכרון
  const cached = memoryCache.byKey.get(key);
  if (cached && !forceRefresh && (Date.now() - cached.ts) < memoryCache.ttl) {
    // רק אם עדיין בטאב הזה
    if (myReqId === requestCounter) renderNews(cached.data);
    return;
  }

  // 2) הצג טעינה
  setBusy(true);

  // בנה URL מסודר בלי פרמטר ריק
  const u = new URL(FEED_ENDPOINT);
  if (key !== 'all') u.searchParams.set('genre', key);
  if (forceRefresh) u.searchParams.set('cachebust', Date.now().toString());

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25 שניות

    const response = await fetch(u.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    // אם במהלך ההמתנה עברנו לטאב אחר — אל תדרוס תצוגה עדכנית
    if (myReqId !== requestCounter) return;

    // 3) שמור בזיכרון ורנדר
    memoryCache.byKey.set(key, { data, ts: Date.now() });
    renderNews(data);

  } catch (e) {
    if (myReqId !== requestCounter) return; // בקשה "ישנה" – אל תציג הודעת שגיאה
    if (e.name === 'AbortError') {
      feedEl.innerHTML = `<p class="error">הבקשה ארכה יותר מדי. אנא נסה שוב.</p>`;
    } else {
      feedEl.innerHTML = `<p class="error">שגיאה בטעינת החדשות (${escapeHtml(e.message)})</p>`;
    }
  } finally {
    if (myReqId === requestCounter) setBusy(false);
  }
}

function initFilters() {
  qsa('[data-genre]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.genre = (btn.getAttribute('data-genre') || 'all').toLowerCase();
      setActiveGenre(state.genre);
      persistStateToUrl();
      loadNews(); // שימוש בקאש אם זמין
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadNews(true)); // רענון כפוי
  }
}

function restoreStateFromUrl() {
  const url = new URL(location.href);
  const genre = (url.searchParams.get('genre') || 'all').toLowerCase();
  state.genre = ['all', 'electronic', 'hebrew', 'international'].includes(genre) ? genre : 'all';
  setActiveGenre(state.genre);
}

// טעינה מוקדמת של ה-API
function warmupAPI() {
  const doHead = () => {
    try {
      fetch(FEED_ENDPOINT, { method: 'HEAD' }).catch(() => {});
    } catch (_) {}
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(doHead);
  } else {
    setTimeout(doHead, 500);
  }
}

// מנהל: אתחל וטען
window.addEventListener('load', () => {
  restoreStateFromUrl();
  initFilters();
  loadNews();
  warmupAPI();
});

// האזנה לאירועי היסטוריה (כפתור אחורה/קדימה בדפדפן)
window.addEventListener('popstate', () => {
  restoreStateFromUrl();
  loadNews();
});
