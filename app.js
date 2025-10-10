// app.js — Dustico Production version (Worker endpoint fixed)

// ✅ הנתיב הנכון ל־Worker שלך:
const FEED_ENDPOINT = 'https://music-aggregator.dustico.workers.dev/api/music';

const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

let state = {
  genre: 'all', // all | electronic | hebrew
  lang:  'ALL', // ALL | HE | EN
};

// ---------- UTILITIES ----------
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function setBusy(isBusy) {
  if (feedEl) feedEl.setAttribute('aria-busy', isBusy ? 'true' : 'false');
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr  = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) return 'לפני רגע';
  if (min < 60) return `לפני ${min} ד׳`;
  if (hr < 24) return `לפני ${hr} שע׳`;
  return `לפני ${day} ימ׳`;
}

function buildUrl() {
  const u = new URL(FEED_ENDPOINT);
  if (state.genre && state.genre !== 'all') u.searchParams.set('genre', state.genre);
  if (state.lang && state.lang !== 'ALL') u.searchParams.set('lang', state.lang);
  return u.toString();
}

function setActiveButtons(groupSelector, attr, value) {
  qsa(`${groupSelector} .btn`).forEach(btn => {
    const active = (btn.getAttribute(attr) || '').toLowerCase() === value.toLowerCase();
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function persistStateToUrl() {
  const url = new URL(location.href);
  if (state.genre && state.genre !== 'all') url.searchParams.set('genre', state.genre);
  else url.searchParams.delete('genre');
  if (state.lang && state.lang !== 'ALL') url.searchParams.set('lang', state.lang);
  else url.searchParams.delete('lang');
  history.replaceState(null, '', url);
}

// ---------- RENDER ----------
function renderNews(items) {
  if (!feedEl) return;
  feedEl.innerHTML = '';

  if (!items || !items.length) {
    feedEl.innerHTML = `<p class="muted">אין חדשות כרגע.</p>`;
    return;
  }

  const frag = document.createDocumentFragment();

  for (const it of items) {
    const card = document.createElement('article');
    card.className = 'news-card';

    const cover = it.cover ? `<img class="news-cover" src="${it.cover}" alt="" loading="lazy">` : '';
    const date  = it.date ? `<time class="news-date" datetime="${it.date}" title="${new Date(it.date).toLocaleString('he-IL')}">${timeAgo(it.date)}</time>` : '';

    card.innerHTML = `
      ${cover}
      <h3 class="news-title"><a href="${it.link}" target="_blank" rel="noopener noreferrer">${it.headline || ''}</a></h3>
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

// ---------- LOAD ----------
async function loadNews() {
  setBusy(true);
  try {
    const url = buildUrl();
    const res = await fetch(url, { cache: 'no-store' });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} - ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('Not JSON response');
    }

    const data = await res.json();
    const items = Array.isArray(data) ? data : data.items || [];
    renderNews(items);
  } catch (e) {
    console.error('Load error:', e);
    feedEl.innerHTML = `<p class="error">שגיאה בטעינת החדשות (${e.message})</p>`;
  } finally {
    setBusy(false);
  }
}

// ---------- EVENTS ----------
function initFilters() {
  qsa('[data-genre]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.genre = btn.getAttribute('data-genre') || 'all';
      setActiveButtons('[aria-label="Genre"]', 'data-genre', state.genre);
      persistStateToUrl();
      loadNews();
    });
  });

  qsa('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.lang = btn.getAttribute('data-lang') || 'ALL';
      setActiveButtons('[aria-label="Language"]', 'data-lang', state.lang);
      persistStateToUrl();
      loadNews();
    });
  });

  if (refreshBtn) refreshBtn.addEventListener('click', () => loadNews());
}

function restoreStateFromUrl() {
  const url = new URL(location.href);
  const genre = (url.searchParams.get('genre') || 'all').toLowerCase();
  const lang  = (url.searchParams.get('lang') || 'ALL').toUpperCase();
  state.genre = ['all', 'electronic', 'hebrew'].includes(genre) ? genre : 'all';
  state.lang  = ['ALL', 'HE', 'EN'].includes(lang) ? lang : 'ALL';
  setActiveButtons('[aria-label="Genre"]', 'data-genre', state.genre);
  setActiveButtons('[aria-label="Language"]', 'data-lang', state.lang);
}

// ---------- INIT ----------
document.addEventListener('DOMContentLoaded', () => {
  restoreStateFromUrl();
  initFilters();
  loadNews();
});
