(() => {
  const feed = document.getElementById('newsFeed');
  const nowGrid = document.getElementById('editorialNowGrid');
  const nowSection = document.getElementById('editorialNow');
  const hero = document.getElementById('storyHero');
  const feedHeading = document.getElementById('editorialFeedHeading');
  if (!feed || !nowGrid || !nowSection) return;

  document.body.classList.add('homepage-v2');

  const text = (root, selector) => root.querySelector(selector)?.textContent?.trim() || '';

  function buildEditorialCard(sourceCard) {
    const article = document.createElement('article');
    article.className = 'editorial-now-card';

    const sourceLink = sourceCard.querySelector('.news-title a');
    if (!sourceLink) return null;

    const coverImg = sourceCard.querySelector('.news-cover');
    if (coverImg?.src) {
      const cover = document.createElement('a');
      cover.className = 'editorial-now-cover';
      cover.href = sourceLink.href;
      cover.target = '_blank';
      cover.rel = 'noopener noreferrer';
      cover.setAttribute('aria-label', sourceLink.textContent.trim());
      const img = document.createElement('img');
      img.src = coverImg.src;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      cover.appendChild(img);
      article.appendChild(cover);
    }

    const body = document.createElement('div');
    body.className = 'editorial-now-body';

    const meta = document.createElement('div');
    meta.className = 'editorial-now-meta';
    const source = document.createElement('span');
    source.className = 'editorial-now-source';
    source.textContent = text(sourceCard, '.news-source') || 'מוזיקה';
    const date = document.createElement('span');
    date.textContent = text(sourceCard, '.news-date .rel');
    meta.append(source, date);
    body.appendChild(meta);

    const title = document.createElement('h3');
    const link = document.createElement('a');
    link.href = sourceLink.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = sourceLink.textContent.trim();
    title.appendChild(link);
    body.appendChild(title);

    const summaryText = text(sourceCard, '.news-summary');
    if (summaryText) {
      const summary = document.createElement('p');
      summary.className = 'editorial-now-summary';
      summary.textContent = summaryText;
      body.appendChild(summary);
    }

    article.appendChild(body);
    return article;
  }

  function refreshEditorialNow() {
    const cards = [...feed.querySelectorAll('.news-card')].slice(0, 4);
    if (!cards.length) return;
    const fragment = document.createDocumentFragment();
    cards.forEach(card => {
      const editorialCard = buildEditorialCard(card);
      if (editorialCard) fragment.appendChild(editorialCard);
    });
    if (!fragment.childNodes.length) return;
    nowGrid.replaceChildren(fragment);
    nowSection.hidden = false;
  }

  const observer = new MutationObserver(refreshEditorialNow);
  observer.observe(feed, { childList: true, subtree: false });
  refreshEditorialNow();

  function setEditorialVisibility(show) {
    if (hero) hero.toggleAttribute('hidden', !show || !hero.childElementCount);
    nowSection.toggleAttribute('hidden', !show || !nowGrid.childElementCount);
    feedHeading?.toggleAttribute('hidden', !show);
  }

  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      setEditorialVisibility(button.dataset.view !== 'charts');
    });
  });
})();
