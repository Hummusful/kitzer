# Cloudflare response headers for `www.kitzer.net`

The static site is hosted on GitHub Pages, so these headers must be set at the Cloudflare edge. Create one **Response Header Transform Rule** in the `http_response_headers_transform` phase with this filter:

```text
http.host eq "www.kitzer.net" or http.host eq "kitzer.net"
```

Use **Set static** for each header below:

| Header | Value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self' https://api.kitzer.net https://ai.kitzer.net; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests` |

Do not enable the HSTS `preload` directive until every current and future subdomain is guaranteed to support HTTPS. Verify after publishing with:

```powershell
curl.exe -sS -I https://www.kitzer.net/
curl.exe -sS -I https://kitzer.net/
```

Cloudflare's [Response Header Transform Rules documentation](https://developers.cloudflare.com/rules/transform/response-header-modification/) explains the dashboard and API workflows.
