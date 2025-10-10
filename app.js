// app.js — Genres only, fast-first-load, safe links
const FEED_ENDPOINT = 'https://music-aggregator.dustico.workers.dev/api/music';

const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

let state = {
  genre: 'all', // all | electronic | hebrew | international
};

// small helpers
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function setBusy(isBusy){
  if (!feedEl) return;
  feedEl.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  if (isBusy){
    // Skeletons for perceived speed
    feedEl.innerHTML = '<div class="skeleton"></div>'.repeat(6);
  }
}

function timeAgo(dateStr){
  if (!dateStr) return '';
  const t = Date.parse(dateStr); if (Number.isNaN(t)) return '';
  const diff = Date.now()-t, sec=diff/1000, min=sec/60, hr=min/60, day=hr/24;
  if (sec<60) return 'לפני רגע';
  if (min<60) return `לפני ${Math.round(min)} ד׳`;
  if (hr<24)  return `לפני ${Math.round(hr)} שע׳`;
  return `לפני ${Math.round(day)} ימ׳`;
}

function buildUrl(){
  const u = new URL(FEED_ENDPOINT);
  if (state.genre && state.genre !== 'all') u.searchParams.set('genre', state.genre);
  return u.toString();
}

function setActiveGenre(value){
  qsa('[data-genre]').forEach(btn=>{
    const active = (btn.getAttribute('data-genre')||'').toLowerCase() === value.toLowerCase();
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function persistStateToUrl(){
  const url = new URL(location.href);
  if (state.genre && state.genre!=='all') url.searchParams.set('genre', state.genre);
  else url.searchParams.delete('genre');
  history.replaceState(null,'',url);
}

function safeUrl(href){
  try{
    const u=new URL(href);
    return (u.protocol==='http:' || u.protocol==='https:') ? u.toString() : '#';
  }catch{ return '#'; }
}

function renderNews(items){
  if (!feedEl) return;
  feedEl.innerHTML = '';
  if (!items || !items.length){
    feedEl.innerHTML = `<p class="muted">אין חדשות כרגע.</p>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const it of items){
    const el = document.createElement('article');
    el.className = 'news-card';
    const cover = it.cover ? `<img class="news-cover" src="${it.cover}" alt="" loading="lazy" decoding="async">` : '';
    const date  = it.date ? `<time class="news-date" dir="ltr" datetime="${it.date}" title="${new Date(it.date).toLocaleString('he-IL')}">${timeAgo(it.date)}</time>` : '';
    el.innerHTML = `
      ${cover}
      <h3 class="news-title"><a href="${safeUrl(it.link)}" target="_blank" rel="noopener noreferrer">${it.headline || ''}</a></h3>
      <div class="news-meta">
        ${date}
        ${it.source ? `<span class="news-source"> · ${it.source}</span>` : ''}
        ${it.language ? `<span class="news-lang tag">${it.language}</span>` : ''}
        ${it.genre ? `<span class="news-genre tag">${it.genre}</span>` : ''}
      </div>
      ${it.summary ? `<p class="news-summary">${it.summary}</p>` : ''}
    `;
    frag.appendChild(el);
  }
  feedEl.appendChild(frag);
}

async function loadNews(){
  setBusy(true);
  try{
    const res = await fetch(buildUrl(), { cache:'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Not JSON response');
    const data = await res.json();
    let items = Array.isArray(data) ? data : (data.items || []);

    // אם בחרנו "בינלאומי" – סנן כל מה שמסומן genre=hebrew
    if (state.genre === 'international'){
      items = items.filter(x => (x.genre || '').toLowerCase() !== 'hebrew');
    }

    renderNews(items);
  }catch(e){
    console.error('Load error:', e);
    feedEl.innerHTML = `<div class="spinner" aria-hidden="true"></div><p class="error">שגיאה בטעינת החדשות (${e.message})</p>`;
  }finally{
    setBusy(false);
  }
}

function initFilters(){
  qsa('[data-genre]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state.genre = btn.getAttribute('data-genre') || 'all';
      setActiveGenre(state.genre);
      persistStateToUrl();
      loadNews();
    });
  });
  if (refreshBtn) refreshBtn.addEventListener('click', ()=>loadNews());
}

function restoreStateFromUrl(){
  const url = new URL(location.href);
  const genre = (url.searchParams.get('genre') || 'all').toLowerCase();
  state.genre = ['all','electronic','hebrew','international'].includes(genre) ? genre : 'all';
  setActiveGenre(state.genre);
}

document.addEventListener('DOMContentLoaded', ()=>{
  restoreStateFromUrl();
  initFilters();
  loadNews();

  // warm cache לדפדפן לביקורים חוזרים
  if ('caches' in window){
    caches.open('music-feed-v1').then(cache => {
      cache.add(new Request(FEED_ENDPOINT));
    }).catch(()=>{});
  }
});
