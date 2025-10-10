/* ====== CONFIG ====== */
/** את זה תשנה ל-URL של ה-Aggregator שלך (ה-root מחזיר JSON של פריטים). אם אין — השאר "" ואז הדף יעבוד ב"מצב Spotify" אוטומטית. */
const AGG_ENDPOINT = "https://music-agrragator.dustrial.workers.dev/api/music"; // למשל: "https://music-aggregator.dustrial.workers.dev/"

/** Worker של Spotify */
const SPOTIFY_RELEASES_ENDPOINT = "https://spotify-new-releases.dustrial.workers.dev/api/spotify-releases";

/** תצוגה */
const MAX_ITEMS = 50;
const MAX_PER_SOURCE = 3;

/** חסימות */
const BLOCKED_SOURCES = ["al jazeera"].map(s => s.toLowerCase());
const BLOCKED_DOMAINS  = ["aljazeera.com"];

/** Debug strip (לתצוגת דיאגנוסטיקה בצד הלקוח) */
const DEBUG = false;

/* ====== STATE ====== */
let currentFilter = "all";
let isSpotifyMode = false;

/* ====== UTILS ====== */
const $  = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const escapeHtml = s => { if(!s) return ""; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; };
const safeUrl = href => { try{const u=new URL(href); return /^(https?):$/.test(u.protocol)?u.href:null;}catch{ return null; } };
const normLang = v => { const s=String(v||'').trim().toLowerCase(); if(!s) return 'EN'; if(s.startsWith('he')) return 'HE'; if(s.startsWith('en')) return 'EN'; return s.toUpperCase(); };
const rtfHE = new Intl.RelativeTimeFormat('he-IL',{numeric:'auto'});
const rtfEN = new Intl.RelativeTimeFormat('en-GB',{numeric:'auto'});
const dateToTs = s => {
  const v=String(s||'').trim(); if(!v) return NaN;
  if(/^\d{4}$/.test(v)) return Date.UTC(+v,11,31);
  if(/^\d{4}-\d{2}$/.test(v)){const [y,m]=v.split('-').map(Number); return Date.UTC(y,m-1,15);}
  const t=Date.parse(v); return isNaN(t)?NaN:t;
};
const formatDateByLang = (d,lang) => {
  const ts=dateToTs(d), date=isNaN(ts)?new Date():new Date(ts), now=new Date();
  const diff=date-now, s=Math.round(diff/1000), m=Math.round(s/60), h=Math.round(m/60), day=Math.round(h/24);
  const r=(lang==='HE'?rtfHE:rtfEN);
  if(Math.abs(s)<45) return r.format(0,'second');
  if(Math.abs(m)<45) return r.format(m,'minute');
  if(Math.abs(h)<22) return r.format(h,'hour');
  return r.format(day,'day');
};
const getParam = name => new URLSearchParams(location.search).get(name);
const pickImage = (images, target=160) =>
  Array.isArray(images)&&images.length
    ? ((images.reduce((b,im)=> Math.abs((im?.width||target)-target) < Math.abs((b?.width||target)-target) ? (im||b) : b))?.url || images[0]?.url || null)
    : null;
const isAllowed = it => {
  const src=String(it.source||'').toLowerCase();
  let host=''; try{host=new URL(it.link).hostname.replace(/^www\./,'').toLowerCase();}catch{}
  return !BLOCKED_SOURCES.some(b=>src.includes(b)) && !BLOCKED_DOMAINS.some(d=>host===d||host.endsWith('.'+d));
};
const setBusy = on => $("#newsFeed").setAttribute('aria-busy', on?'true':'false');

