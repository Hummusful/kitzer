(() => {
  const feed = document.getElementById('newsFeed');
  const nowGrid = document.getElementById('editorialNowGrid');
  const nowSection = document.getElementById('editorialNow');
  const hero = document.getElementById('storyHero');
  const feedHeading = document.getElementById('editorialFeedHeading');
  if (!feed || !nowGrid || !nowSection) return;

  document.body.classList.add('homepage-v2');

  const text = (root, selector) => root.querySelector(selector)?.textContent?.trim() || '';
  const normalize = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const STOP_WORDS = new Set(['the','and','for','with','from','this','that','into','about','after','over','under','his','her','their','its','של','את','על','עם','לא','זה','זו','גם','אל','מן','הוא','היא','הם','הן','עוד']);

  function tokenSet(value) {
    return new Set(normalize(value).split(' ').filter(word => word.length > 2 && !STOP_WORDS.has(word)));
  }

  function similarity(a, b) {
    const left = tokenSet(a);
    const right = tokenSet(b);
    if (!left.size || !right.size) return 0;
    let shared = 0;
    left.forEach(token => { if (right.has(token)) shared += 1; });
    return shared / Math.min(left.size, right.size);
  }

  function cardData(card, index) {
    const title = text(card, '.news-title');
    const source = text(card, '.news-source');
    const tags = [...card.querySelectorAll('.news-tags .tag')].map(tag => normalize(tag.textContent)).filter(Boolean);
    return {
      card,
      index,
      title,
      source,
      sourceKey: normalize(source),
      tags,
      fresh: card.classList.contains('fresh'),
      hasCover: Boolean(card.querySelector('.news-cover')),
      hasSummary: Boolean(text(card, '.news-summary'))
    };
  }

  function chooseBest(pool, selected, sourceCounts, tagCounts) {
    let best = null;
    let bestScore = -Infinity;

    for (const item of pool) {
      if (selected.includes(item)) continue;

      let score = 100 - item.index * 2;
      if (item.fresh) score += 24;
      if (item.hasCover) score += 10;
      if (item.hasSummary) score += 5;

      const sameSource = sourceCounts.get(item.sourceKey) || 0;
      score -= sameSource * 55;

      for (const tag of item.tags) score -= (tagCounts.get(tag) || 0) * 18;

      for (const chosen of selected) {
        const overlap = similarity(item.title, chosen.title);
        if (overlap >= 0.68) score -= 140;
        else if (overlap >= 0.45) score -= 55;
        else if (overlap >= 0.3) score -= 20;
      }

      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }

    return best;
  }

  function selectEditorialCards() {
    const candidates = [...feed.querySelectorAll('.news-card')].slice(0, 20).map(cardData);
    if (!candidates.length) return [];

    const heroTitle = text(hero || document, '.story-hero h2');
    const withoutHeroDuplicates = candidates.filter(item => !heroTitle || similarity(item.title, heroTitle) < 0.42);
    const pool = withoutHeroDuplicates.length >= 4 ? withoutHeroDuplicates : candidates;
    const selected = [];
    const sourceCounts = new Map();
    const tagCounts = new Map();

    while (selected.length < 4 && selected.length < pool.length) {
      const unseenSources = pool.filter(item => !selected.includes(item) && !(sourceCounts.get(item.sourceKey) > 0));
      const slotsLeft = 4 - selected.length;
      const distinctSourcesLeft = new Set(unseenSources.map(item => item.sourceKey).filter(Boolean)).size;
      const candidatePool = distinctSourcesLeft >= slotsLeft ? unseenSources : pool;

      let best = chooseBest(candidatePool, selected, sourceCounts, tagCounts);
      if (!best && candidatePool !== pool) best = chooseBest(pool, selected, sourceCounts, tagCounts);
      if (!best) break;

      selected.push(best);
      sourceCounts.set(best.sourceKey, (sourceCounts.get(best.sourceKey) || 0) + 1);
      best.tags.forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
    }

    return selected.map(item => item.card);
  }

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

  function syncPromotedCards(cards) {
    feed.querySelectorAll('.news-card.editorial-promoted').forEach(card => card.classList.remove('editorial-promoted'));
    cards.forEach(card => card.classList.add('editorial-promoted'));
  }

  function refreshEditorialNow() {
    const cards = selectEditorialCards();
    if (!cards.length) return;
    const fragment = document.createDocumentFragment();
    cards.forEach(card => {
      const editorialCard = buildEditorialCard(card);
      if (editorialCard) fragment.appendChild(editorialCard);
    });
    if (!fragment.childNodes.length) return;
    nowGrid.replaceChildren(fragment);
    syncPromotedCards(cards);
    nowSection.hidden = false;
  }

  const feedObserver = new MutationObserver(refreshEditorialNow);
  feedObserver.observe(feed, { childList: true, subtree: false });
  if (hero) {
    const heroObserver = new MutationObserver(refreshEditorialNow);
    heroObserver.observe(hero, { childList: true, subtree: true });
  }
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
