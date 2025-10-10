// app.js – Infinite Scroll + קאש פר-טאב + תיקון לולאת טעינה
const FEED_ENDPOINT = 'https://music-aggregator.dustrial.workers.dev/api/music';

const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

// *** משתני מצב חדשים ***
const MAX_DAYS = 2; // מגבלת הגלילה ליומיים אחורה

let state = {
  genre: 'all',
  days: 1, // מתחילים מיום אחד
  loading: false, // מונע קריאות כפולות (חיוני למניעת לולאת אינסוף)
};

// קאש בזיכרון לפי מפתח (genre_days)
let memoryCache = {
  ttl: 5 * 60 * 1000, // 5 דקות
  byKey: new Map(),   // key -> { data, ts }
};

const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// *** תיקון: setBusy עם לוגיקת ספינר/סקלטון ***
function setBusy(isBusy, isLoadMore = false) { 
  if (!feedEl) return;
  
  if (isBusy) {
      feedEl.setAttribute('aria-busy', 'true');
      if (!isLoadMore) {
          // טעינה ראשונית/רענון מלא: הצג סקלטון
          feedEl.innerHTML = '<div class="skeleton"></div>'.repeat(6);
      } else {
          // גלילה: הצג ספינר זמני
          let spinner = document.getElementById('load-spinner');
          if (!spinner) {
              spinner = document.createElement('div');
              spinner.id = 'load-spinner';
              spinner.className = 'spinner';
              feedEl.appendChild(spinner);
          }
      }
  } else {
      // הסר את מצב ה-busy והספינר
      feedEl.setAttribute('aria-busy', 'false');
      const spinner = document.getElementById('load-spinner');
      if (spinner) spinner.remove();
  }
}

// ... (timeAgo, clockIL - נשארים זהים) ...

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

// *** שינוי: הוספת forDays ל-URL ***
function buildUrl(forGenre = state.genre, forDays = state.days) {
  const u = new URL(FEED_ENDPOINT);
  
  // הוספת סינון ימים
  if (forDays > 0) {
      u.searchParams.set('days', forDays);
  } else {
      u.searchParams.delete('days');
  }
  
  if (forGenre === 'hebrew' || forGenre === 'electronic') {
    u.searchParams.set('genre', forGenre);
  }
  return u.toString();
}

// ... (setActiveGenre, persistStateToUrl, safeUrl, makeTags - נשארים זהים) ...