/* ====== RENDER ====== */
function showLoading(){
  setBusy(true);
  $("#newsFeed").innerHTML = `
    <div class="empty-state">
      <div class="spinner" role="status" aria-label="טוען"></div>
      <h3>טוען חדשות מוזיקה...</h3>
      <p>האוצרות האחרונים מהמקורות המובילים</p>
    </div>`;
}
function showError(msg, retry=true){
  setBusy(false);
  $("#newsFeed").innerHTML = `
    <div class="empty-state">
      <h3 class="error">אירעה שגיאה</h3>
      <p>${escapeHtml(String(msg).replace(/Spotify\s\d+\s/,'')||"שגיאה לא צפויה")}</p>
      ${retry?'<button class="retry-btn" onclick="location.reload()">נסה שוב</button>':''}
    </div>`;
}
function renderNews(items){
  setBusy(false);
  if (!items.length) {
    $("#newsFeed").innerHTML = `<div class="empty-state"><h3>לא נמצאו ידיעות כרגע</h3><p>נסה לבחור פילטר אחר</p></div>`;
    return;
  }
  $("#newsFeed").innerHTML = items.slice(0,MAX_ITEMS).map(card).join("");
}
function label(t,lang){
  const map = {Type:'סוג',Release:'תאריך יציאה',Label:'לייבל',Tracks:'מס׳ שירים'};
  return `<span class="meta-label">${escapeHtml(lang==='HE' ? map[t] : t+':')}</span>`;
}
const renderMeta = (m,lang) => !m ? "" : `<ul class="meta-list">${
  [m.type&&`${label('Type',lang)} ${escapeHtml(m.type)}`, m.release&&`${label('Release',lang)} ${escapeHtml(m.release)}`, m.label&&`${label('Label',lang)} ${escapeHtml(m.label)}`, (typeof m.tracks==="number")&&`${label('Tracks',lang)} ${m.tracks}`]
  .filter(Boolean).map(s=>`<li>${s}</li>`).join("")
}</ul>`;
const renderGenres = g => !Array.isArray(g)||!g.length ? "" : `<div class="genres">${g.slice(0,3).map(x=>`<span class="genre-tag">${escapeHtml(x)}</span>`).join('')}</div>`;
function card(story){
  const lang=normLang(story.language), src=escapeHtml(story.source||''), url=safeUrl(story.link), hasUrl=!!url;
  const title=escapeHtml(story.headline||''), summary=escapeHtml(story.summary||''), alt=escapeHtml(story.altText||story.headline||'Image');
  const ts=dateToTs(story.date||Date.now()), attr=(isNaN(ts)?new Date():new Date(ts)).toLocaleString(lang==='HE'?'he-IL':'en-GB');
  const isLTR=(lang==='EN')||(src.toLowerCase()==='spotify');
  const titleHtml=hasUrl?`<a href="${url}" target="_blank" rel="noopener noreferrer external">${title}</a>`:`<span class="no-link">${title}</span>`;
  const thumb = story.cover
    ? (hasUrl
        ? `<a class="news-thumb" href="${url}" target="_blank" rel="noopener noreferrer external">
             <img src="${escapeHtml(story.cover)}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer"/>
           </a>`
        : `<div class="news-thumb">
             <img src="${escapeHtml(story.cover)}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer"/>
           </div>`)
    : '';
  return `<article class="news-item ${isLTR?'ltr':''}" role="article">
    <div class="news-header">
      <div class="news-meta">
        <span class="language-badge">${escapeHtml(lang)}</span>
        <span class="source-tag">${src}</span>
      </div>
      <div class="news-date" title="${escapeHtml(attr)}">${formatDateByLang(story.date,lang)}</div>
    </div>
    <div class="news-body">
      ${thumb}
      <div class="news-main">
        <h2 class="news-title">${titleHtml}</h2>
        ${summary?`<p class="news-summary"><strong>${summary}</strong></p>`:""}
        ${renderGenres(story.genres)}
        ${renderMeta(story.meta,lang)}
      </div>
    </div>
  </article>`;
}

