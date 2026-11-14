// Sign-in with Google, Microsoft and GitHub (cloud/src/oauth.js) and its flows in the directory
// (directory-core.js › startOAuth / finishOAuth / signInWith). The test id_tokens are unsigned:
// the signature is not verified by design (they come straight from the token endpoint over TLS).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FakeDurableStorage } from "../server/do-sql-fake.mjs";
import { DirectoryCore, DirectoryError, LIMITS } from "../cloud/src/directory-core.js";
import {
  BINDING_COOKIE, LOCAL_BINDING_COOKIE, MICROSOFT_CONSUMER_TENANT, OAuthError, authorizationUrl, bindingCookie, bindingFromRequest,
  checkIdToken, decodeJwt, enabledProviders, exchangeCode, pickGithubEmail, pkceChallenge, providerConfig,
} from "../cloud/src/oauth.js";

const ENV = {
  GOOGLE_CLIENT_ID: "g-client", GOOGLE_CLIENT_SECRET: "g-secret",
  MICROSOFT_CLIENT_ID: "m-client", MICROSOFT_CLIENT_SECRET: "m-secret",
  GITHUB_CLIENT_ID: "gh-client", GITHUB_CLIENT_SECRET: "gh-secret",
};
const ORIGIN = "https://colmena.example";
const NOW = Date.parse("2026-11-14T10:00:00Z");
const SEC = Math.floor(NOW / 1000);
const WORK_TENANT = "11111111-2222-3333-4444-555555555555";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.c2lnbmF0dXJl`;
const google = (over = {}) => ({ iss: "https://accounts.google.com", aud: "g-client", sub: "1001", email: "ana@example.com", email_verified: true, name: "Ana", nonce: "n-1", iat: SEC - 5, exp: SEC + 3600, ...over });
const microsoft = (over = {}) => ({ iss: `https://login.microsoftonline.com/${WORK_TENANT}/v2.0`, tid: WORK_TENANT, oid: "oid-9", sub: "pairwise", aud: "m-client", email: "beto@example.org", xms_edov: true, name: "Beto", nonce: "n-1", iat: SEC - 5, exp: SEC + 3600, ...over });
const refused = (fn, code) => assert.throws(fn, (e) => e instanceof OAuthError && e.code === code);

function directory() {
  let now = NOW;
  const core = new DirectoryCore(new FakeDurableStorage(), { clock: () => now });
  return { core, advance: (ms) => { now += ms; } };
}
const fails = (fn, status, code) => assert.throws(fn, (e) => e instanceof DirectoryError && e.status === status && (!code || e.code === code));

test("only providers with both an id and a secret are offered", () => {
  assert.deepEqual(enabledProviders(ENV).map((p) => p.id), ["google", "microsoft", "github"]);
  assert.deepEqual(enabledProviders({ GOOGLE_CLIENT_ID: "x", GITHUB_CLIENT_ID: "y", GITHUB_CLIENT_SECRET: "z" }), [{ id: "github", name: "GitHub" }]);
  assert.deepEqual(enabledProviders({}), []);
  assert.equal(providerConfig({ GOOGLE_CLIENT_ID: "x" }, "google"), null);
  assert.equal(providerConfig(ENV, "facebook"), null);
  assert.equal(providerConfig(ENV, "__proto__"), null);
});

