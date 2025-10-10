/* ====== CONFIG ====== */
/* חשוב: הנתיב המדויק של ה־Worker שלך */
const AGG_ENDPOINT = "https://music-aggregator.dustrial.workers.dev/api/music";
/* כמות מקסימלית לתצוגה */
const MAX_ITEMS = 80;
/* הפעלת debug: הוסף ?debug=1 לכתובת הדף */
const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

/* כמה ימים אחורה להציג בפיד (HE/EN כללי; ניתן לשנות) */
const MAX_AGE_DAYS = 30;
/* מעבר לתאריך מוחלט (במקום יחסי) אחרי: */
const ABSOLUTE_AFTER_DAYS = 14;
/* אם התאריך "בעתיד" ביותר מ-36 שעות — נציג תאריך מוחלט */
const FUTURE_HARD_LIMIT_HOURS = 36;

/* ====== STATE ====== */
function normalizeFilter(v){ 
  const s = String(v||'').trim().toUpperCase();
  return (s==='HE'||s==='EN') ? s : 'all';
}
let currentFilter = normalizeFilter(getParam('lang'));
let __DATA__ = null;

/* ====== UTILS ====== */
const $  = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const log = (...a) => DEBUG && console.log("[app]", ...a);

function hostFromUrl(href){ 
  try { 
    return new URL(href).hostname.replace(/^www\./,''); 
  } catch { 
    return ''; 
  } 
}

function getParam(name){ return new URLSearchParams(location.search).get(name); }