/* ====== AGGREGATOR ====== */
async function fetchJson(url, timeout=15000){
  const ctrl=new AbortController(); const to=setTimeout(()=>ctrl.abort(), timeout);
  try{
    const r = await fetch(url, { headers:{accept:"application/json"}, signal: ctrl.signal });
    const txt = await r.text().catch(()=> '');
    if (!r.ok) throw new Error(`${r.url.includes('spotify-releases')?'Spotify':'Agg'} ${r.status} ${txt.slice(0,200)}`);
    return txt ? JSON.parse(txt) : null;
  } finally { clearTimeout(to); }
}
async function fetchAgg(){
  if (!AGG_ENDPOINT) return [];
  const j = await fetchJson(AGG_ENDPOINT, 12000);
  const arr = Array.isArray(j) ? j : (Array.isArray(j?.items) ? j.items : []);
  return arr
    .filter(it => it && (it.headline || it.summary))
    .map(it => ({ ...it, altText: it.headline || 'News image' }));
}
function groupAndBalance(items){
  const clean = items.map(it => {
    const ts = isNaN(dateToTs(it.date)) ? Date.now() : dateToTs(it.date);
    return { ...it, _ts: ts };
  });
  const groups = new Map();
  for (const it of clean){
    const k = (it.source || 'Unknown').trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const balanced = [];
  for (const arr of groups.values()){
    const topN = arr.slice().sort((a,b)=> b._ts - a._ts).slice(0, MAX_PER_SOURCE);
    balanced.push(...topN);
  }
  const seen = new Set(), out = [];
  for (const it of balanced.sort((a,b)=> b._ts - a._ts)){
    const k = (it.link || '') + '|' + (it.headline || '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
const applyFilter = (items, lang) => lang==="all" ? items : items.filter(x=>normLang(x.language)===String(lang||'').toUpperCase());
function bindFilters(balanced){
  $$('.toolbar .btn[data-filter]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if (isSpotifyMode){
        const u=new URL(location.href); u.searchParams.delete('only'); u.searchParams.delete('mode'); location.replace(u.toString()); return;
      }
      currentFilter = btn.dataset.filter || 'all';
      updateActiveButtons();
      renderNews(applyFilter(balanced, currentFilter));
    });
  });
  updateActiveButtons();
}
function updateActiveButtons(){
  $$('.toolbar .btn[data-filter]').forEach(btn=>{
    const act = btn.dataset.filter===currentFilter || (currentFilter==="all"&&btn.dataset.filter==="all");
    btn.classList.toggle('active', act);
    btn.setAttribute('aria-pressed', String(act));
  });
}

/* ====== SPOTIFY ====== */
function albumsToNews(j){
  const arr = Array.isArray(j?.albums) ? j.albums : [];
  return arr.map(a => {
    const artists = Array.isArray(a.artists) ? a.artists.map(x=>x.name).join(", ") : "";
    const genres  = Array.isArray(a.genres) ? a.genres : (a.primary_genre ? [a.primary_genre] : []);
    return {
      source: "Spotify",
      link: a.url || null,
      headline: a.album_name || "Album",
      summary: artists ? `Artist: ${artists}` : "",
      date: a.release_date || "",
      language: "EN",
      cover: pickImage(a.images, 160),
      altText: `${a.album_name||'Album'}${artists?(' by '+artists):''}`,
      genres,
      meta: {
        type: a.album_type || null,
        label: a.label || null,
        tracks: Number.isFinite(a.total_tracks) ? a.total_tracks : null,
        release: a.release_date || null
      }
    };
  });
}
async function fetchSpotifySmart({ mode='curated', market='IL', monthsBack=2 } = {}){
  const tries = [
    { mode, market, monthsBack },
    { mode: 'extended', market, monthsBack },
    { mode: 'extended', market, monthsBack: 6 },
    { mode: 'extended', market: 'US', monthsBack: 6 },
  ];
  let lastDiag = null;

  for (const t of tries){
    const url = `${SPOTIFY_RELEASES_ENDPOINT}?${new URLSearchParams({
      mode: t.mode, market: t.market, monthsBack: String(t.monthsBack)
    })}`;
    try {
      const j = await fetchJson(url, 15000);
      lastDiag = {
        mode_requested: j?.mode_requested, mode: j?.mode || t.mode,
        market: j?.market || t.market, monthsBack: j?.monthsBack ?? t.monthsBack,
        total_fetched: j?.total_fetched, unique_before_enrich: j?.unique_before_enrich,
        after_filter: j?.after_filter, after_upc_dedupe: j?.after_upc_dedupe,
        source_counts: j?.source_counts, count: j?.count
      };
      if (j?.error) continue;
      const items = albumsToNews(j).filter(isAllowed);
      if (DEBUG) showDebug({ endpoint:url, diag:lastDiag, items: items.length });
      if (items.length > 0) return { items, diag:lastDiag };
      if ((j?.count ?? 0) > 0 && items.length === 0) lastDiag = { ...lastDiag, client_filtered_all: true };
    } catch { /* נמשיך לניסיון הבא */ }
  }
  return { items: [], diag: lastDiag };
}

