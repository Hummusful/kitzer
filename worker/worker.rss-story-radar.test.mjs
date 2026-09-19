import assert from "node:assert/strict";
import test from "node:test";
import { ingestRssStoryArticles } from "./worker.js";

const now = new Date("2026-09-19T12:00:00.000Z");

function fakeDb() {
  const records = new Map();
  const inserted = [];
  return {
    inserted,
    records,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            run: async () => {
              if (sql.includes("UPDATE story_articles")) {
                const [cover, hash] = params;
                const record = records.get(hash);
                if (!record || record.cover) return { meta: { changes: 0 } };
                record.cover = cover;
                return { meta: { changes: 1 } };
              }
              const [hash] = params;
              if (records.has(hash)) return { meta: { changes: 0 } };
              const record = {
                article_url: params[1], title: params[2], source: params[3],
                published_at: params[4], created_at: params[5], cover: params[6]
              };
              records.set(hash, record);
              inserted.push(record);
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
    created_at: now.toISOString(),
    cover: null
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

test("a duplicate RSS article fills a missing cover without clustering again", async () => {
  const db = fakeDb();
  let assignments = 0;
  const base = { title: "Story", link: "https://example.com/cover", source: "Example", date: "2026-09-19T10:00:00Z" };
  const options = { now: () => now, assign: async () => { assignments += 1; } };
  await ingestRssStoryArticles(db, [base], options);
  await ingestRssStoryArticles(db, [{ ...base, cover: "https://images.example.com/story.jpg" }], options);
  assert.equal(db.inserted.length, 1);
  assert.equal(db.inserted[0].cover, "https://images.example.com/story.jpg");
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
