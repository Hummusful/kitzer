import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { checkSummaryBurstLimit, withSummaryBurstLimit } from './summary-burst-limit.mjs';

function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  return {
    prepare(sql) {
      let parameters = [];
      return {
        bind(...values) { parameters = values; return this; },
        async first() { return sqlite.prepare(sql).get(...parameters); },
        async run() { return sqlite.prepare(sql).run(...parameters); }
      };
    },
    sqlite
  };
}

test('fourth request blocks for an hour without extending the ban', async () => {
  const db = createDatabase();
  const now = 1_800_000_000_000;
  for (const offset of [0, 1000, 9000]) {
    assert.equal(await checkSummaryBurstLimit(db, '192.0.2.1', now + offset), 0);
  }
  assert.equal(await checkSummaryBurstLimit(db, '192.0.2.1', now + 9999), 3600);
  assert.equal(await checkSummaryBurstLimit(db, '192.0.2.1', now + 19999), 3590);
  assert.equal(await checkSummaryBurstLimit(db, '192.0.2.1', now + 3_609_998), 1);
  assert.equal(await checkSummaryBurstLimit(db, '192.0.2.1', now + 3_609_999), 0);
  assert.equal(await checkSummaryBurstLimit(db, '192.0.2.2', now + 9999), 0);
  assert.ok(db.sqlite.prepare('SELECT client_hash FROM summary_burst_limits').all().every(row => /^[a-f0-9]{64}$/.test(row.client_hash)));
});

test('requests expire at the rolling window boundary', async () => {
  const db = createDatabase();
  for (const now of [0, 1000, 2000, 10_000, 11_000, 12_000]) {
    assert.equal(await checkSummaryBurstLimit(db, '192.0.2.1', now), 0);
  }
  assert.equal(await checkSummaryBurstLimit(db, '192.0.2.1', 12_001), 3600);
});

test('simultaneous requests admit only three', async () => {
  const db = createDatabase();
  const results = await Promise.all(Array.from({ length: 8 }, () => checkSummaryBurstLimit(db, '192.0.2.1', 100_000)));
  assert.equal(results.filter(value => value === 0).length, 3);
  assert.equal(results.filter(value => value === 3600).length, 5);
});

test('other routes and preflight pass through, the fourth summary request receives 429', async () => {
  const env = { KITZER_NEWS_DB: createDatabase() };
  const worker = withSummaryBurstLimit({ fetch: () => new Response('original', { status: 405 }) });
  assert.equal((await worker.fetch(new Request('https://www.kitzer.net/health'), env)).status, 405);
  const url = 'https://www.kitzer.net/api/summarize/';
  assert.equal((await worker.fetch(new Request(url, { method: 'OPTIONS' }), env)).status, 405);
  const headers = { 'CF-Connecting-IP': '192.0.2.1', Origin: 'https://www.kitzer.net' };
  for (let i = 0; i < 3; i++) {
    assert.equal((await worker.fetch(new Request(url, { headers }), env)).status, 405);
  }
  const blocked = await worker.fetch(new Request(url, { headers }), env);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '3600');
  assert.equal(blocked.headers.get('access-control-allow-origin'), headers.Origin);
  assert.equal((await blocked.json()).error, 'AI_RATE_LIMITED');
});
