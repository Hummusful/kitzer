import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminStoryRadarBackfill } from "./summary-worker.js";

const authorized = async () => ({ ok: true, email: "admin@example.com" });
const unauthorized = async () => ({
  ok: false,
  response: new Response(JSON.stringify({ error: "ACCESS_TOKEN_INVALID" }), { status: 401 })
});
const runAt = new Date("2026-09-19T12:00:00.000Z");

function request() {
  return new Request("https://kitzer.net/api/admin/story-radar/backfill", { method: "POST" });
}

function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...params) {
          calls.push({ sql, params });
          return { all: async () => ({ results: rows }) };
        }
      };
    }
  };
}

test("backfill requires Admin authorization before querying D1", async () => {
  const db = fakeDb([]);
  const response = await handleAdminStoryRadarBackfill(request(), { KITZER_NEWS_DB: db }, { authorize: unauthorized });
  assert.equal(response.status, 401);
  assert.equal(db.calls.length, 0);
});

test("backfill skips summaries already linked to a story cluster", async () => {
  const db = fakeDb([{ url_hash: "linked", title: "Existing", source: "Source", published_at: runAt.toISOString(), already_clustered: 1 }]);
  let assignments = 0;
  const response = await handleAdminStoryRadarBackfill(request(), { KITZER_NEWS_DB: db }, {
    authorize: authorized,
    now: () => runAt,
    assign: async () => { assignments += 1; return { created: true }; }
  });

  assert.deepEqual(await response.json(), { scanned: 1, processed: 0, skipped: 1, clusters_created: 0, errors: 0 });
  assert.equal(assignments, 0);
});

test("backfill is idempotent when a repeat read reports the new link", async () => {
  const rows = [{ url_hash: "new", title: "New story", source: "Source", published_at: runAt.toISOString(), already_clustered: 0 }];
  const db = fakeDb(rows);
  let assignments = 0;
  const assign = async () => {
    assignments += 1;
    rows[0].already_clustered = 1;
    return { created: true };
  };
  const options = { authorize: authorized, now: () => runAt, assign };

  const first = await handleAdminStoryRadarBackfill(request(), { KITZER_NEWS_DB: db }, options);
  const second = await handleAdminStoryRadarBackfill(request(), { KITZER_NEWS_DB: db }, options);

  assert.deepEqual(await first.json(), { scanned: 1, processed: 1, skipped: 0, clusters_created: 1, errors: 0 });
  assert.deepEqual(await second.json(), { scanned: 1, processed: 0, skipped: 1, clusters_created: 0, errors: 0 });
  assert.equal(assignments, 1);
});

test("backfill queries no more than 250 recent story articles", async () => {
  const db = fakeDb([]);
  await handleAdminStoryRadarBackfill(request(), { KITZER_NEWS_DB: db }, { authorize: authorized, now: () => runAt });
  assert.match(db.calls[0].sql, /FROM story_articles AS article/);
  assert.match(db.calls[0].sql, /story_cluster_articles AS link/);
  assert.deepEqual(db.calls[0].params, ["2026-09-16T12:00:00.000Z", 250]);
});
