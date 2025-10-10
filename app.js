/* ====== CONFIG ====== */
/* החלף לכתובת ה־Worker שלך */
const AGG_ENDPOINT = "https://music-agrragator.dustrial.workers.dev/api/music";
/* כמה קלפים להציג */
const MAX_ITEMS = 80;

/* ====== STATE ====== */
let currentFilter = (getParam('lang') || 'all').toUpperCase();

/* ====== UTILS ====== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function getParam(name){ return new URLSearchParams(location.search).get(name); }
function escapeHtml(s){ if(!s) return ""; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }
function safeUrl(href){ try{ const u=new URL(href); return /^(https?):$/.test(u.protocol)?u.href:null; } catch { return null; } }
function normLang(v){ const s=String(v||'').trim().toUpperCase(); return (s==='HE'||s==='EN')?s:'EN'; }

const rtfHE = new Intl.RelativeTimeFormat('he-IL',{numeric:'auto'});
const rtfEN = new Intl.RelativeTimeFormat('en-GB',{numeric:'auto'});
function toTs(s){ const t=Date.parse(s||''); return isNaN(t)?Date.now():t; }
function relDate(date, lang){
  const d = new Date(toTs(date)), now = new Date();
  const diffMs = d - now, s = Math.round(diffMs/1000), m=Math.round(s/60), h=Math.round(m/60), day=Math.round(h/24);
  const rtf = (lang==='HE')?rtfHE:rtfEN;
  if (Math.abs(s)<45) return rtf.format(0,'second');
  if (Math.abs(m)<45) return rtf.format(m,'minute');
  if (Math.abs(h)<22) return rtf.format(h,'hour');
  return rtf.format(day,'day');
}

function showLoading(){
  const feed = $('#newsFeed'); feed.setAttribute('aria-busy', 'true');
  feed.innerHTML = `<div class="empty-state"><div class="spinner" role="status" aria-label="טוען"></div><h3>טוען חדשות...</h3><p>מרענן מקורות</p></div>`;
}
function showError(message){
  const feed = $('#newsFeed'); feed.setAttribute('aria-busy', 'false');
  feed.innerHTML = `<div class="empty-state"><h3 class="error">אירעה שגיאה</h3><p>${escapeHtml(message||'שגיאה לא צפויה')}</p><button class="btn ghost" onclick="location.reload()">נסה שוב</button></div>`;
}
function render(items){
  const feed = $('#newsFeed'); feed.setAttribute('aria-busy','false');
  if (!items.length){
    feed.innerHTML = `<div class="empty-state"><h3>לא נמצאו ידיעות כרגע</h3><p>נסה לבחור פילטר אחר או לרענן</p></div>`;
    return;
  }
  feed.innerHTML = items.slice(0, MAX_ITEMS).map(card).join('');
}
function updateActiveButtons(){
  $$('.toolbar .btn[data-filter]').forEach(btn=>{
    const active = (btn.dataset.filter||'all').toUpperCase() === currentFilter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function pickImageFromSummary(summary=""){
  const m = summary.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function card(it){
  const lang = normLang(it.language);
  const src  = escapeHtml(it.source || '');
  const url  = safeUrl(it.link);
  const title= escapeHtml(it.headline || '');
  const sum  = escapeHtml((it.summary || '').replace(/<[^>]+>/g,' ').trim());
  const cover= it.cover || pickImageFromSummary(it.summary) || null;
  const isLTR = (lang === 'EN');

  const altDate = new Date(toTs(it.date)).toLocaleString(lang==='HE'?'he-IL':'en-GB');
  const linkHtml = url ? `<a href="${url}" target="_blank" rel="noopener noreferrer external">${title}</a>` : `<span>${title}</span>`;
  const imgHtml  = cover ? `<a class="news-thumb" href="${url||'#'}" ${url?`target="_blank" rel="noopener noreferrer external"`:""} aria-label="פתח"><img src="${escapeHtml(cover)}" alt="${title}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>` : '';

  return `
  <article class="news-item ${isLTR?'ltr':''}" role="article">
    <div class="news-header">
      <div class="news-meta">
        <span class="language-badge">${lang}</span>
        <span class="source-tag">${src}</span>
      </div>
      <div class="news-date" title="${escapeHtml(altDate)}">${relDate(it.date, lang)}</div>
    </div>
    <div class="news-body">
      ${imgHtml}
      <div class="news-main">
        <h2 class="news-title">${linkHtml}</h2>
        ${sum ? `<p class="news-summary">${sum}</p>` : ``}
      </div>
    </div>
  </article>`;
}

/* ====== DATA ====== */
async function fetchAgg(timeoutMs=15000){
  const ctrl = new AbortController();
  const to   = setTimeout(()=>ctrl.abort(new Error('Timeout')), timeoutMs);
  try{
    const r = await fetch(AGG_ENDPOINT, { headers:{accept:"application/json"}, signal: ctrl.signal, cache:'no-cache' });
    if (!r.ok) throw new Error(`Aggregator ${r.status}`);
    const j = await r.json();
    // תומך גם במבנה דיאגנוסטיקה (items + diag)
    const arr = Array.isArray(j) ? j : (Array.isArray(j?.items) ? j.items : []);
    return normalize(arr);
  } finally {
    clearTimeout(to);
  }
}
function normalize(arr){
  // סינונים בסיסיים + דה-דופ לפי link
  const dedup = new Map();
  for (const it of arr){
    const link = safeUrl(it.link);
    if (!link || (!it.headline && !it.summary)) continue;
    if (!dedup.has(link)) dedup.set(link, it);
  }
  return [...dedup.values()].sort((a,b)=>toTs(b.date)-toTs(a.date));
}
function applyFilter(items, lang){
  if (lang === 'all') return items;
  return items.filter(x => normLang(x.language) === lang);
}

/* ====== INIT ====== */
(function init(){
  showLoading();

  // חיבור כפתורי פילטר
  $$('.toolbar .btn[data-filter]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      currentFilter = (btn.dataset.filter || 'all').toUpperCase();
      updateActiveButtons();
      // נבצע רנדר מחדש על הקאש המקומי (אם נטען כבר)
      if (window.__DATA__) render(applyFilter(window.__DATA__, currentFilter));
    });
  });
  updateActiveButtons();

  // רענון
  $('#refreshBtn').addEventListener('click', ()=> location.reload());

  // שליפה
  fetchAgg()
    .then(items => { window.__DATA__ = items; render(applyFilter(items, currentFilter)); })
    .catch(err  => { showError(err.message || String(err)); console.error(err); });
})();