/* ====== TOOLBAR: SPOTIFY MODE ====== */
$('#onlySpotifyBtn')?.addEventListener('click', ()=>{
  const u=new URL(location.href);
  if (u.searchParams.get('only')==='spotify'){ u.searchParams.delete('only'); u.searchParams.delete('mode'); }
  else { u.searchParams.set('only','spotify'); u.searchParams.set('mode',$('#spotifyMode').value||'curated'); }
  location.replace(u.toString());
});
$('#spotifyMode')?.addEventListener('change', e=>{
  const u=new URL(location.href); u.searchParams.set('mode', e.target.value); location.replace(u.toString());
});

/* ====== DEBUG STRIP ====== */
function ensureDebugStrip(){
  if (!DEBUG) return;
  if (!$('#debug-strip')) {
    const div = document.createElement('div');
    div.id = 'debug-strip';
    div.style.cssText = 'position:fixed;inset-inline:0;bottom:0;padding:8px 12px;background:rgba(0,0,0,.6);color:#0ff;font:12px/1.4 ui-monospace,monospace;z-index:9999;max-height:35vh;overflow:auto;direction:ltr;text-align:left;border-top:1px solid rgba(0,255,255,.25)';
    document.body.appendChild(div);
  }
}
function showDebug(obj){
  if (!DEBUG) return;
  ensureDebugStrip();
  $('#debug-strip').innerHTML = `<pre>${escapeHtml(JSON.stringify(obj, null, 2))}</pre>`;
}

/* ====== INIT ====== */
(async function init(){
  try{
    showLoading();

    const only = (getParam('only')==='spotify') || !AGG_ENDPOINT; // אם אין AGG — נעבור אוטומטית ל-Spotify
    const mode = (getParam('mode') || 'curated').toLowerCase();
    const market = (getParam('market') || 'IL').toUpperCase();
    const monthsBack = Math.max(1, Math.min(12, parseInt(getParam('months') || '2', 10)));

    isSpotifyMode = only;

    if (only){
      $('#modeSelector').hidden = false;
      $('#spotifyMode').value = (mode==='extended'?'extended':'curated');
      const spBtn = $('#onlySpotifyBtn'); spBtn.classList.add('active'); spBtn.setAttribute('aria-pressed','true');

      const { items, diag } = await fetchSpotifySmart({ mode, market, monthsBack });
      if (items.length > 0) {
        renderNews(items.slice(0, mode==='extended'?100:MAX_ITEMS));
      } else {
        const feed = $("#newsFeed");
        const pretty = (obj) => escapeHtml(JSON.stringify(obj || {}, null, 2));
        const tips = [
          'נסה לעבור ל־"מורחב" (extended)',
          'נסה להגדיל ל־monthsBack=6',
          'נסה market=US לבדיקת זמינות כללית',
        ];
        feed.innerHTML = `
          <div class="empty-state">
            <h3>לא נמצאו ידיעות כרגע</h3>
            <p>ניסינו כמה אפשרויות ולא נמצאו פריטים להצגה.</p>
            ${DEBUG ? `<pre style="text-align:left;direction:ltr;overflow:auto;max-height:220px;border:1px solid rgba(255,255,255,0.1);padding:12px;border-radius:8px;background:rgba(255,255,255,0.04)">${pretty(diag)}</pre>` : ''}
            <p style="margin-top:8px">${tips.map(t=>`• ${escapeHtml(t)}`).join('<br>')}</p>
            <button class="retry-btn" onclick="location.search='?only=spotify&mode=extended'">עבור למורחב</button>
            <button class="retry-btn" onclick="location.search='?only=spotify&mode=extended&months=6'">מורחב + 6 חודשים</button>
          </div>`;
        setBusy(false);
      }

      // לחיצה על פילטר מוציאה ממצב Spotify
      $$('.toolbar .btn[data-filter]').forEach(btn=> btn.addEventListener('click', ()=>{
        const u=new URL(location.href); u.searchParams.delete('only'); u.searchParams.delete('mode'); location.replace(u.toString());
      }));

    } else {
      // מצב אגרגטור (רגיל)
      const agg = await fetchAgg();
      const balanced = groupAndBalance(agg);
      bindFilters(balanced);
      renderNews(applyFilter(balanced, currentFilter));
    }

  } catch(e){
    showError(e.message||e);
    if (DEBUG) showDebug({ error: String(e) });
    console.error(e);
  }
})();



