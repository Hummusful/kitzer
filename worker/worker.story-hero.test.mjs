import assert from "node:assert/strict";
import test from "node:test";
import { areCrossLanguageStoryMatches, buildCoherentHeroCandidate, chooseStoryHero, chooseStoryHeroArticle, chooseStoryHeroFallback, collectHeroSources, getStoryHeroSelectionType, isEligibleStoryHero, isEligibleStoryHeroFallback } from "./worker.js";

const now = new Date("2026-09-20T12:00:00.000Z");
const candidate = (id, score, { sources = 3, updatedAt = "2026-09-20T11:00:00.000Z", status = "hero_candidate" } = {}) => ({ id, story_score: score, source_count: sources, last_updated: updatedAt, status });

test("Hero eligibility requires hero_candidate, three sources, and a fresh update", () => {
  assert.equal(isEligibleStoryHero(candidate("a", 100), now), true);
  assert.equal(isEligibleStoryHero(candidate("a", 100, { sources: 2 }), now), false);
  assert.equal(isEligibleStoryHero(candidate("a", 100, { status: "trending" }), now), false);
  assert.equal(isEligibleStoryHero(candidate("a", 100, { updatedAt: "2026-09-17T11:59:59.000Z" }), now), false);
});

test("Hero article selection prefers a valid cover over a newer coverless article", () => {
  const covered = { id: "covered", cover: "https://images.example.com/cover.jpg", published_at: "2026-09-20T09:00:00.000Z" };
  const newerWithoutCover = { id: "newer", cover: null, published_at: "2026-09-20T11:00:00.000Z" };
  assert.equal(chooseStoryHeroArticle([newerWithoutCover, covered]).id, "covered");
  assert.equal(chooseStoryHeroArticle([covered, { ...newerWithoutCover, cover: "javascript:alert(1)" }]).id, "covered");
});

test("Hero is held for two hours, then replaced only with a 15 point lead", () => {
  const current = candidate("current", 100);
  const close = candidate("close", 114);
  const leading = candidate("leading", 115);
  assert.equal(chooseStoryHero([current, leading], { cluster_id: "current", selected_at: "2026-09-20T10:30:00.000Z" }, now).id, "current");
  assert.equal(chooseStoryHero([current, close], { cluster_id: "current", selected_at: "2026-09-20T09:00:00.000Z" }, now).id, "current");
  assert.equal(chooseStoryHero([current, leading], { cluster_id: "current", selected_at: "2026-09-20T09:00:00.000Z" }, now).id, "leading");
});

test("an invalid current Hero is replaced immediately and no eligible Hero returns null", () => {
  const fresh = candidate("fresh", 120);
  assert.equal(chooseStoryHero([fresh], { cluster_id: "stale", selected_at: "2026-09-20T11:30:00.000Z" }, now).id, "fresh");
  assert.equal(chooseStoryHero([candidate("bad", 120, { sources: 2 })], null, now), null);
});

const fallback = (id, score, { sources = 2, updatedAt = "2026-09-20T11:00:00.000Z", status = "trending" } = {}) => ({
  ...candidate(id, score, { sources, updatedAt, status }), title: "New release", url: `https://example.com/${id}`
});

test("fallback requires two sources, an allowed developing status, and a fresh update", () => {
  assert.equal(isEligibleStoryHeroFallback(fallback("trending", 80), now), true);
  assert.equal(isEligibleStoryHeroFallback(fallback("watching", 80, { status: "watching" }), now), true);
  assert.equal(isEligibleStoryHeroFallback(fallback("one-source", 80, { sources: 1 }), now), false);
  assert.equal(isEligibleStoryHeroFallback(fallback("normal", 80, { status: "normal" }), now), false);
  assert.equal(isEligibleStoryHeroFallback(fallback("old", 80, { updatedAt: "2026-09-17T11:59:59.000Z" }), now), false);
});

test("fallbacks require a safe article URL and select the highest score", () => {
  const base = fallback("safe", 80);
  assert.equal(isEligibleStoryHeroFallback({ ...base, url: "javascript:alert(1)" }, now), false);
  assert.equal(chooseStoryHeroFallback([{ ...base, url: "not a URL" }], null, now), null);
  const lowerButNewer = fallback("newer", 90, { updatedAt: "2026-09-20T11:30:00.000Z" });
  const higherButOlder = fallback("higher", 100, { updatedAt: "2026-09-20T10:00:00.000Z" });
  assert.equal(chooseStoryHeroFallback([lowerButNewer, higherButOlder], null, now).id, "higher");
});

