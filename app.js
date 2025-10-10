/* === CONFIG (שנה רק אם צריך) === */
const SPOTIFY_RELEASES_ENDPOINT =
  "https://spotify-new-releases.dustrial.workers.dev/api/spotify-releases";

/* אם בכלל אין לך אגרגטור — השאר "" כדי שניכנס ישר ל-Spotify */
const AGG_ENDPOINT = "";

/* תצוגה */
const MAX_ITEMS = 50;

/* דיבאג מהיר: אם true נראה פס דיבאג למעלה */
const DEBUG = true;

/* === UTIL === */
const $ = s => document.querySelector(s);
const escapeHtml = s => { const d=document.createElement('div'); d.textContent=String(s??""); return d.innerHTML; };
const safeUrl = href => { try{const u=new URL(href); return /^(https?):$/.test(u.protocol)?u.href:null;}catch{ return null; } };
const dateToTs = s => {
  const v=String(s||'').trim();
  if(!v) return NaN;
  if(/^\d{4}$/.test(v)) return Date.UTC(+v,11,31);
  if(/^\d{4}-\d{2}$/.test(v)){const [y,m]=v.split('-').map(Number); return Date.UTC(y,m-1,15);}
  const t=Date.parse(v); return isNaN(t)?NaN:t;
};
const rtfHE = new Intl.RelativeTimeFormat('he-IL',{numeric:'auto'});
const rtfEN = new Intl.RelativeTimeFormat('en-GB',{numeric:'auto'});
const normLang = v => v && v.toLowerCase().startsWith('he') ? 'HE' : 'EN';
const formatDateByLang = (d,lang) => {
  const ts=dateToTs(d), date=isNaN(ts)?new Date():new Date(ts), now=new Date();
  const diff=date-now, s=Math.round(diff/1000), m=Math.round(s/60), h=Math.round(m/60), day=Math.round(h/24);
  const r=lang==='HE'?rtfHE:rtfEN;
  if(Math.abs(s)<45)return r.format(0,'second');
  if(Math.abs(m)<45)return r.format(m,'minute');
  if(Math.abs(h)<22)return r.format(h,'hour');
  return r.format(day,'day');
};

/* === RENDER === */
function showLoading(){
  $("#newsFeed").setAttribute('aria-busy','true');
  $("#newsFeed").innerHTML =
    `<div class="empty-state">
       <div class="spinner" role="status" aria-label="טוען"></div>
       <h3>טוען חדשות מוזיקה...</h3>
       <p>האוצרות האחרונים מ-Spotify</p>
     </div>`;
}
function showError(msg){
  $("#newsFeed").setAttribute('aria-busy','false');
  $("#newsFeed").innerHTML =
    `<div class="empty-state">
       <h3 class="error">אירעה שגיאה</h3>
       <p>${escapeHtml(msg || "שגיאה לא צפויה")}</p>
       <button class="retry-btn" onclick="location.reload()">נסה שוב</button>
     </div>`;
}
function renderNews(items){
  $("#newsFeed").setAttribute('aria-busy','false');
  if (!items.length){
    $("#newsFeed").innerHTML =
      `<div class="empty-state">
         <h3>לא נמצאו ידיעות כרגע</h3>
         <p>נסה לעבור ל-extended או להגדיל טווח חודשים</p>
       </div>`;
    return;
  }
  $("#newsFeed").innerHTML = items.slice(0,MAX_ITEMS).map(card).join("");
}
function card(story){
  const lang = normLang(story.language);
  const src  = escapeHtml(story.source||'Spotify');
  const url  = safeUrl(story.link);
  const title= escapeHtml(story.headline||'Album');
  const summary = story.summary ? `<p class="news-summary"><strong>${escapeHtml(story.summary)}</strong></p>` : "";
  const alt = escapeHtml(story.altText||title);
  const ts = dateToTs(story.date||Date.now());
  const dateAttr = (isNaN(ts)?new Date():new Date(ts)).toLocaleString(lang==='HE'?'he-IL':'en-GB');
  const isLTR = true; // פריטי Spotify באנגלית
  const titleHtml = url ? `<a href="${url}" target="_blank" rel="noopener noreferrer external">${title}</a>`
                        : `<span class="no-link">${title}</span>`;
  const genres = Array.isArray(story.genres)? story.genres.slice(0,3).map(g=>`<span class="genre-tag">${escapeHtml(g)}</span>`).join('') : "";
  const meta = story.meta || {};
  const metaHtml = `<ul class="meta-list">
    ${meta.type?`<li><span class="meta-label">${lang==='HE'?'סוג:':'Type:'}</span> ${escapeHtml(meta.type)}</li>`:""}
    ${meta.release?`<li><span class="meta-label">${lang==='HE'?'תאריך יציאה:':'Release:'}</span> ${escapeHtml(meta.release)}</li>`:""}
    ${meta.label?`<li><span class="meta-label">${lang==='HE'?'לייבל:':'Label:'}</span> ${escapeHtml(meta.label)}</li>`:""}
    ${Number.isFinite(meta.tracks)?`<li><span class="meta-label">${lang==='HE'?'מס׳ שירים:':'Tracks:'}</span> ${meta.tracks}</li>`:""}
  </ul>`;
  const thumb = story.cover
    ? (url
        ? `<a class="news-thumb" href="${url}" target="_blank" rel="noopener noreferrer external">
             <img src="${escapeHtml(story.cover)}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer"/>
           </a>`
        : `<div class="news-thumb"><img src="${escapeHtml(story.cover)}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer"/></div>`)
    : "";

  return `
  <article class="news-item ${isLTR?'ltr':''}" role="article">
    <div class="news-header">
      <div class="news-meta"><span class="language-badge">EN</span><span class="source-tag">${src}</span></div>
      <div class="news-date" title="${escapeHtml(dateAttr)}">${formatDateByLang(story.date,'EN')}</div>
    </div>
    <div class="news-body">
      ${thumb}
      <div class="news-main">
        <h2 class="news-title">${titleHtml}</h2>
        ${summary}
        ${genres?`<div class="genres">${genres}</div>`:""}
        ${metaHtml}
      </div>
    </div>
  </article>`;
}

