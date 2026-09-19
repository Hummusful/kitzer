import assert from "node:assert/strict";
import test from "node:test";
import { ingestRssStoryArticles } from "./worker.js";

const now = new Date("2026-09-19T12:00:00.000Z");

function fakeDb() {
  const hashes = new Set();
  const inserted = [];
  return {
    inserted,
    prepare() {
      return {
        bind(...params) {
          return {
            run: async () => {
              const [hash] = params;
              if (hashes.has(hash)) return { meta: { changes: 0 } };
              hashes.add(hash);
              inserted.push({
                article_url: params[1], title: params[2], source: params[3],
                published_at: params[4], created_at: params[5]
              });
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
}

test("a new RSS article is stored and clustered with published_at", async () => {
  const db = fakeDb();
  const assigned = [];
  await ingestRssStoryArticles(db, [{
    title: "Artist announces new album",
    link: "https://example.com/news?utm_source=rss",
    source: "Example",
    date: "2026-09-19T10:30:00.000Z"
  }], { now: () => now, assign: async (...args) => assigned.push(args) });

  assert.deepEqual(db.inserted[0], {
    article_url: "https://example.com/news",
    title: "Artist announces new album",
    source: "Example",
    published_at: "2026-09-19T10:30:00.000Z",
    created_at: now.toISOString()
  });
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0][1].publishedAt, "2026-09-19T10:30:00.000Z");
});

test("a duplicate RSS URL is ignored and not clustered again", async () => {
  const db = fakeDb();
  let assignments = 0;
  const items = [{ title: "Story", link: "https://example.com/story", source: "Example", date: "2026-09-19T10:00:00Z" }];
  const options = { now: () => now, assign: async () => { assignments += 1; } };
  await ingestRssStoryArticles(db, items, options);
  await ingestRssStoryArticles(db, items, options);
  assert.equal(db.inserted.length, 1);
  assert.equal(assignments, 1);
});

test("RSS ingestion processes no more than the 250 newest articles", async () => {
  const db = fakeDb();
  let assignments = 0;
  const items = Array.from({ length: 251 }, (_, index) => ({
    title: `Story ${index}`,
    link: `https://example.com/${index}`,
    source: "Example",
    date: new Date(now.getTime() - index * 1000).toISOString()
  }));
  await ingestRssStoryArticles(db, items, { now: () => now, assign: async () => { assignments += 1; } });
  assert.equal(db.inserted.length, 250);
  assert.equal(assignments, 250);
});
