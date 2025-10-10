// app.js — Genres only, fast-first-load, safe links (fixed time + single language tag)
const FEED_ENDPOINT = 'https://music-aggregator.dustrial.workers.dev/api/music';

const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

let state = {
  genre: 'all', // all | hebrew | international | electronic
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

// Hebrew relative time + absolute clock in Asia/Jerusalem
const HEB_RTF = new Intl.RelativeTimeFormat('he-IL', { numeric: 'auto' });
const TZ = 'Asia/Jerusalem';

function timeAgo(dateStr){
  if (!dateStr) return '';
  const t = Date.parse(dateStr); if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'לפני רגע';
  const min = Math.round(sec / 60);
  if (min < 60) return HEB_RTF.format(-min, 'minute');  // "לפני X דקות"
  const hr = Math.round(min / 60);
  if (hr < 24)  return HEB_RTF.format(-hr, 'hour');     // "לפני X שעות"
  const day = Math.round(hr / 24);
  return HEB_RTF.format(-day, 'day');                   // "לפני X ימים"
}

function clockIL(dateStr){
  try{
    const d = new Date(dateStr);
    return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  }catch{ return ''; }
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

// decide which tags to render: only one language tag; genre only if not "hebrew"
function makeTags(it){
  const tags = [];
  // language (HE/EN)
  if (it.language) tags.push((it.language || '').toUpperCase());
  // genre except 'hebrew'
  const g = (it.genre || '').toLowerCase();
  if (g && g !== 'hebrew') tags.push(g);
  return tags;
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

    const absClock = it.date ? clockIL(it.date) : '';
    const relTime  = it.date ? timeAgo(it.date) : '';
    const date  = it.date ? `<time class="news-date" dir="ltr" datetime="${it.date}" title="${new Date(it.date).toLocaleString('he-IL', { timeZone: TZ })}">${relTime}${absClock ? ' · ' + absClock : ''}</time>` : '';

    const tags = makeTags(it)
      .map(t => `<span class="tag">${t}</span>`)
      .join(' ');

    el.innerHTML = `
      ${cover}
      <h3 class="news-title"><a href="${safeUrl(it.link)}" target="_blank" rel="noopener noreferrer">${it.headline || ''}</a></h3>
      <div class="news-meta">
        ${date}
        ${it.source ? `<span class="news-source"> · ${it.source}</span>` : ''}
        ${tags ? tags : ''}
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

    // “בינלאומי” = כל מה שלא מסומן כ-hebrew
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