test("authorization URLs: PKCE S256, state, nonce, redirect_uri, scopes and prompt per provider", () => {
  const verifier = "v".repeat(43);
  const expected = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(pkceChallenge(verifier), expected);
  // RFC 7636 appendix B.
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const read = (id, env = ENV) => new URL(authorizationUrl(env, id, { origin: ORIGIN, state: "st", verifier, nonce: "nn" }));
  const g = read("google");
  assert.equal(g.origin + g.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(g.searchParams.get("response_type"), "code");
  assert.equal(g.searchParams.get("client_id"), "g-client");
  assert.equal(g.searchParams.get("redirect_uri"), "https://colmena.example/auth/oauth/google/callback");
  assert.equal(g.searchParams.get("scope"), "openid email profile");
  assert.equal(g.searchParams.get("state"), "st");
  assert.equal(g.searchParams.get("nonce"), "nn");
  assert.equal(g.searchParams.get("code_challenge"), expected);
  assert.equal(g.searchParams.get("code_challenge_method"), "S256");
  assert.equal(g.searchParams.get("prompt"), "select_account");
  const m = read("microsoft");
  assert.equal(m.origin + m.pathname, "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  assert.equal(m.searchParams.get("redirect_uri"), "https://colmena.example/auth/oauth/microsoft/callback");
  assert.equal(m.searchParams.get("prompt"), "select_account");
  assert.equal(m.searchParams.get("nonce"), "nn");
  assert.equal(read("microsoft", { ...ENV, MICROSOFT_TENANT: WORK_TENANT }).pathname, `/${WORK_TENANT}/oauth2/v2.0/authorize`);
  const h = read("github");
  assert.equal(h.origin + h.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(h.searchParams.get("scope"), "read:user user:email");
  assert.equal(h.searchParams.get("code_challenge_method"), "S256");
  assert.equal(h.searchParams.get("nonce"), null, "no nonce for GitHub");
  assert.equal(h.searchParams.get("prompt"), null);
  assert.throws(() => authorizationUrl({}, "google", { origin: ORIGIN, state: "s", verifier, nonce: "n" }), OAuthError);
});

test("the binding cookie: host-only, HttpOnly, SameSite=Lax, 10 minutes; its own name on local HTTP", () => {
  const url = new URL(ORIGIN + "/auth/oauth/google");
  assert.equal(bindingCookie(url, "abc"), `${BINDING_COOKIE}=abc; Max-Age=600; Path=/; HttpOnly; SameSite=Lax; Secure`);
  assert.match(bindingCookie(url, null), /^__Host-colmena-oauth=; Max-Age=0/);
  const local = new URL("http://127.0.0.1:8790/auth/oauth/google");
  assert.equal(bindingCookie(local, "x"), `${LOCAL_BINDING_COOKIE}=x; Max-Age=600; Path=/; HttpOnly; SameSite=Lax`);
  assert.equal(bindingFromRequest(new Request(ORIGIN + "/auth/oauth/google/callback", { headers: { Cookie: `a=1; ${BINDING_COOKIE}=xyz` } })), "xyz");
});

test("OAuth state: single use, 10 minutes, same provider, same browser", () => {
  const { core, advance } = directory();
  const flow = core.startOAuth({ provider: "google", next: "/sala/x", ip: "203.0.113.4" });
  for (const k of ["state", "verifier", "nonce", "binding"]) assert.match(flow[k], /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(core.finishOAuth({ provider: "google", state: flow.state, binding: flow.binding }), { verifier: flow.verifier, nonce: flow.nonce, next: "/sala/x" });
  fails(() => core.finishOAuth({ provider: "google", state: flow.state, binding: flow.binding }), 410, "state");
  // Another browser (no or a different binding): refused, and the flow is used up.
  const csrf = core.startOAuth({ provider: "google" });
  fails(() => core.finishOAuth({ provider: "google", state: csrf.state, binding: core.startOAuth({ provider: "google" }).binding }), 403, "state");
  fails(() => core.finishOAuth({ provider: "google", state: csrf.state, binding: csrf.binding }), 410, "state");
  const nobinding = core.startOAuth({ provider: "github" });
  fails(() => core.finishOAuth({ provider: "github", state: nobinding.state, binding: "" }), 403, "state");
  const wrong = core.startOAuth({ provider: "microsoft" });
  fails(() => core.finishOAuth({ provider: "google", state: wrong.state, binding: wrong.binding }), 400, "state");
  const late = core.startOAuth({ provider: "github", next: "//evil.example" });
  assert.equal(late.next, "/");
  advance(LIMITS.oauthMs + 1);
  fails(() => core.finishOAuth({ provider: "github", state: late.state, binding: late.binding }), 410, "state");
  fails(() => core.finishOAuth({ provider: "github", state: "x".repeat(43), binding: late.binding }), 400, "state");
  fails(() => core.startOAuth({ provider: "facebook" }), 404, "provider");
  // Limited per IP like the links.
  for (let i = 0; i < LIMITS.oauthPerIp; i++) core.startOAuth({ provider: "google", ip: "198.51.100.9" });
  fails(() => core.startOAuth({ provider: "google", ip: "198.51.100.9" }), 429, "rate");
  core.sweep();
});

test("Google id_token claims: issuer, audience, expiry, iat, nonce and a verified email", () => {
  const opts = { clientId: "g-client", nonce: "n-1", now: NOW };
  assert.deepEqual(checkIdToken("google", google(), opts), { subject: "1001", email: "ana@example.com", emailVerified: true, name: "Ana" });
  assert.equal(checkIdToken("google", google({ iss: "accounts.google.com" }), opts).subject, "1001");
  assert.equal(checkIdToken("google", google({ aud: ["g-client", "other"], azp: "g-client" }), opts).subject, "1001");
  refused(() => checkIdToken("google", google({ iss: "https://evil.example" }), opts), "provider");
  refused(() => checkIdToken("google", google({ aud: "someone-else" }), opts), "provider");
  refused(() => checkIdToken("google", google({ aud: ["g-client", "other"], azp: "other" }), opts), "provider");
  refused(() => checkIdToken("google", google({ exp: SEC - 120 }), opts), "provider");
  assert.equal(checkIdToken("google", google({ exp: SEC - 10 }), opts).subject, "1001", "a little clock skew is fine");
  refused(() => checkIdToken("google", google({ iat: SEC + 3600 }), opts), "provider");
  refused(() => checkIdToken("google", google({ iat: undefined }), opts), "provider");
  refused(() => checkIdToken("google", google({ nonce: "n-2" }), opts), "provider");
  refused(() => checkIdToken("google", google(), { ...opts, nonce: "" }), "provider");
  refused(() => checkIdToken("google", google({ email_verified: false }), opts), "unverified");
  refused(() => checkIdToken("google", google({ email: undefined }), opts), "unverified");
  assert.deepEqual(decodeJwt(jwt({ a: 1 })).payload, { a: 1 });
  refused(() => decodeJwt("only.two"), "provider");
});

test("Microsoft: personal accounts are trusted, work tenants only with xms_edov", () => {
  const opts = { clientId: "m-client", nonce: "n-1", now: NOW };
  assert.deepEqual(checkIdToken("microsoft", microsoft(), opts), { subject: `${WORK_TENANT}:oid-9`, email: "beto@example.org", emailVerified: true, name: "Beto" });
  refused(() => checkIdToken("microsoft", microsoft({ xms_edov: undefined }), opts), "ms-email");
  refused(() => checkIdToken("microsoft", microsoft({ xms_edov: false }), opts), "ms-email");
  const consumer = microsoft({ tid: MICROSOFT_CONSUMER_TENANT, iss: `https://login.microsoftonline.com/${MICROSOFT_CONSUMER_TENANT}/v2.0`, xms_edov: undefined, oid: undefined, sub: "abc", email: "cora@example.com" });
  assert.deepEqual(checkIdToken("microsoft", consumer, opts), { subject: "abc", email: "cora@example.com", emailVerified: true, name: "Beto" });
  refused(() => checkIdToken("microsoft", microsoft({ iss: `https://login.microsoftonline.com/${MICROSOFT_CONSUMER_TENANT}/v2.0` }), opts), "provider");
  refused(() => checkIdToken("microsoft", microsoft({ iss: "https://sts.windows.net/x/" }), opts), "provider");
  refused(() => checkIdToken("microsoft", microsoft({ aud: "g-client" }), opts), "provider");
  refused(() => checkIdToken("microsoft", microsoft({ nonce: "x" }), opts), "provider");
  refused(() => checkIdToken("microsoft", microsoft({ exp: SEC - 3600 }), opts), "provider");
  // A configured tenant (or kind) narrows who may come in.
  refused(() => checkIdToken("microsoft", microsoft(), { ...opts, tenant: "consumers" }), "provider");
  refused(() => checkIdToken("microsoft", consumer, { ...opts, tenant: "organizations" }), "provider");
  refused(() => checkIdToken("microsoft", microsoft(), { ...opts, tenant: "99999999-2222-3333-4444-555555555555" }), "provider");
  assert.ok(checkIdToken("microsoft", microsoft(), { ...opts, tenant: WORK_TENANT }));
});

test("GitHub: only the primary address, and only if verified", () => {
  assert.equal(pickGithubEmail([{ email: "x@example.com", primary: false, verified: true }, { email: "Main@Example.com", primary: true, verified: true }]), "main@example.com");
  assert.equal(pickGithubEmail([{ email: "main@example.com", primary: true, verified: false }, { email: "x@example.com", primary: false, verified: true }]), null);
  assert.equal(pickGithubEmail([]), null);
  assert.equal(pickGithubEmail({ message: "Bad credentials" }), null);
});

/** A fake provider: records each request, answers by URL. */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const answer = routes[url];
    if (!answer) throw new Error("unexpected request to " + url);
    const [status, body] = typeof answer === "function" ? answer(init) : answer;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetchImpl, calls };
}

test("the callback exchange (Google): code + verifier for an id_token, then the person", async () => {
  const { fetchImpl, calls } = fakeFetch({ "https://oauth2.googleapis.com/token": [200, { access_token: "at", id_token: jwt(google()), token_type: "Bearer" }] });
  const who = await exchangeCode(ENV, "google", { code: "the-code", verifier: "ver", nonce: "n-1", origin: ORIGIN, fetchImpl, now: () => NOW });
  assert.deepEqual(who, { provider: "google", subject: "1001", email: "ana@example.com", emailVerified: true, name: "Ana" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.ok(calls[0].init.signal, "a timeout");
  const form = new URLSearchParams(calls[0].init.body);
  assert.deepEqual(Object.fromEntries(form), {
    grant_type: "authorization_code", code: "the-code", redirect_uri: "https://colmena.example/auth/oauth/google/callback",
    client_id: "g-client", client_secret: "g-secret", code_verifier: "ver",
  });
  // A wrong nonce, an error answer or no id_token: refused.
  await assert.rejects(exchangeCode(ENV, "google", { code: "c", verifier: "v", nonce: "other", origin: ORIGIN, fetchImpl, now: () => NOW }), (e) => e.code === "provider");
  const bad = fakeFetch({ "https://oauth2.googleapis.com/token": [400, { error: "invalid_grant" }] });
  await assert.rejects(exchangeCode(ENV, "google", { code: "c", verifier: "v", nonce: "n-1", origin: ORIGIN, fetchImpl: bad.fetchImpl, now: () => NOW }), (e) => e.code === "provider");
  const none = fakeFetch({ "https://oauth2.googleapis.com/token": [200, { access_token: "at" }] });
  await assert.rejects(exchangeCode(ENV, "google", { code: "c", verifier: "v", nonce: "n-1", origin: ORIGIN, fetchImpl: none.fetchImpl, now: () => NOW }), (e) => e.code === "provider");
  const down = async () => { throw new Error("network"); };
  await assert.rejects(exchangeCode(ENV, "google", { code: "c", verifier: "v", nonce: "n-1", origin: ORIGIN, fetchImpl: down, now: () => NOW }), (e) => e.code === "provider");
  await assert.rejects(exchangeCode(ENV, "google", { code: "", verifier: "v", nonce: "n-1", origin: ORIGIN, fetchImpl, now: () => NOW }), (e) => e.code === "provider");
});

test("the callback exchange (Microsoft): the tenant's token endpoint and the work-tenant rule", async () => {
  const env = { ...ENV, MICROSOFT_TENANT: "organizations" };
  const { fetchImpl, calls } = fakeFetch({ "https://login.microsoftonline.com/organizations/oauth2/v2.0/token": [200, { id_token: jwt(microsoft()) }] });
  const who = await exchangeCode(env, "microsoft", { code: "c", verifier: "v", nonce: "n-1", origin: ORIGIN, fetchImpl, now: () => NOW });
  assert.equal(who.subject, `${WORK_TENANT}:oid-9`);
  assert.equal(new URLSearchParams(calls[0].init.body).get("redirect_uri"), "https://colmena.example/auth/oauth/microsoft/callback");
  const noEdov = fakeFetch({ "https://login.microsoftonline.com/organizations/oauth2/v2.0/token": [200, { id_token: jwt(microsoft({ xms_edov: undefined })) }] });
  await assert.rejects(exchangeCode(env, "microsoft", { code: "c", verifier: "v", nonce: "n-1", origin: ORIGIN, fetchImpl: noEdov.fetchImpl, now: () => NOW }), (e) => e.code === "ms-email");
});

test("the callback exchange (GitHub): access token, then /user and /user/emails with a User-Agent", async () => {
  const routes = {
    "https://github.com/login/oauth/access_token": [200, { access_token: "gho_x", token_type: "bearer", scope: "read:user,user:email" }],
    "https://api.github.com/user": [200, { id: 4242, login: "cora", name: null }],
    "https://api.github.com/user/emails": [200, [{ email: "old@example.com", primary: false, verified: true }, { email: "cora@example.org", primary: true, verified: true }]],
  };
  const { fetchImpl, calls } = fakeFetch(routes);
  const who = await exchangeCode(ENV, "github", { code: "c", verifier: "v", origin: ORIGIN, fetchImpl });
  assert.deepEqual(who, { provider: "github", subject: "4242", email: "cora@example.org", emailVerified: true, name: "cora" });
  assert.equal(calls[0].init.headers.Accept, "application/json");
  assert.equal(new URLSearchParams(calls[0].init.body).get("code_verifier"), "v");
  for (const c of calls.slice(1)) {
    assert.equal(c.init.headers["User-Agent"], "Colmena");
    assert.equal(c.init.headers.Authorization, "Bearer gho_x");
  }
  // GitHub answers 200 with an error body for a bad code; an unverified primary is refused.
  const badCode = fakeFetch({ ...routes, "https://github.com/login/oauth/access_token": [200, { error: "bad_verification_code" }] });
  await assert.rejects(exchangeCode(ENV, "github", { code: "c", verifier: "v", origin: ORIGIN, fetchImpl: badCode.fetchImpl }), (e) => e.code === "provider");
  const unverified = fakeFetch({ ...routes, "https://api.github.com/user/emails": [200, [{ email: "cora@example.org", primary: true, verified: false }]] });
  await assert.rejects(exchangeCode(ENV, "github", { code: "c", verifier: "v", origin: ORIGIN, fetchImpl: unverified.fetchImpl }), (e) => e.code === "unverified");
});

test("the whole round trip on the directory: start, finish, exchange, sign in, linked by verified email", async () => {
  const { core } = directory();
  // Ana already has an account from a mail link.
  const link = core.requestLink({ email: "ana@example.com" });
  const ana = core.verifyLink({ token: link.token });
  const flow = core.startOAuth({ provider: "google", next: "/sala/1" });
  const back = core.finishOAuth({ provider: "google", state: flow.state, binding: flow.binding });
  const routes = { "https://oauth2.googleapis.com/token": (init) => {
    // The verifier the directory kept is the one whose challenge went to Google.
    assert.equal(new URLSearchParams(init.body).get("code_verifier"), flow.verifier);
    return [200, { id_token: jwt(google({ nonce: back.nonce })) }];
  } };
  const who = await exchangeCode(ENV, "google", { code: "c", verifier: back.verifier, nonce: back.nonce, origin: ORIGIN, fetchImpl: fakeFetch(routes).fetchImpl, now: () => NOW });
  const done = core.signInWith(who);
  assert.equal(done.user.id, ana.user.id, "the same person, by verified email");
  assert.equal(done.isNew, false);
  assert.equal(core.session(done.session.token).user.email, "ana@example.com");
  assert.equal(back.next, "/sala/1");
});
