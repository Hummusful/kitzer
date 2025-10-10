/* ====== CONFIG ====== */
const AGG_ENDPOINT = "https://music-aggregator.dustrial.workers.dev/"; // תקן ל-URL האמיתי שלך; אם אין אגרגטור כרגע – אפשר "".
const SPOTIFY_RELEASES_ENDPOINT = "https://spotify-new-releases.dustrial.workers.dev/api/spotify-releases";
const MAX_ITEMS = 50, MAX_PER_SOURCE = 3;
const BLOCKED_SOURCES = ["al jazeera"].map(s=>s.toLowerCase());
const BLOCKED_DOMAINS  = ["aljazeera.com"];

/* ====== STATE ====== */
let currentFilter = "all", isSpotifyMode = false;

/* ====== UTILS ====== */
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const escapeHtml = s => { if(!s) return ""; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; };
const safeUrl = href => { try{const u=new URL(href); return /^(https?):$/.test(u.protocol)?u.href:null;}catch{ return null; } };
const normLang = v => { const s=String(v||'').trim().toLowerCase(); if(!s) return 'EN'; if(s.startsWith('he')) return 'HE'; if(s.startsWith('en')) return 'EN'; return s.toUpperCase(); };
const rtfHE = new Intl.RelativeTimeFormat('he-IL',{numeric:'auto'});
const rtfEN = new Intl.RelativeTimeFormat('en-GB',{numeric:'auto'});
const dateToTs = s => { const v=String(s||'').trim(); if(!v) return NaN; if(/^\d{4}$/.test(v)) return Date.UTC(+v,11,31); if(/^\d{4}-\d{2}$/.test(v)){const [y,m]=v.split('-').map(Number); return Date.UTC(y,m-1,15);} const t=Date.parse(v); return isNaN(t)?NaN:t; };
const formatDateByLang = (d,lang) => { const ts=dateToTs(d), date=isNaN(ts)?new Date():new Date(ts), now=new Date(); const diff=date-now, s=Math.round(diff/1000), m=Math.round(s/60), h=Math.round(m/60), day=Math.round(h/24), r=(lang==='HE'?rtfHE:rtfEN); if(Math.abs(s)<45)return r.format(0,'second'); if(Math.abs(m)<45)return r.format(m,'minute'); if(Math.abs(h)<22)return r.format(h,'hour'); return r.format(day,'day'); };
const getParam = name => new URLSearchParams(location.search).get(name);
const pickImage = (images, target=160) => Array.isArray(images)&&images.length ? (images.reduce((b,im)=> Math.abs((im?.width||target)-target) < Math.abs((b?.width||target)-target) ? (im||b) : b))?.url || images[0]?.url || null : null;
const isAllowed = it => { const src=String(it.source||'').toLowerCase(); let host=''; try{host=new URL(it.link).hostname.replace(/^www\./,'').toLowerCase();}catch{} return !BLOCKED_SOURCES.some(b=>src.includes(b)) && !BLOCKED_DOMAINS.some(d=>host===d||host.endsWith('.'+d)); };
const setBusy = on => $("#newsFeed").setAttribute('aria-busy', on?'true':'false');

/* ====== MAPPERS ====== */
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
      altText: `${a.album_name}${artists?(' by '+artists):''}`,
      genres,
      meta: {
        type:a.album_type||null,
        label:a.label||null,
        tracks:Number.isFinite(a.total_tracks)?a.total_tracks:null,
        release:a.release_date||null
      }
    };
  });
}

/* ====== FETCH with TIMEOUT ====== */
async function fetchJson(url, timeout=15000){
  const ctrl=new AbortController(); const to=setTimeout(()=>ctrl.abort(), timeout);
  try{
    const r = await fetch(url, { headers:{accept:"application/json"}, signal: ctrl.signal });
    const body = await r.text().catch(()=> '');
    if (!r.ok) throw new Error(`${r.url.includes('spotify-releases')?'Spotify':'Agg'} ${r.status} ${body.slice(0,200)}`);
    return body ? JSON.parse(body) : null;
  } finally { clearTimeout(to); }
}

