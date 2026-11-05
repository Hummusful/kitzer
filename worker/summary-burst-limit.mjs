const initializedDatabases = new WeakSet();

export async function checkSummaryBurstLimit(database, clientAddress, now = Date.now()) {
  if (!initializedDatabases.has(database)) {
    await database.prepare(`
      CREATE TABLE IF NOT EXISTS summary_burst_limits (
        client_hash TEXT PRIMARY KEY,
        recent_requests TEXT NOT NULL,
        blocked_until INTEGER NOT NULL DEFAULT 0
      )
    `).run();
    initializedDatabases.add(database);
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientAddress));
  const clientHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');

  // One atomic upsert counts concurrent requests across Worker instances.
  // Keep a rolling ten-second window and do not extend an existing ban.
  const result = await database.prepare(`
    INSERT INTO summary_burst_limits (client_hash, recent_requests, blocked_until)
    VALUES (?1, json_array(?2), 0)
    ON CONFLICT(client_hash) DO UPDATE SET
      recent_requests = CASE
        WHEN blocked_until > ?2 THEN recent_requests
        ELSE json_insert(
          (SELECT json_group_array(value) FROM json_each(recent_requests) WHERE value > ?3),
          '$[#]', ?2
        )
      END,
      blocked_until = CASE
        WHEN blocked_until > ?2 THEN blocked_until
        WHEN (SELECT COUNT(*) FROM json_each(recent_requests) WHERE value > ?3) >= 3
          THEN ?2 + 3600000
        ELSE 0
      END
    RETURNING blocked_until
  `).bind(clientHash, now, now - 10_000).first();

  return Math.max(0, Math.ceil((result.blocked_until - now) / 1000));
}

export function withSummaryBurstLimit(worker) {
  return {
    ...worker,
    async fetch(request, env, ctx) {
      const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
      if (path !== '/api/summarize' || request.method === 'OPTIONS') {
        return worker.fetch(request, env, ctx);
      }

      const headers = {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      };
      const origin = request.headers.get('Origin');
      if (['https://www.kitzer.net', 'https://kitzer.net'].includes(origin)) {
        headers['access-control-allow-origin'] = origin;
        headers['access-control-allow-credentials'] = 'true';
        headers['access-control-expose-headers'] = 'Retry-After';
        headers.vary = 'Origin';
      }

      const clientAddress = request.headers.get('CF-Connecting-IP');
      if (!env.KITZER_NEWS_DB || !clientAddress) {
        return new Response(JSON.stringify({ error: 'RATE_LIMIT_UNAVAILABLE' }), { status: 503, headers });
      }

      try {
        const retryAfter = await checkSummaryBurstLimit(env.KITZER_NEWS_DB, clientAddress);
        if (retryAfter > 0) {
          headers['retry-after'] = String(retryAfter);
          return new Response(JSON.stringify({ error: 'AI_RATE_LIMITED', retry_after: retryAfter }), {
            status: 429,
            headers
          });
        }
      } catch (error) {
        console.error('Summary burst limit unavailable', String(error?.message || error));
        return new Response(JSON.stringify({ error: 'RATE_LIMIT_UNAVAILABLE' }), { status: 503, headers });
      }

      return worker.fetch(request, env, ctx);
    }
  };
}
