# קיצר (Kitzer) — Dusty's Music Feed

A real-time music news aggregator powered by Cloudflare Workers. Aggregates music news from 27+ trusted sources across three genres: Hebrew, Electronic, and International.

**Live Demo:** [kitzer.net](https://kitzer.net)

## Features

- 🎵 **Real-time Music News** — Aggregates updates from 27+ music publications
- 🌍 **Multi-Language** — Hebrew & English support with full RTL layout
- 🎛️ **Genre Filtering** — Hebrew, International, Electronic, or All
- ⚡ **Performance Optimized** — Genre-based API filtering (60-75% reduction in load time)
- 🎨 **Dark Theme** — Beautiful neon aesthetic with smooth animations
- ♿ **Accessible** — WCAG compliant with ARIA labels and keyboard navigation
- 💾 **Smart Caching** — 30-minute LocalStorage TTL + Cloudflare edge cache
- 📱 **Responsive** — Mobile, tablet, and desktop optimized

## Architecture

```
Frontend (index.html + app.js + styles.css)
            ↓
       Fetch API
            ↓
Cloudflare Worker (music-aggregator-worker.js)
            ↓
    RSS Feed Aggregation (27 sources)
            ↓
    Image Optimization & Scoring
            ↓
    Music Relevance Filtering
            ↓
        JSON Response
```

## Setup

### Prerequisites
- Node.js or just a browser (no build step required)
- Cloudflare Workers account for deployment
- Git for version control

### Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/kitzer.git
   cd kitzer
   ```

2. **Serve locally** (Python 3):
   ```bash
   python -m http.server 8000
   # Visit http://localhost:8000
   ```

   Or with Node.js (http-server):
   ```bash
   npx http-server -p 8000
   ```

3. **Configure custom API endpoint** (optional):
   ```html
   <!-- In index.html, before app.js -->
   <script>
     window.CONFIG = {
       API_ENDPOINT: 'http://localhost:8787/api/music',
       FETCH_TIMEOUT: 15000
     };
   </script>
   ```

## Deployment

### Deploy Frontend to GitHub Pages

```bash
git add .
git commit -m "Update feed"
git push origin main
```

The site will automatically deploy to your GitHub Pages URL.

### Deploy Worker to Cloudflare

1. **Install Wrangler CLI:**
   ```bash
   npm install -g @cloudflare/wrangler
   ```

2. **Copy worker code:**
   ```bash
   cp worker/worker.js your-cloudflare-project/src/index.js
   ```

3. **(Optional) Enable Spotify Trending for Hebrew Genre:**
   - Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   - Create a new App → Accept terms → Get credentials
   - Copy your **Client ID** and **Client Secret**
   - Add them to Cloudflare Worker secrets:
     ```bash
     wrangler secret put SPOTIFY_CLIENT_ID
     # Paste your Client ID, press Enter
     
     wrangler secret put SPOTIFY_CLIENT_SECRET
     # Paste your Client Secret, press Enter
     ```

4. **Deploy:**
   ```bash
   wrangler deploy
   ```

5. **Update API endpoint** in `app.js` if using custom domain

**Note:** Last.fm Trending requires no configuration—it works out of the box!

## Feed Sources

### Hebrew (2 RSS + 1 API)
- Mako מוזיקה (RSS) ✅
- Walla מוזיקה (RSS) ✅
- Bandcamp Hebrew (RSS) ✅
- **Spotify Trending Israel** (API, requires setup) 🎵

### Electronic (8 RSS sources)
- Trancentral, Your EDM, Dancing Astronaut, DJ Mag
- EDM.com, EDM Sauce, Mixmag, Magnetic Mag

### International (16 RSS + 1 API)
- Rolling Stone, NY Times, Pitchfork, Stereogum, Consequence
- The FADER, SPIN, XXL Mag, The Source, Complex
- Loudwire, MBW, Hypebot, DMN, Variety, THR
- **Last.fm Trending Charts** (no auth needed) 📊

**To add more feeds**, edit the `FEEDS` array in `worker/worker.js`

## Configuration

### Environment Variables (Worker)

**Required (if using Spotify Trending):**
```
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
```

Get credentials from [Spotify Developer Dashboard](https://developer.spotify.com/dashboard):
1. Create a new App
2. Accept terms and create
3. Copy `Client ID` and `Client Secret`
4. Store securely in Cloudflare

**Optional Settings:**
```toml
[env.production]
vars = { CACHE_TTL = "1800" }
```

### Client Config (Optional)
Set `window.CONFIG` in HTML before loading `app.js`:
```javascript
window.CONFIG = {
  API_ENDPOINT: 'https://custom-api.example.com/api/music',
  FETCH_TIMEOUT: 15000  // milliseconds
};
```

## Performance

- **First Load:** ~800ms (cold cache)
- **Repeat Load:** ~100ms (LocalStorage hit)
- **Genre Filter:** 60-75% faster (only fetches relevant feeds)
- **Lighthouse Score:** 95+ (Performance, Accessibility)

## Browser Support

- Chrome/Edge 88+
- Firefox 85+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Android)

## Development

### File Structure
```
kitzer/
├── index.html          # Main HTML with semantic structure
├── app.js              # Frontend logic (323 lines)
├── styles.css          # Responsive design system (880+ lines)
├── worker/
│   └── worker.js       # Cloudflare Worker (788 lines)
├── CNAME               # GitHub Pages domain
└── README.md           # This file
```

### Code Style
- No build tools required
- Vanilla JavaScript (ES6+)
- CSS custom properties for theming
- HTML semantic elements with ARIA labels

### Testing

Open DevTools Console to verify:
```javascript
// Check cache
localStorage.getItem('kitzer-radio-revolution-images-v2:all')

// Check worker response
fetch('https://music-aggregator.dustrial.workers.dev/api/music?genre=electronic&limit=5')
  .then(r => r.json())
  .then(d => console.log(d))
```

## Known Limitations

- RSS feeds can be slow or unavailable (Worker retries failed feeds)
- Some sources may have paywalls or require JS (not included)
- Images may take 1-2s to load from CDN

## Error Handling

The app handles:
- ✅ Network timeouts (10 second limit)
- ✅ Offline mode (shows cached results)
- ✅ API errors (shows user-friendly messages in Hebrew)
- ✅ Malformed RSS/JSON (silently ignored, partial results shown)
- ✅ Broken images (fallback to music note symbol)

## License

MIT License - feel free to fork and modify

## Contributing

1. Test locally: `python -m http.server 8000`
2. Add new feed sources to `FEEDS` array
3. Submit PR with improvements

## Contact

For issues or feature requests, open a GitHub issue or reach out on [Twitter](https://twitter.com/yourhandle) 
