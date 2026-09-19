import assert from "node:assert/strict";
import test from "node:test";
import { authorizeAdminRequest } from "./admin-auth.mjs";

const NOW = new Date("2026-09-19T12:00:00.000Z");
const AUDIENCE = "admin-audience";
const encoder = new TextEncoder();
let fixtureNumber = 0;

function base64Url(bytes) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signedToken(privateKey, claims, kid = "test-key") {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid })));
  const payload = base64Url(encoder.encode(JSON.stringify(claims)));
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", privateKey, encoder.encode(`${header}.${payload}`)
  ));
  return `${header}.${payload}.${base64Url(signature)}`;
}

async function accessFixture(email = "admin@example.com") {
  const domain = `https://team-test-${fixtureNumber++}.cloudflareaccess.com`;
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  const token = await signedToken(keys.privateKey, {
    iss: domain,
    aud: AUDIENCE,
    exp: Math.floor(NOW.getTime() / 1000) + 3600,
    email
  });
  return {
    token,
    env: { CF_ACCESS_TEAM_DOMAIN: domain, CF_ACCESS_AUD: AUDIENCE, ADMIN_EMAILS: "admin@example.com, second@example.com" },
    fetchImpl: async () => new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
  };
}

test("allows a signed Access token for an admin email", async () => {
  const fixture = await accessFixture();
  const result = await authorizeAdminRequest(
    new Request("https://kitzer.net/api/admin/test", { headers: { "Cf-Access-Jwt-Assertion": fixture.token } }),
    fixture.env,
    { fetchImpl: fixture.fetchImpl, now: NOW }
  );
  assert.equal(result.ok, true);
  assert.equal(result.email, "admin@example.com");
});

test("rejects a missing Access token", async () => {
  const fixture = await accessFixture();
  const result = await authorizeAdminRequest(new Request("https://kitzer.net/api/admin/test"), fixture.env, { fetchImpl: fixture.fetchImpl, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 401);
});

test("rejects an invalid Access token", async () => {
  const fixture = await accessFixture();
  const result = await authorizeAdminRequest(
    new Request("https://kitzer.net/api/admin/test", { headers: { "Cf-Access-Jwt-Assertion": "not.a.jwt" } }),
    fixture.env,
    { fetchImpl: fixture.fetchImpl, now: NOW }
  );
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 401);
});

test("rejects a signed non-admin Access user", async () => {
  const fixture = await accessFixture("member@example.com");
  const result = await authorizeAdminRequest(
    new Request("https://kitzer.net/api/admin/test", { headers: { "Cf-Access-Jwt-Assertion": fixture.token } }),
    fixture.env,
    { fetchImpl: fixture.fetchImpl, now: NOW }
  );
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 403);
});
