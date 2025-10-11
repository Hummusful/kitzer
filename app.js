// app.js – קאש פר-טאב + תיקון מעבר טאבים
const FEED_ENDPOINT = 'https://music-aggregator.dustrial.workers.dev/api/music';

const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

let state = {
  genre: 'all',
};

// קאש בזיכרון לפי מפתח (genre)
let memoryCache = {
  ttl: 5 * 60 * 1000, // 5 דקות
  byKey: new Map(),   // key -> { data, ts }
};

const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
  const diff = Date.now() - t;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return HEB_RTF.format(-seconds, 'second');
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
  if (items.length === 0) {
    feedEl.innerHTML = '<p class="empty-state">לא נמצאו כתבות עדכניות בז\'אנר הזה ב-7 הימים האחרונים.</p>';
    return;
  }

  feedEl.innerHTML = items.map(item => {
    const timeDisplay = timeAgo(item.date);
    const hasImage = item.cover && item.cover.length > 0;
    
    return `
      <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="news-item ${hasImage ? 'has-image' : ''}">
        ${hasImage ? `<div class="image-container"><img src="${item.cover}" alt="כותרת תמונה" onerror="this.closest('.news-item').classList.remove('has-image'); this.remove();"></div>` : ''}
        <div class="content-container">
          <h2 class="headline">${item.headline}</h2>
          <p class="summary">${item.summary}</p>
          <div class="meta-data">
            <span class="source-tag">${item.source}</span>
            <span class="time muted">${timeDisplay}</span>
          </div>
        </div>
      </a>
    `;
  }).join('');
}

function setActiveGenre(genre) {
  qsa('[data-genre]').forEach(btn => {
    const btnGenre = btn.getAttribute('data-genre') || 'all';
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

async function loadNews(forceRefresh = false) {
  const key = state.genre;

  // 1. נסה לטעון מקאש בזיכרון
  const cached = memoryCache.byKey.get(key);
  if (cached && !forceRefresh && (Date.now() - cached.ts) < memoryCache.ttl) {
    renderNews(cached.data);
    return;
  }

  // 2. הצג טעינה
  setBusy(true);

  let apiUrl = `${FEED_ENDPOINT}?genre=${key === 'all' ? '' : key}`;
  
  // 🛠️ אם זה רענון כפוי, הוסף cachebust כדי לעקוף את קאש ה-Worker
  if (forceRefresh) {
    apiUrl += `&cachebust=${Date.now()}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25 שניות
    
    const response = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // 3. שמור בזיכרון ורנדר
    memoryCache.byKey.set(key, { data, ts: Date.now() });
    renderNews(data);

  } catch (e) {
    if (e.name === 'AbortError') {
      feedEl.innerHTML = `<p class="error">הבקשה ארכה יותר מדי. אנא נסה שוב.</p>`;
    } else {
      feedEl.innerHTML = `<p class="error">שגיאה בטעינת החדשות (${e.message})</p>`;
    }
  } finally {
    setBusy(false);
  }
}

function initFilters() {
  qsa('[data-genre]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.genre = (btn.getAttribute('data-genre') || 'all').toLowerCase();
      setActiveGenre(state.genre);
      persistStateToUrl();
      // 🛠️ טוען ללא רענון כפוי בלחיצת כפתור (משתמש בקאש ה-Worker)
      loadNews(); 
    });
  });

  if (refreshBtn) {
    // 🛠️ כפתור רענון תמיד מבצע רענון כפוי
    refreshBtn.addEventListener('click', () => loadNews(true)); 
  }
}

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
  } else {
    // Fallback למטה דלוק:
    setTimeout(() => {
      fetch(FEED_ENDPOINT, { method: 'HEAD' }).catch(() => {});
    }, 500);
  }
}

// מנהל: אתחל וטען
window.addEventListener('load', () => {
  restoreStateFromUrl();
  initFilters();
  loadNews();
  warmupAPI();
});
// 🛠️ האזנה לאירועי היסטוריה (כפתור אחורה/קדימה בדפדפן)
window.addEventListener('popstate', () => {
  restoreStateFromUrl();
  loadNews(); 
});
