// app.js — Genres only, fast-first-load, safe links (fixed time + single language tag)
const FEED_ENDPOINT = 'https://music-aggregator.dustrial.workers.dev/api/music';

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
  co