const fetchAgg = async () => {
  if (!AGG_ENDPOINT) return []; // אם אין אגרגטור – נחזיר ריק
  const j = await fetchJson(AGG_ENDPOINT, 10000);
  const arr = Array.isArray(j) ? j : (Array.isArray(j?.items) ? j.items : []);
  return arr.filter(isAllowed).map(x=>({...x,altText:x.headline||'News image'}));
};

/* ====== SMART SPOTIFY FETCH (fallbacks) ====== */
async function fetchSpotifySmart({ mode='curated', market='IL', monthsBack=2 } = {}) {
  const attempts = [
    { mode, market, monthsBack },
    { mode: 'extended', market, monthsBack },
    { mode: 'extended', market, monthsBack: 6 },
    { mode: 'extended', market: 'US', monthsBack: 6 },
  ];
  let lastDiag = null;

  for (const a of attempts) {
    const url = `${SPOTIFY_RELEASES_ENDPOINT}?${new URLSearchParams({
      mode: a.mode, market: a.market, monthsBack: String(a.monthsBack)
    })}`;
    try {
      const j = await fetchJson(url, 15000);
      lastDiag = {
        mode_requested: j?.mode_requested,
        mode_effective: j?.mode || a.mode,
        market: j?.market || a.market,
        monthsBack: j?.monthsBack ?? a.monthsBack,
        total_fetched: j?.total_fetched,
        unique_before_enrich: j?.unique_before_enrich,
        after_filter: j?.after_filter,
        after_upc_dedupe: j?.after_upc_dedupe,
        source_counts: j?.source_counts,
        count: j?.count
      };
      if (j?.error) continue;
      const items = albumsToNews(j).filter(isAllowed);
      if (items.length > 0) return { items, diag: lastDiag };
      if ((j?.count ?? 0) > 0 && items.length === 0) {
        lastDiag = { ...lastDiag, client_filtered_all: true };
      }
    } catch { continue; }
  }
  return { items: [], diag: lastDiag };
}