test("fallback is held for two hours, then needs a 15 point lead to be replaced", () => {
  const current = fallback("current", 100);
  const close = fallback("close", 114);
  const leading = fallback("leading", 115);
  assert.equal(chooseStoryHeroFallback([current, leading], { cluster_id: "current", selected_at: "2026-09-20T10:30:00.000Z" }, now).id, "current");
  assert.equal(chooseStoryHeroFallback([current, close], { cluster_id: "current", selected_at: "2026-09-20T09:00:00.000Z" }, now).id, "current");
  assert.equal(chooseStoryHeroFallback([current, leading], { cluster_id: "current", selected_at: "2026-09-20T09:00:00.000Z" }, now).id, "leading");
});

test("a confirmed Hero replaces a fallback immediately and selection types are explicit", () => {
  const realHero = candidate("confirmed", 150, { sources: 3, status: "hero_candidate" });
  const fallbackState = { cluster_id: "fallback", selected_at: "2026-09-20T11:30:00.000Z" };
  assert.equal(chooseStoryHero([fallback("fallback", 120), realHero], fallbackState, now).id, "confirmed");
  assert.equal(getStoryHeroSelectionType(realHero), "hero");
  assert.equal(getStoryHeroSelectionType(null), "fallback");
});

test("hero sources include only unique, safe article links", () => {
  const sources = collectHeroSources([
    { source: "Source A", title: "Article one", article_url: "https://example.com/one", cover: "https://example.com/one.jpg" },
    { source: "Source A", title: "Duplicate", article_url: "https://example.com/one" },
    { source: "Unsafe", title: "No", article_url: "javascript:alert(1)" },
    { source: "Source B", title: "Article two", article_url: "https://example.com/two", cover: "javascript:alert(1)" }
  ]);
  assert.deepEqual(sources, [
    { name: "Source A", title: "Article one", url: "https://example.com/one", cover: "https://example.com/one.jpg" },
    { name: "Source B", title: "Article two", url: "https://example.com/two", cover: null }
  ]);
});

test("cross-language sources require the shared story identities", () => {
  const english = { title: "Ed Sheeran addresses Macklemore removal", published_at: "2026-09-20T10:00:00Z" };
  const hebrewSameStory = { title: "אד שירן מתייחס להדחת מקלמור", published_at: "2026-09-20T09:00:00Z" };
  const hebrewDifferentStory = { title: "אד שירן הכריז על אלבום חדש", published_at: "2026-09-20T09:00:00Z" };
  assert.equal(areCrossLanguageStoryMatches(english, hebrewSameStory), true);
  assert.equal(areCrossLanguageStoryMatches(english, hebrewDifferentStory), false);
});

test("Hero rejects a polluted cluster of unrelated stories", () => {
  const cluster = { id: "bad", title: "Taylor Swift Announces New Single", story_score: 188, article_count: 3 };
  const rows = [
    { title: "Empath’s Catherine Elicson Announces Debut Solo Album", source: "Stereogum", article_url: "https://example.com/empath", published_at: now.toISOString() },
    { title: "VMAs Introduce New Award For Taylor Swift", source: "Pitchfork", article_url: "https://example.com/vmas", published_at: now.toISOString() },
    { title: "Julian Jordan Releases Afrojack Remix", source: "EDM Sauce", article_url: "https://example.com/remix", published_at: now.toISOString() }
  ];
  assert.equal(buildCoherentHeroCandidate(cluster, rows), null);
});

test("Hero uses a real article title and only matching sources", () => {
  const cluster = { id: "mixed", title: "Invented headline", story_score: 120, article_count: 3 };
  const rows = [
    { title: "Ed Sheeran addresses Macklemore removal", source: "Source A", article_url: "https://example.com/a", cover: "https://example.com/a.jpg", published_at: now.toISOString() },
    { title: "Ed Sheeran discusses Macklemore removal", source: "Source B", article_url: "https://example.com/b", published_at: now.toISOString() },
    { title: "Empath announces debut album", source: "Source C", article_url: "https://example.com/c", published_at: now.toISOString() }
  ];
  const hero = buildCoherentHeroCandidate(cluster, rows);
  assert.equal(hero.title, rows[0].title);
  assert.equal(hero.url, rows[0].article_url);
  assert.equal(hero.source_count, 2);
  assert.equal(hero.coherentRows.length, 2);
});