/* === MAP FROM WORKER === */
function albumsToNews(j){
  const arr = Array.isArray(j?.albums) ? j.albums : [];
  return arr.map(a => {
    const artists = Array.isArray(a.artists) ? a.artists.map(x=>x.name).join(", ") : "";
    const cover = Array.isArray(a.images) && a.images.length ? (a.images[0].url || null) : null;
    const genres = Array.isArray(a.genres) ? a.genres : (a.primary_genre ? [a.primary_genre] : []);
    return {
      source: "Spotify",
      link: a.url || null,
      headline: a.album_name || "Album",
      summary: artists ? `Artist: ${artists}` : "",
      date: a.release_date || "",
      language: "EN",
      cover,
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

/* === NETWORK === */
async function fetchJson(url, timeout=15000){
  const ctrl=new AbortController(); const to=setTimeout(()=>ctrl.abort(), timeout);
  try{
    const r = await fetch(url, { headers:{accept:"application/json"}, signal: ctrl.signal });
    if (!r.ok) {
      const txt = await r.text().catch(()=> "");
      throw new Error(`${r.status} ${txt.slice(0,180)}`);
    }
    return await r.json();
  } finally { clearTimeout(to); }
}

async function fetchSpotify(mode='curated', market='IL', monthsBack=2){
  const params = new URLSearchParams({ mode, market, monthsBack:String(monthsBack) });
  const url = `${SPOTIFY_RELEASES_ENDPOINT}?${params.toString()}`;
  const j = await fetchJson(url, 15000);
  // אם השרת מחזיר count/diagnostics – נשים בפס דיבאג
  if (DEBUG) {
    showDebug({
      endpoint: url,
      count: j?.count,
      total_fetched: j?.total_fetched,
      after_filter: j?.after_filter,
      after_upc_dedupe: j?.after_upc_dedupe,
      market: j?.market,
      mode: j?.mode
    });
  }
  return albumsToNews(j);
}

/* === DEBUG STRIP === */
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
  const div = $('#debug-strip');
  div.innerHTML = `<pre>${escapeHtml(JSON.stringify(obj, null, 2))}</pre>`;
}

/* === INIT (פשוט ועובד) === */
(async function init(){
  try{
    showLoading();

    // פרמטרים מה-URL (אופציונלי)
    const urlMode = (new URLSearchParams(location.search).get('mode') || 'curated').toLowerCase();
    const mode = (urlMode === 'extended' ? 'extended' : 'curated');
    const market = (new URLSearchParams(location.search).get('market') || 'IL').toUpperCase();
    const months = Math.max(1, Math.min(12, parseInt(new URLSearchParams(location.search).get('months') || '2', 10)));

    // קודם כל — ננסה את מה שביקשת
    let items = await fetchSpotify(mode, market, months);

    // אם ריק — ננסה fallback-ים עדינים בלבד
    if (!items.length && mode === 'curated') {
      items = await fetchSpotify('extended', market, months);
    }
    if (!items.length && months < 6) {
      items = await fetchSpotify('extended', market, 6);
    }
    if (!items.length && market !== 'US') {
      items = await fetchSpotify('extended', 'US', 6);
    }

    // רינדור
    renderNews(items);

  } catch (e) {
    showError(e.message || e);
    if (DEBUG) showDebug({ error: String(e) });
    console.error(e);
  }
})();
