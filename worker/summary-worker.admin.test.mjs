import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminStoryRadar, handleAdminStoryRadarPage } from "./summary-worker.js";

const authorized = async () => ({ ok: true, email: "admin@example.com" });
const unauthorized = async () => ({ ok: false, response: new Response(JSON.stringify({ error: "ACCESS_TOKEN_INVALID" }), { status: 401 }) });

function fakeDb({ clusters = [], articles = {} } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...params) {
          calls.push({ sql, params });
          return {
            all: async () => {
              if (sql.includes("FROM story_clusters")) return { results: clusters };
              return { results: articles[params[0]] || [] };
            }
          };
        }
      };
    }
  };
}

function request(query = "") {
  return new Request(`https://kitzer.net/api/admin/story-radar${query}`);
}

test("an authorized admin receives clusters and their linked articles", async () => {
  const db = fakeDb({
    clusters: [{ id: "c1", title: "Story", status: "trending", story_score: 100 }],
    articles: { c1: [{ title: "Article", source: "Source", url: "https://example.com/a", saved_at: "2026-09-19T12:00:00Z" }] }
  });
  const response = await handleAdminStoryRadar(request(), { KITZER_NEWS_DB: db }, { authorize: authorized });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.clusters[0].articles[0].url, "https://example.com/a");
});

test("an unauthorized user is rejected before D1 is queried", async () => {
  const db = fakeDb();
  const response = await handleAdminStoryRadar(request(), { KITZER_NEWS_DB: db }, { authorize: unauthorized });
  assert.equal(response.status, 401);
  assert.equal(db.calls.length, 0);
});

test("the cluster query orders by score then most recent update", async () => {
  const db = fakeDb({ clusters: [{ id: "high", story_score: 150 }, { id: "recent", story_score: 100 }] });
  const response = await handleAdminStoryRadar(request(), { KITZER_NEWS_DB: db }, { authorize: authorized });
  assert.deepEqual((await response.json()).clusters.map(cluster => cluster.id), ["high", "recent"]);
  assert.match(db.calls[0].sql, /ORDER BY story_score DESC, last_updated DESC/);
});

test("a status filter is bound and limits the status set", async () => {
  const db = fakeDb();
  await handleAdminStoryRadar(request("?status=hero_candidate"), { KITZER_NEWS_DB: db }, { authorize: authorized });
  assert.deepEqual(db.calls[0].params, ["hero_candidate", 20]);
});

test("limit defaults to 20 and is capped at 50", async () => {
  const defaultDb = fakeDb();
  await handleAdminStoryRadar(request(), { KITZER_NEWS_DB: defaultDb }, { authorize: authorized });
  assert.equal(defaultDb.calls[0].params.at(-1), 20);

  const cappedDb = fakeDb();
  await handleAdminStoryRadar(request("?limit=200"), { KITZER_NEWS_DB: cappedDb }, { authorize: authorized });
  assert.equal(cappedDb.calls[0].params.at(-1), 50);
});

test("an invalid status returns 400 without querying D1", async () => {
  const db = fakeDb();
  const response = await handleAdminStoryRadar(request("?status=normal"), { KITZER_NEWS_DB: db }, { authorize: authorized });
  assert.equal(response.status, 400);
  assert.equal(db.calls.length, 0);
});

test("the Story Radar page is protected", async () => {
  const response = await handleAdminStoryRadarPage(
    new Request("https://kitzer.net/admin/story-radar"),
    {},
    { authorize: unauthorized }
  );
  assert.equal(response.status, 401);
});

test("an authorized admin receives the Story Radar HTML", async () => {
  const response = await handleAdminStoryRadarPage(
    new Request("https://kitzer.net/admin/story-radar"),
    {},
    { authorize: authorized }
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /\/api\/admin\/story-radar/);
  assert.match(html, /Story Radar/);
});
