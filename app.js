// app.js — UI logic for genre/lang + rendering + refresh

const FEED_ENDPOINT = '/api/music';
const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

let state = {
  genre: 'all',    // all | electronic | hebrew
  lang:  'ALL',    // ALL | HE | EN
};

// ---- Utils ----
function qsAll(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function setBusy(isBusy) {
  feedEl.setAttribute('aria-busy', isBusy ? 'true' : 'false');
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  const min = Math.round(sec / 60);
  const hr  = Math.round(min / 60);
  const day = Math.round(hr / 24);
  if (sec < 60) return 'לפני רגע';
  if (min < 60) return `לפני ${min} ד׳`;
  if (hr  < 24) return `לפני ${hr} שע׳`;
  return `לפני ${day} ימ׳`;
}

function buildUrl() {
  const u = new URL(FEED_ENDPOINT, location.origin);
  if (state.genre && state.genre !== 'all') u.searchParams.set('genre', state.genre);
  if (state.lang  && state.lang  !== 'ALL') u.searchParams.set('lang', state.lang);
  return u.toString();
}

function setActiveButtons(groupSelector, attr, value) {
  qsAll(`${groupSelector} .btn`).forEach(btn => {
    const isActive = (btn.getAttribute(attr) || '').toLowerCase() === value.toLowerCase();
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function persistUiStateToUrl() {
  // אופציונלי: משקף מצב לטאב/שאילתא כדי לשתף קישור
  const url = new URL(location.href);
  if (state.genre && state.genre !== 'all') url.searchParams.set('genre', state.genre); else url.searchParams.delete('genre');
  if (state.lang  && state.lang  !== 'ALL') url.searchParams.set('lang',  state.lang);  else url.searchParams.delete('lang');
  history.replaceState(null, '', url);
}

// ---- Rendering ----
function renderNews(items) {
  feedEl.innerHTML = '';
  if (!items || !items.length) {
    feedEl.innerHTML = `<p class="muted">אין חדשות כרגע.</p>`;
    return;
  }

  const frag = document.createDocumentFragment();

  for (const it of items) {
    const card = document.createElement('article');
    card.className = 'news-card';
    card.setAttribute('role', 'article');

    const cover = it.cover ? `<img class="news-cover" src="${it.cover}" alt="" loading="lazy" decoding="async">` : '';
    const date  = it.date ? `<time class="news-date" datetime="${it.date}" title="${new Date(it.date).toLocaleString('he-IL')}">${timeAgo(it.date)}</time>` : '';

    card.innerHTML = `
      ${cover}
      <h3 class="news-title">
        <a href="${it.link}" target="_blank" rel="noopener noreferrer">${it.headline || ''}</a>
      </h3>
      <div class="news-meta">
        ${date}
        ${it.source ? `<span class="news-source"> · ${it.source}</span>` : ''}
        ${it.language ? `<span class="news-lang tag">${it.language}</span>` : ''}
        ${it.genre ? `<span class="news-genre tag">${it.genre}</span>` : ''}
      </div>
      ${it.summary ? `<p class="news-summary">${it.summary}</p>` : ''}
    `;
    frag.appendChild(card);
  }

  feedEl.appendChild(frag);
}

// ---- Data load ----
async function loadNews() {
  setBusy(true);
  try {
    const res = await fetch(buildUrl(), { cache: 'no-store' });
    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.items || []);
    renderNews(items);
  } catch (e) {
    console.error(e);
    feedEl.innerHTML = `<p class="error">שגיאה בטעינת החדשות. נסה שוב.</p>`;
  } finally {
    setBusy(false);
  }
}

// ---- Wire UI ----
function initFilters() {
  // Genre buttons
  qsAll('[data-genre]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.genre = btn.getAttribute('data-genre') || 'all';
      setActiveButtons('[aria-label="Genre"]', 'data-genre', state.genre);
      persistUiStateToUrl();
      loadNews();
    });
  });

  // Language buttons
  qsAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.lang = btn.getAttribute('data-lang') || 'ALL';
      setActiveButtons('[aria-label="Language"]', 'data-lang', state.lang);
      persistUiStateToUrl();
      loadNews();
    });
  });

  // Refresh
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadNews());
  }
}

function restoreStateFromUrl() {
  const url = new URL(location.href);
  const genre = (url.searchParams.get('genre') || 'all').toLowerCase();
  const lang  = (url.searchParams.get('lang')  || 'ALL').toUpperCase();

  state.genre = ['all','electronic','hebrew'].includes(genre) ? genre : 'all';
  state.lang  = ['ALL','HE','EN'].includes(lang) ? lang : 'ALL';

  setActiveButtons('[aria-label="Genre"]', 'data-genre', state.genre);
  setActiveButtons('[aria-label="Language"]', 'data-lang', state.lang);
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  restoreStateFromUrl();
  initFilters();
  loadNews();
});
