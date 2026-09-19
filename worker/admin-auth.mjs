const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const jwksCache = new Map();
const encoder = new TextEncoder();

function base64UrlBytes(value) {
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("MALFORMED_JWT");
  try {
    return {
      header: JSON.parse(new TextDecoder().decode(base64UrlBytes(parts[0]))),
      payload: JSON.parse(new TextDecoder().decode(base64UrlBytes(parts[1]))),
      signature: base64UrlBytes(parts[2]),
      signingInput: `${parts[0]}.${parts[1]}`
    };
  } catch {
    throw new Error("MALFORMED_JWT");
  }
}

function teamDomain(value) {
  const candidate = String(value || "").trim();
  if (!candidate) throw new Error("MISSING_ACCESS_TEAM_DOMAIN");
  const url = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("INVALID_ACCESS_TEAM_DOMAIN");
  }
  return url.origin;
}

function adminEmails(value) {
  return new Set(
    String(value || "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean)
  );
}

async function loadJwks(domain, fetchImpl, now) {
  const cached = jwksCache.get(domain);
  if (cached && cached.expiresAt > now.getTime()) return cached.keys;

  const response = await fetchImpl(`${domain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("JWKS_UNAVAILABLE");
  const body = await response.json();
  if (!Array.isArray(body?.keys)) throw new Error("INVALID_JWKS");
  jwksCache.set(domain, { keys: body.keys, expiresAt: now.getTime() + JWKS_CACHE_TTL_MS });
  return body.keys;
}

function hasAudience(aud, expectedAudience) {
  return Array.isArray(aud) ? aud.includes(expectedAudience) : aud === expectedAudience;
}

async function validateAccessToken(token, env, { fetchImpl, now }) {
  const domain = teamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const audience = String(env.CF_ACCESS_AUD || "").trim();
  if (!audience) throw new Error("MISSING_ACCESS_AUDIENCE");

  const { header, payload, signature, signingInput } = parseJwt(token);
  if (header.alg !== "RS256" || !header.kid) throw new Error("UNSUPPORTED_JWT");
  if (payload.iss !== domain || !hasAudience(payload.aud, audience)) throw new Error("INVALID_CLAIMS");
  if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(now.getTime() / 1000)) {
    throw new Error("EXPIRED_JWT");
  }

  const jwks = await loadJwks(domain, fetchImpl, now);
  const jwk = jwks.find(key => key.kid === header.kid && key.kty === "RSA" && key.alg === "RS256");
  if (!jwk) throw new Error("UNKNOWN_SIGNING_KEY");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    encoder.encode(signingInput)
  );
  if (!valid) throw new Error("INVALID_SIGNATURE");
  return payload;
}

function denial(status, code) {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error: code }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    })
  };
}

// Reusable guard for future /api/admin/* routes. A caller returns `response` when
// `ok` is false, and otherwise may use the verified Access claims in `claims`.
export async function authorizeAdminRequest(request, env, { fetchImpl = fetch, now = new Date() } = {}) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return denial(401, "ACCESS_TOKEN_MISSING");

  let claims;
  try {
    claims = await validateAccessToken(token, env, { fetchImpl, now });
  } catch (error) {
    if (String(error?.message || "").startsWith("MISSING_ACCESS_") ||
        String(error?.message || "").startsWith("INVALID_ACCESS_")) {
      return denial(500, "ADMIN_AUTH_MISCONFIGURED");
    }
    return denial(401, "ACCESS_TOKEN_INVALID");
  }

  const email = String(claims.email || "").trim().toLowerCase();
  if (!adminEmails(env.ADMIN_EMAILS).has(email)) return denial(403, "ADMIN_FORBIDDEN");
  return { ok: true, email, claims };
}