/* ניקוי ישויות HTML + דחיסת רווחים */
function escapeHtml(s){
  if(!s) return "";
  let t = String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

function safeUrl(href){
  try{
    const u = new URL(href);
    return /^(https?):$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
}

function sanitizeImg(url){
  if (!url) return null;
  return String(url)
    .replace(/^\/\//, 'https://')     // //cdn → https://cdn
    .replace(/^http:\/\//, 'https://'); // upgrade http→https
}

function normLang(v){
  const s = String(v||'').trim().toUpperCase();
  return (s==='HE'||s==='EN') ? s : 'EN';
}

const rtfHE = new Intl.RelativeTimeFormat('he-IL',{numeric:'auto'});
const rtfEN = new Intl.RelativeTimeFormat('en-GB',{numeric:'auto'});

function toTs(s){
  // תומך גם ב-null/undefined
  const t = Date.parse(s || '');
  return isNaN(t) ? 0 : t;
}

/* תצוגת זמן היברידית: יחסי עד 14 יום, אחרת תאריך מוחלט */
function relDate(date, lang){
  const ts = toTs(date);
  if (!ts) return (lang==='HE') ? "ללא תאריך" : "No date";

  const now = Date.now();
  const diff = ts - now; // שלילי = עבר, חיובי = עתיד
  const absMs = Math.abs(diff);
  const absDays = absMs / (24*60*60*1000);

  if (absDays > ABSOLUTE_AFTER_DAYS || (diff > FUTURE_HARD_LIMIT_HOURS*60*60*1000)) {
    return new Date(ts).toLocaleDateString(lang==='HE'?'he-IL':'en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  const rtf = (lang==='HE')?rtfHE:rtfEN;
  const s = Math.round(diff/1000), m=Math.round(s/60), h=Math.round(m/60), d=Math.round(h/24);
  if (Math.abs(s)<45) return rtf.format(0,'second');
  if (Math.abs(m)<45) return rtf.format(m,'minute');
  if (Math.abs(h)<22) return rtf.format(h,'hour');
  return rtf.format(d,'day');
}

function showLoading(){
  const feed = $('#newsFeed'); feed.setAttribute('aria-busy', 'true');
  feed.innerHTML = `<div class="empty-state"><div class="spinner" role="status" aria-label="טוען"></div><h3>טוען חדשות...</h3><p>מרענן מקורות</p></div>`;
}

function showError(message, diagHtml = ""){
  const feed = $('#newsFeed'); feed.setAttribute('aria-busy', 'false');
  feed.innerHTML = `
    <div class="empty-state">
      <h3 class="error">אירעה שגיאה</h3>
      <p>${escapeHtml(message||'שגיאה לא צפויה')}</p>
      ${diagHtml}
      <button class="retry-btn" onclick="location.reload()">נסה שוב</button>
    </div>`;
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
    const val = (btn.dataset.filter || 'all');
    const active = (val === 'all' && currentFilter === 'all') ||
                   (val.toUpperCase() === currentFilter);
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
  const src  = escapeHtml(it.source || hostFromUrl(it.link) || 'News');
  const url  = safeUrl(it.link);
  const title= escapeHtml(it.headline || '');
  const rawSummary = String(it.summary || '').replace(/&nbsp;/gi, ' ');
  const cleanSummary = escapeHtml(rawSummary.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
  const cover= sanitizeImg(it.cover || pickImageFromSummary(rawSummary) || null);
  const isLTR = (lang === 'EN');

  const ts = toTs(it.date);
  const altDate = ts ? new Date(ts).toLocaleString(lang==='HE'?'he-IL':'en-GB') : (lang==='HE'?'ללא תאריך':'No date');
  const linkHtml = url ? `<a href="${url}" target="_blank" rel="noopener noreferrer external">${title}</a>` : `<span>${title}</span>`;
  const imgHtml  = cover ? `
    <a class="news-thumb" href="${url||'#'}" ${url?`target="_blank" rel="noopener noreferrer external"`:""} aria-label="פתח">
      <img src="${escapeHtml(cover)}" alt="${title}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('.news-thumb')?.remove()">
    </a>` : '';

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
        ${cleanSummary ? `<p class="news-summary">${cleanSummary}</p>` : ``}
      </div>
    </div>
  </article>`;
}

/* ====== DATA ====== */
async function fetchAgg(timeoutMs=15000){
  const endpoint = new URL(AGG_ENDPOINT);
  // אם debug מופעל – נבקש גם diag מהשרת כדי להציג מונה פר־מקור
  if (DEBUG) endpoint.searchParams.set("diag", "1");

  const ctrl = new AbortController();
  const to   = setTimeout(()=>ctrl.abort(new Error('Timeout')), timeoutMs);

  log("GET", endpoint.toString());

  try{
    const r = await fetch(endpoint.toString(), { headers:{accept:"application/json"}, signal: ctrl.signal, cache:'no-store' });
    log("status", r.status);
    const bodyText = await r.text();
    log("raw length", bodyText.length);
    if (!r.ok) throw new Error(`Aggregator ${r.status} ${bodyText.slice(0,180)}`);

    let j = null;
    try { j = bodyText ? JSON.parse(bodyText) : null; }
    catch (e) { throw new Error("JSON parse failed"); }

    // תומך בשני פורמטים: מערך רגיל או {items, diag}
    const items = Array.isArray(j) ? j : (Array.isArray(j?.items) ? j.items : []);
    const diag  = Array.isArray(j) ? null : (j?.diag || null);

    log("items count", items.length, diag ? "(diag present)" : "");

    return { items: normalize(items), diag };

  } finally {
    clearTimeout(to);
  }
}

/* דה־דופ + סינון פריטי עבר ישנים מדי + מיון */
function normalize(arr){
  const byKey = new Map();
  const now = Date.now();
  const maxAgeMs = MAX_AGE_DAYS * 24*60*60*1000;

  for (const it of arr){
    const link = safeUrl(it.link);
    const hasText = Boolean(it.headline || it.summary);
    if (!hasText) continue;

    const ts = toTs(it.date);
    // אם יש תאריך והוא ישן מדי — מדלגים; אם אין תאריך — נשאיר (יופיע בסוף)
    if (ts && (now - ts) > maxAgeMs) continue;

    const key = link || (it.headline ? `title:${it.headline}` : null);
    if (!key || byKey.has(key)) continue;

    byKey.set(key, it);
  }

  return [...byKey.values()].sort((a,b)=> toTs(b.date) - toTs(a.date));
}

function applyFilter(items, lang){
  if (lang === 'all') return items;
  return items.filter(x => normLang(x.language) === lang);
}

/* ====== DEBUG PANEL (אופציונלי) ====== */
function renderDiag(diag){
  if (!DEBUG || !diag) return "";
  const rowsFeeds = Object.entries(diag.feeds||{}).map(([k,v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${v.count||0}</td></tr>`).join('');
  const rowsG     = Object.entries(diag.gnews||{}).map(([k,v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${v.count||0}</td></tr>`).join('');
  const errs      = (diag.errors||[]).map(e => `<li><code>${escapeHtml(e.type)} / ${escapeHtml(String(e.id))}</code> — ${escapeHtml(e.msg||'error')}</li>`).join('');
  return `
    <details open style="margin:10px 0; background:#ffffff0f; border:1px solid #ffffff1f; border-radius:8px; padding:8px;">
      <summary>Diagnostics</summary>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:8px;">
        <div>
          <h4 style="margin:6px 0;">Feeds</h4>
          <table style="width:100%; font-size:.9rem;">
            <thead><tr><th align="left">Source</th><th align="right">Count</th></tr></thead>
            <tbody>${rowsFeeds || '<tr><td colspan="2">—</td></tr>'}</tbody>
          </table>
        </div>
        <div>
          <h4 style="margin:6px 0;">Google News</h4>
          <table style="width:100%; font-size:.9rem;">
            <thead><tr><th align="left">Query</th><th align="right">Count</th></tr></thead>
            <tbody>${rowsG || '<tr><td colspan="2">—</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div style="margin-top:8px;">
        <h4 style="margin:6px 0;">Errors</h4>
        <ul>${errs || '<li>—</li>'}</ul>
      </div>
    </details>
  `;
}

/* ====== INIT ====== */
(function init(){
  showLoading();

  // כפתורי פילטר
  $$('.toolbar .btn[data-filter]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      currentFilter = normalizeFilter(btn.dataset.filter || 'all');
      updateActiveButtons();
      if (__DATA__) render(applyFilter(__DATA__, currentFilter));
    });
  });
  updateActiveButtons();

  // כפתור רענון (אם קיים ב־HTML)
  $('#refreshBtn')?.addEventListener('click', ()=> location.reload());

  // שליפה
  fetchAgg()
    .then(({items, diag}) => {
      __DATA__ = items;
      // אם debug — נציג פאנל דיאגנוסטיקה מעל הפיד
      if (DEBUG) {
        const diagHtml = renderDiag(diag);
        if (diagHtml) {
          const wrap = document.createElement('div');
          wrap.innerHTML = diagHtml;
          document.querySelector('.container')?.insertBefore(wrap, $('#newsFeed'));
        }
      }
      render(applyFilter(items, currentFilter));
    })
    .catch(err  => {
      log("fetch error", err);
      const help = DEBUG
        ? `<p style="margin-top:8px">בדוק ישירות: <a href="${AGG_ENDPOINT}?diag=1" target="_blank" rel="noopener">API diag</a></p>`
        : "";
      showError(err.message || String(err), help);
    });
})();

