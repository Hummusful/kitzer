# KITZER

KITZER is a Hebrew, RTL music-news feed. The static site is served at `https://www.kitzer.net`; the music API runs at `https://api.kitzer.net`; and the AI summary service is exposed through `/api/summarize` on the main site.

## Architecture

```text
www.kitzer.net (GitHub Pages)
  ├── app.js ────────────────> api.kitzer.net (music feed and charts Worker)
  └── summary.js ────────────> /api/summarize (AI summary Worker)

Both Workers use the KITZER_NEWS_DB D1 database.
```

| Component | Source | Deployment configuration |
| --- | --- | --- |
| Static site | `index.html`, `app.js`, CSS files | GitHub Pages from `main` |
| Music API | `worker/worker.js` (also exported by `src/index.js`) | Existing `api.kitzer.net` Worker |
| AI summary API | `worker/summary-worker.js` | `wrangler.toml` (`kitzer-summary`) |

The music API is intentionally listed separately because its production Worker predates this repository configuration. Do not deploy `wrangler.toml` to `api.kitzer.net`: it deploys the AI summary Worker.

## Development and tests

The frontend has no build step. Serve the repository from a local web server when testing the UI. Worker unit tests use Node's test runner:

```powershell
node --test worker\*.test.mjs
```

The summary Worker requires a D1 binding named `KITZER_NEWS_DB`, a Workers AI binding named `AI`, and these secrets/configuration values in production:

- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `ADMIN_EMAILS`
- optional `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `LASTFM_API_KEY`

Never commit secrets or `.dev.vars` files.

## Deploying the summary Worker

Install Wrangler v4 or later, authenticate to the intended Cloudflare account, then validate before deployment:

```powershell
npm exec wrangler -- check
npm exec wrangler -- deploy --dry-run
npm exec wrangler -- deploy
```

`wrangler.toml` keeps dashboard secrets/variables with `keep_vars = true`. Apply D1 migrations deliberately before relying on a new schema:

```powershell
npm exec wrangler -- d1 migrations apply kitzer-news --remote
```

## Security controls

- The music API permits only the KITZER and legacy GitHub Pages origins.
- The summary Worker accepts only KITZER origins, allows summaries from enabled RSS source domains, blocks private/local addresses, and revalidates redirects.
- Admin routes require a verified Cloudflare Access JWT and an allowlisted email.
- AI usage has global daily and per-minute limits to control cost.
- Browser assets use a restrictive CSP, referrer policy, and permissions policy.

The static GitHub Pages origin cannot set response headers itself. Apply the Cloudflare response-header rule described in [`CLOUDFLARE_SECURITY_HEADERS.md`](CLOUDFLARE_SECURITY_HEADERS.md) for the browser-enforced headers that require a CDN response rule.