// *** תיקון: renderNews תמיד מנקה ומחליפה את הכל ***
function renderNews(items) {
  if (!feedEl) return;
  
  // נקה את הפיד תמיד (מבטל את בעיית הכפילויות בגלילה)
  feedEl.innerHTML = ''; 

  // מסיר את סמן הסוף הקודם
  const oldEndMsg = feedEl.querySelector('.end-of-feed-msg');
  if(oldEndMsg) oldEndMsg.remove();
  
  const oldSentinel = document.getElementById('scroll-sentinel');
  if(oldSentinel) oldSentinel.remove();


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
        
      // מבנה ה-HTML המתוקן (כמו ב-styles.css)
      el.innerHTML = `
        ${cover}
        <div class="news-details">
          <span class="news-source">${it.source || ''}</span>
          <h3 class="news-title"><a href="${safeUrl(it.link)}" target="_blank" rel="noopener noreferrer">${it.headline || ''}</a></h3>
          ${it.summary ? `<p class="news-summary">${it.summary}</p>` : ''}
          <div class="news-footer-meta">
            ${dateHTML}
            ${tagsHTML ? `<div class="news-tags">${tagsHTML}</div>` : ''}
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
  
  // *** הוספת סמן גלילה או הודעת סוף ***
  if (state.days < MAX_DAYS) {
      setupInfiniteScroll(); // נמשיך לנטר אחרי הוספת התוכן
  } else {
      const endMsg = document.createElement('p');
      endMsg.className = 'muted footer end-of-feed-msg';
      endMsg.textContent = `נראה שהגעת לסוף הפיד של ${MAX_DAYS} ימים אחרונים.`;
      feedEl.appendChild(endMsg);
      if (observer) observer.disconnect(); // הפסק ניטור
  }
}

// ... (getCache, setCache, filterForInternational - נשארים זהים) ...

// *** תיקון: loadNews משתמשת ב-isLoadMore במקום append ***
async function loadNews(forceRefresh = false, isLoadMore = false) {
  if (state.loading) return; // מונע קריאה נוספת עד לסיום
  
  state.loading = true; // התחל טעינה
  setBusy(true, isLoadMore); // הצג UI בהתאם אם זו גלילה

  const key = `${(state.genre || 'all').toLowerCase()}_${state.days}`; // המפתח לקאש כולל ימים

  // 1) נסה קאש
  if (!forceRefresh) {
    const cached = getCache(key);
    if (cached) {
      renderNews(cached); // רנדר את כל הרשימה מהקאש
      state.loading = false;
      setBusy(false);
      return;
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); 

    // שולח את state.days הנוכחי ל-Worker
    const url = buildUrl(state.genre, state.days); 

    const res = await fetch(url, { cache: 'default', signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    let items = Array.isArray(data) ? data : (data.items || []);

    // 3) סינון ושמירה בקאש
    if (state.genre === 'international') {
      const intl = filterForInternational(items);
      setCache(key, intl); 
      renderNews(intl); // רנדר החלפה מלאה
    } else {
      setCache(key, items); 
      renderNews(items); // רנדר החלפה מלאה
    }
  } catch (e) {
    console.error('Load error:', e);
    // ... (קוד טיפול בשגיאות) ...
  } finally {
    state.loading = false;
    setBusy(false);
  }
}

// *** תיקון: איפוס days ל-1 בלחיצת כפתור ***
function initFilters() {
  qsa('[data-genre]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.genre = (btn.getAttribute('data-genre') || 'all').toLowerCase();
      state.days = 1; // איפוס מספר הימים
      setActiveGenre(state.genre);
      persistStateToUrl();
      loadNews(); 
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
        state.days = 1; // איפוס גם ברענון מלא
        loadNews(true); // force refresh
    });
  }
}

// ... (restoreStateFromUrl, warmupAPI - נשארים זהים) ...
function restoreStateFromUrl() {
  const url = new URL(location.href);
  const genre = (url.searchParams.get('genre') || 'all').toLowerCase();
  state.genre = ['all', 'electronic', 'hebrew', 'international'].includes(genre) ? genre : 'all';
  setActiveGenre(state.genre);
  
  // טען את מצב הימים מה-URL
  const daysParam = parseInt(url.searchParams.get('days'));
  state.days = (daysParam > 0 && daysParam <= MAX_DAYS) ? daysParam : 1;
}

// *** תיקון: Intersection Observer ל-Infinite Scroll (הטריגר) ***
let observer = null;

function setupInfiniteScroll() {
    if (!feedEl || state.days >= MAX_DAYS) return;
    
    // יצירת אלמנט "פרווה" (Sentinel) שנמצא בסוף הפיד
    let sentinel = document.getElementById('scroll-sentinel');
    if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.id = 'scroll-sentinel';
        feedEl.appendChild(sentinel); 
    }
    
    if (observer) observer.disconnect();
    
    observer = new IntersectionObserver((entries) => {
        const sentinelEntry = entries[0];
        // טען רק אם האלמנט נראה, ואם לא עברנו את המגבלה, ואיננו כבר בטעינה
        if (sentinelEntry.isIntersecting && state.days < MAX_DAYS && !state.loading) {
            state.days++;
            sentinel.remove(); 
            persistStateToUrl();
            // 💡 loadNews(forceRefresh=true, isLoadMore=true)
            loadNews(true, true); 
        } else if (state.days >= MAX_DAYS) {
             observer.unobserve(sentinel); 
             observer.disconnect();
        }
    }, {
        root: null, // viewport
        threshold: 0.1 
    });
    
    observer.observe(sentinel);
}


// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  restoreStateFromUrl();
  initFilters();
  
  // טוען את הפיד הראשוני ואז מגדיר את ה-Observer
  loadNews().then(() => { 
      setupInfiniteScroll(); 
  });
  warmupAPI();
});
