# KITZER AI Summary — Cloudflare setup

The repository side is implemented. Cloudflare needs one small deployment/configuration step because the Worker bindings live in the Cloudflare account, not in GitHub.

## Worker

Create/deploy a Worker named `kitzer-summary` using `worker/summary-worker.js`.

Expected public endpoint:

`https://kitzer-summary.dustrial.workers.dev/api/summarize`

The frontend already points to this endpoint. It can be overridden with `window.CONFIG.SUMMARY_ENDPOINT` if the Worker URL changes.

## Required bindings

Add these bindings to the `kitzer-summary` Worker:

- Workers AI binding: variable name `AI`
- D1 binding: variable name `KITZER_NEWS_DB`, pointing to the existing KITZER news database

The Worker calls the model `@cf/zai-org/glm-4.7-flash`.

## D1 migration

Run `worker/migrations/0005_article_summaries.sql` against the existing KITZER D1 database before enabling the frontend.

It creates `article_summaries`, keyed by a SHA-256 hash of the normalized article URL. A summary is generated once and reused on later clicks.

## Security behavior

- Requests are accepted only from `https://kitzer.net` and `https://www.kitzer.net`.
- Article URLs must belong to an enabled RSS source domain stored in KITZER D1.
- Local/private-network hosts are rejected.
- Redirects are checked again against the source allow-list.
- Article download size and fetch time are limited.
- Only extracted article text is sent to Workers AI; full source HTML is not stored.

## Smoke test

1. Open `https://kitzer-summary.dustrial.workers.dev/health` and confirm `ai_binding` and `d1_binding` are both `true`.
2. Open KITZER and click `✨ קיצר` on a normal RSS article.
3. First click should return `cached: false`.
4. Hide/show the summary in the browser; no new AI call is made.
5. A later fresh request for the same article should return `cached: true` from D1.

Some publishers block server-side article fetching or expose only partial content. In those cases KITZER returns a clear failure/limited-content message rather than inventing facts.
