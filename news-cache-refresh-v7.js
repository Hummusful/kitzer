try {
  for (const genre of ['all', 'hebrew', 'international', 'electronic']) {
    localStorage.removeItem(`kitzer-balanced-news-v5:${genre}`);
    localStorage.removeItem(`kitzer-feed-integrity-v7:${genre}`);
  }
} catch {}
