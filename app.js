const FEED_ENDPOINT = 'https://music-aggregator.dustrial.workers.dev/api/music';
const feedEl = document.getElementById('newsFeed');
const refreshBtn = document.getElementById('refreshBtn');

let state = { genre: 'all' };

const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function cleanDescription(html) {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cleanText = doc.body.textContent || "";
    return cleanText.slice(0, 160).trim() + (cleanText.length > 160 ? '...' : '');
  } catch (e) { return ''; }
}

function escapeText(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function safeUrl(href) {
  try {
    const u = new URL(href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '#';
  } catch { return '#'; }
}

const HEB_RTF = new Intl.RelativeTimeFormat('he-IL', { numeric: 'auto' });
const TZ = 'Asia/Jerusalem';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const hr = Math.round(diff / 3600000);
  if (hr < 1) return 'לפני רגע';
  if (hr < 24) return HEB_RTF.format(-hr, 'hour');
  return HEB_RTF.format(-Math.round(hr / 24), 'day');
}

function clockIL(dateStr) {
  try {
    return new Date(dateStr).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  } catch { return ''; }
}

function renderNews(items) {
  if (!feedEl) return;
  feedEl.innerHTML = '';
  if (!items?.length) {
    feedEl.innerHTML = `<p class="muted">אין חדשות כרגע.</p>`;
    return;
  }

  const batchSize = 8;
  const renderBatch = (startIdx) => {
    const endIdx = Math.min(startIdx + batchSize, items.length);
    const frag = document.createDocumentFragment();

    for (let i = startIdx; i < endIdx; i++) {
      const it = items[i];
      const el = document.createElement('article');
      el.className = 'news-card';

      const tags = [];
      if (it.lang) tags.push(it.lang.toUpperCase());
      if (it.genre && it.genre !== 'general') tags.push(it.genre);

      el.innerHTML = `
        <div class="news-details">
          <span class="news-source">${escapeText(it.source)}</span>
          <h3 class="news-title">
            <a href="${safeUrl(it.link)}" target="_blank" rel="noopener noreferrer">${escapeText(it.title)}</a>
          </h3>
          ${it.description ? `<p class="news-summary">${cleanDescription(it.description)}</p>` : ''}
          <div class="news-footer-meta">
            <time class="news-date">
               <span class="rel">${timeAgo(it.date)}</span>
               <span class="sep"> · </span><bdi class="clock">${clockIL(it.date)}\u200E</bdi>
            </time>
            <div class="news-tags">${tags.map(t => `<span class="tag">${escapeText(t)}</span>`).join('')}</div>
          </div>
        </div>`;
      frag.appendChild(el);
    }
    feedEl.appendChild(frag);
    if (endIdx < items.length) requestAnimationFrame(() => renderBatch(endIdx));
  };
  renderBatch(0);
}

async function loadNews(forceRefresh = false) {
  const key = state.genre.toLowerCase();
  const cacheKey = `kitzer-feed-v1:${key}`;

  if (!forceRefresh) {
    const cached = localStorage.getItem(cacheKey);
    if (cached) renderNews(JSON.parse(cached).data);
  }

  if (!feedEl.children.length) feedEl.innerHTML = '<div class="skeleton"></div>'.repeat(6);

  try {
    const url = new URL(FEED_ENDPOINT);
    if (state.genre !== 'all') url.searchParams.set('genre', state.genre);

    const res = await fetch(url);
    const data = await res.json();
    const items = data.items || [];

    localStorage.setItem(cacheKey, JSON.stringify({ data: items, ts: Date.now() }));
    renderNews(items);
  } catch (e) {
    if (!feedEl.children.length) feedEl.innerHTML = `<p class="error">Connection Error</p>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  qsa('[data-genre]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.genre = btn.getAttribute('data-genre') || 'all';
      qsa('[data-genre]').forEach(b => b.classList.toggle('active', b === btn));
      loadNews();
    });
  });
  refreshBtn?.addEventListener('click', () => loadNews(true));
  loadNews();
});
