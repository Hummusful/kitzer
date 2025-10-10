// app.js — resilient wiring (supports old data-filter and new data-genre/lang)
const FEED_ENDPOINT = '/api/music';
const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

let state = {
  genre: 'all',   // all|electronic|hebrew
  lang:  'ALL',   // ALL|HE|EN
};

// ---- utils ----
const qs = (s, r=document) => r.querySelector(s);
const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
const safeForEach = (list, fn) => Array.isArray(list) ? list.forEach(fn) : (list && list.forEach && list.forEach(fn));

function setBusy(b){ if(feedEl) feedEl.setAttribute('aria-busy', b?'true':'false'); }

function timeAgo(d){
  const t = Date.parse(d); if (Number.isNaN(t)) return '';
  const diff = Date.now()-t, m = diff/60000, h=m/60, day=h/24;
  if (m<1) return 'לפני רגע';
  if (m<60) return `לפני ${Math.round(m)} ד׳`;
  if (h<24) return `לפני ${Math.round(h)} שע׳`;
  return `לפני ${Math.round(day)} ימ׳`;
}

function buildUrl(){
  const u = new URL(FEED_ENDPOINT, location.origin);
  if (state.genre && state.genre!=='all') u.searchParams.set('genre', state.genre);
  if (state.lang  && state.lang!=='ALL') u.searchParams.set('lang',  state.lang);
  return u.toString();
}

function setActiveButtons(groupRoot, attr, val){
  const root = qs(groupRoot) || document;
  qsa(`[${attr}]`, root).forEach(btn=>{
    const isActive = (btn.getAttribute(attr)||'').toLowerCase()===val.toLowerCase();
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive?'true':'false');
  });
}

// reflect state in URL (optional)
function persistState(){
  const url = new URL(location.href);
  (state.genre && state.genre!=='all') ? url.searchParams.set('genre', state.genre) : url.searchParams.delete('genre');
  (state.lang  && state.lang!=='ALL') ? url.searchParams.set('lang',  state.lang)  : url.searchParams.delete('lang');
  history.replaceState(null,'',url);
}

// ---- render ----
function renderNews(items){
  if (!feedEl) return;
  feedEl.innerHTML='';
  if (!items || !items.length){
    feedEl.innerHTML = `<p class="muted">אין חדשות כרגע.</p>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const it of items){
    const card = document.createElement('article');
    card.className='news-card';
    const cover = it.cover ? `<img class="news-cover" src="${it.cover}" alt="" loading="lazy" decoding="async">` : '';
    const date  = it.date ? `<time class="news-date" datetime="${it.date}" title="${new Date(it.date).toLocaleString('he-IL')}">${timeAgo(it.date)}</time>` : '';
    card.innerHTML = `
      ${cover}
      <h3 class="news-title"><a href="${it.link}" target="_blank" rel="noopener noreferrer">${it.headline||''}</a></h3>
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

// ---- load ----
async function loadNews(){
  setBusy(true);
  try{
    const res = await fetch(buildUrl(), { cache: 'no-store' });
    const data = await res.json();
    renderNews(Array.isArray(data)?data:(data.items||[]));
  }catch(e){
    console.error(e);
    if (feedEl) feedEl.innerHTML = `<p class="error">שגיאה בטעינת החדשות.</p>`;
  }finally{
    setBusy(false);
  }
}

// ---- wiring (supports both old and new HTML) ----
function wireFilters(){
  // New genre buttons
  safeForEach(qsa('[data-genre]'), btn=>{
    btn.addEventListener('click', ()=>{
      state.genre = (btn.getAttribute('data-genre')||'all').toLowerCase();
      setActiveButtons('nav[aria-label]', 'data-genre', state.genre);
      persistState(); loadNews();
    });
  });

  // New language buttons
  safeForEach(qsa('[data-lang]'), btn=>{
    btn.addEventListener('click', ()=>{
      state.lang = (btn.getAttribute('data-lang')||'ALL').toUpperCase();
      setActiveButtons('nav[aria-label]', 'data-lang', state.lang);
      persistState(); loadNews();
    });
  });

  // Legacy buttons (your original HTML with data-filter="HE|EN|all")
  safeForEach(qsa('[data-filter]'), btn=>{
    btn.addEventListener('click', ()=>{
      const v = (btn.getAttribute('data-filter')||'all').toUpperCase();
      if (v==='HE' || v==='EN'){ state.lang = v; }
      else { state.genre = 'all'; state.lang = 'ALL'; } // "הכול"
      qsa('[data-filter]').forEach(b=>{
        const active = b===btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active?'true':'false');
      });
      persistState(); loadNews();
    });
  });

  if (refreshBtn) refreshBtn.addEventListener('click', ()=>loadNews());
}

function restoreStateFromUrl(){
  const url = new URL(location.href);
  const genre = (url.searchParams.get('genre')||'all').toLowerCase();
  const lang  = (url.searchParams.get('lang') ||'ALL').toUpperCase();
  state.genre = ['all','electronic','hebrew'].includes(genre)?genre:'all';
  state.lang  = ['ALL','HE','EN'].includes(lang)?lang:'ALL';
  setActiveButtons('nav[aria-label]', 'data-genre', state.genre);
  setActiveButtons('nav[aria-label]', 'data-lang',  state.lang);
}

// ---- init ----
document.addEventListener('DOMContentLoaded', ()=>{
  restoreStateFromUrl();
  wireFilters();
  loadNews();
});
