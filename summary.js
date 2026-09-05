const SUMMARY_ENDPOINT = window.CONFIG?.SUMMARY_ENDPOINT || '/api/summarize';

const summaryState = new WeakMap();

function createSummaryBox() {
  const box = document.createElement('div');
  box.className = 'ai-summary-box';
  box.hidden = true;
  box.setAttribute('dir', 'rtl');
  box.setAttribute('aria-live', 'polite');
  return box;
}

function setSummaryContent(box, data) {
  box.replaceChildren();

  const heading = document.createElement('div');
  heading.className = 'ai-summary-heading';
  heading.textContent = '✨ קיצר';
  box.appendChild(heading);

  const p = document.createElement('p');
  p.className = 'ai-summary-text';
  p.textContent = data.summary || 'לא התקבל תקציר.';
  box.appendChild(p);

  if (data.why_it_matters) {
    const why = document.createElement('p');
    why.className = 'ai-summary-why';
    const strong = document.createElement('strong');
    strong.textContent = 'למה זה מעניין: ';
    why.appendChild(strong);
    why.append(document.createTextNode(data.why_it_matters));
    box.appendChild(why);
  }

  if (data.limited) {
    const note = document.createElement('p');
    note.className = 'ai-summary-note';
    note.textContent = 'התקציר מבוסס על הטקסט שהיה זמין מהמקור.';
    box.appendChild(note);
  }

  box.hidden = false;
}

function setSummaryError(box, errorCode) {
  const friendly = {
    SOURCE_NOT_ALLOWED: 'המקור הזה עדיין לא נתמך בסיכום.',
    NOT_ENOUGH_ARTICLE_TEXT: 'לא הצלחתי לחלץ מספיק תוכן מהכתבה כדי לסכם אותה.',
    ARTICLE_TIMEOUT: 'האתר המקורי לא הגיב בזמן. אפשר לנסות שוב.',
    AI_BINDING_MISSING: 'שירות הסיכום עדיין לא מחובר ב-Cloudflare.',
    D1_BINDING_MISSING: 'מסד הנתונים של הסיכומים עדיין לא מחובר.'
  };

  box.replaceChildren();
  const p = document.createElement('p');
  p.className = 'ai-summary-error';
  p.textContent = friendly[errorCode] || 'לא הצלחתי לסכם את הכתבה כרגע.';
  box.appendChild(p);
  box.hidden = false;
}

async function summarizeCard(card, button, box) {
  const titleLink = card.querySelector('.news-title a');
  if (!titleLink?.href) return;

  const title = titleLink.textContent?.trim() || '';
  const source = card.querySelector('.news-source')?.textContent?.trim() || '';

  button.disabled = true;
  button.classList.add('loading');
  button.textContent = 'מקצר…';
  box.hidden = true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);

  try {
    const response = await fetch(SUMMARY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: titleLink.href, title, source }),
      signal: controller.signal
    });

    let data = {};
    try { data = await response.json(); } catch {}

    if (!response.ok || !data?.summary) {
      throw Object.assign(new Error(data?.error || `HTTP_${response.status}`), { code: data?.error });
    }

    setSummaryContent(box, data);
    button.textContent = data.cached ? '✨ קיצר ✓' : '✨ קיצר';
    summaryState.set(card, { loaded: true });
  } catch (error) {
    if (error?.name === 'AbortError') setSummaryError(box, 'ARTICLE_TIMEOUT');
    else setSummaryError(box, error?.code || error?.message);
    button.textContent = '✨ נסה שוב';
  } finally {
    clearTimeout(timeout);
    button.disabled = false;
    button.classList.remove('loading');
  }
}

function enhanceCard(card) {
  if (card.dataset.aiSummaryReady === '1') return;
  const footer = card.querySelector('.news-footer-meta');
  const titleLink = card.querySelector('.news-title a');
  if (!footer || !titleLink?.href) return;

  card.dataset.aiSummaryReady = '1';

  const actions = document.createElement('div');
  actions.className = 'news-actions';

  const existingReadLink = footer.querySelector('.read-link');
  if (existingReadLink) actions.appendChild(existingReadLink);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'summary-button';
  button.textContent = '✨ קיצר';
  button.setAttribute('aria-label', `סכם את הכתבה: ${titleLink.textContent?.trim() || ''}`);
  actions.prepend(button);
  footer.appendChild(actions);

  const box = createSummaryBox();
  footer.insertAdjacentElement('afterend', box);

  button.addEventListener('click', () => {
    const state = summaryState.get(card);
    if (state?.loaded && !box.hidden) {
      box.hidden = true;
      button.textContent = '✨ קיצר';
      return;
    }
    if (state?.loaded && box.hidden) {
      box.hidden = false;
      button.textContent = '✨ קיצר ✓';
      return;
    }
    summarizeCard(card, button, box);
  });
}

function enhanceNewsCards(root = document) {
  root.querySelectorAll('.news-card').forEach(enhanceCard);
}

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('.news-card')) enhanceCard(node);
      enhanceNewsCards(node);
    }
  }
});

function initSummaryUi() {
  const feed = document.getElementById('newsFeed');
  if (!feed) return;
  enhanceNewsCards(feed);
  observer.observe(feed, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSummaryUi, { once: true });
} else {
  initSummaryUi();
}