/* ====== GROUP & BALANCE (מרוכך) ====== */
function groupAndBalance(items){
  // לא מפילים כרטיסים על חוסר לינק/תאריך – רק דורשים טקסט
  const clean = items
    .map(it => {
      const hasText = Boolean(it.headline || it.summary);
      if (!hasText) return null;
      let ts = dateToTs(it.date);
      if (isNaN(ts)) ts = Date.now();      // fallback לתאריך היום
      const url = safeUrl(it.link) || null; // מותר גם בלי לינק; ה-card כבר תומך no-link
      return { ...it, _ts: ts, link: url || it.link || null };
    })
    .filter(Boolean);

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
    const k = safeUrl(it.link) || it.headline;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

const applyFilter = (items, lang) => lang==="all" ? items : items.filter(x=>normLang(x.language)===String(lang||'').toUpperCase());

/* ====== RENDER ====== */
const renderMeta = (m,lang) => !m ? "" : `<ul class="meta-list">${
  [m.type&&`${label('Type',lang)} ${escapeHtml(m.type)}`, m.release&&`${label('Release',lang)} ${escapeHtml(m.release)}`, m.label&&`${label('Label',lang)} ${escapeHtml(m.label)}`, (typeof m.tracks==="number")&&`${label('Tracks',lang)} ${m.tracks}`]
  .filter(Boolean).map(s=>`<li>${s}</li>`).join("")
}</ul>`;
const label = (t,lang) => `<span class="meta-label">${escapeHtml(lang==='HE'?({Type:'סוג',Release:'תאריך יציאה',Label:'לייבל',Tracks:'מס׳ שירים'}[t]):t+':')}</span>`;
const renderGenres = g => !Array.isArray(g)||!g.length ? "" : `<div class="genres">${g.slice(0,3).map(x=>`<span class="genre-tag">${escapeHtml(x)}</span>`).join('')}</div>`;
function card(story){
  const lang=normLang(story.language), src=escapeHtml(story.source||''), url=safeUrl(story.link), hasUrl=!!url;
  const title=escapeHtml(story.headline||''), summary=escapeHtml(story.summary||''), alt=escapeHtml(story.altText||story.headline||'Image');
  const ts=dateToTs(story.date||Date.now()), attr=(isNaN(ts)?new Date():new Date(ts)).toLocaleString(lang==='HE'?'he-IL':'en-GB');
  const isLTR=(lang==='EN')||(src.toLowerCase()==='spotify');
  const titleHtml=hasUrl?`<a href="${url}" target="_blank" rel="noopener noreferrer external">${title}</a>`:`<span class="no-link">${title}</span>`;
  const thumb = story.cover ? (hasUrl?`<a class="news-thumb" href="${url}" target="_blank" rel="noopener noreferrer external"><img src="${escapeHtml(story.cover)}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer"/></a>`:`<div class="news-thumb"><img src="${escapeHtml(story.cover)}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer"/></div>`) : '';
  return `<article class="news-item ${isLTR?'ltr':''}" role="article">
    <div class="news-header">
      <div class="news-meta"><span class="language-badge">${escapeHtml(lang)}</span><span class="source-tag">${src}</span></div>
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
function showLoading(){ setBusy(true); $("#newsFeed").innerHTML = `<div class="empty-state"><div class="spinner" role="status" aria-label="טוען"></div><h3>טוען חדשות מוזיקה...</h3><p>האוצרות האחרונים מהמקורות המובילים</p></div>`; }
function showError(msg, retry=true){ setBusy(false); $("#newsFeed").innerHTML = `<div class="empty-state"><h3 class="error">אירעה שגיאה</h3><p>${escapeHtml(String(msg).replace(/Spotify\s\d+\s/,'')||"שגיאה לא צפויה")}</p>${retry?'<button class="retry-btn" onclick="location.reload()">נסה שוב</button>':''}</div>`; }
function renderNews(items){ setBusy(false); $("#newsFeed").innerHTML = items.length ? items.slice(0,MAX_ITEMS).map(card).join("") : `<div class="empty-state"><h3>לא נמצאו ידיעות כרגע</h3><p>נסה לבחור פילטר אחר</p></div>`; }

/* ====== FILTER BUTTONS ====== */
function bindFilters(balanced){
  $$('.toolbar .btn[data-filter]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if (isSpotifyMode){ const u=new URL(location.href); u.searchParams.delete('only'); u.searchParams.delete('mode'); location.replace(u.toString()); return; }
      currentFilter = btn.dataset.filter || 'all';
      updateActive();
      renderNews(applyFilter(balanced, currentFilter));
    });
  });
  updateActive();
}
function updateActive(){ $$('.toolbar .btn[data-filter]').forEach(btn=>{ const act = btn.dataset.filter===currentFilter || (currentFilter==="all"&&btn.dataset.filter==="all"); btn.classList.toggle('active',act); btn.setAttribute('aria-pressed', String(act)); }); }

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

/* ====== INIT ====== */
(async function init(){
  try{
    // אם אין AGG פעיל – נכריח מצב Spotify כדי שלא ייראה ריק
    const only = (getParam('only')==='spotify') || !AGG_ENDPOINT;
    const mode = getParam('mode') || 'curated';
    const market = (getParam('market') || 'IL').toUpperCase();
    const monthsBack = Math.max(1, Math.min(12, parseInt(getParam('months') || '2', 10)));

    isSpotifyMode = only;
    showLoading();

    if (only){
      $('#modeSelector').hidden = false;
      $('#spotifyMode').value = mode;
      const spBtn = $('#onlySpotifyBtn'); spBtn.classList.add('active'); spBtn.setAttribute('aria-pressed','true');

      const { items, diag } = await fetchSpotifySmart({ mode, market, monthsBack });
      if (items.length > 0) {
        renderNews(items.slice(0, mode==='extended'?100:MAX_ITEMS));
      } else {
        // הצג דיאגנוסטיקה – עוזר להבין למה ריק (מה ה-Worker באמת מחזיר)
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
            <pre style="text-align:left;direction:ltr;overflow:auto;max-height:220px;border:1px solid rgba(255,255,255,0.1);padding:12px;border-radius:8px;background:rgba(255,255,255,0.04)">${pretty(diag)}</pre>
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
      $('#modeSelector').hidden = true;
      const agg = await fetchAgg();
      const balanced = groupAndBalance(agg);
      bindFilters(balanced);
      renderNews(applyFilter(balanced, currentFilter));
    }
  } catch(e){ showError(e.message||e); console.error(e); }
})();
