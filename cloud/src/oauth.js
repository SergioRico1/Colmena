// Sign-in with Google, Microsoft and GitHub (docs/CLOUD.md › Phase 1 › Sign-in with Google,
// Microsoft and GitHub): the authorization code flow with PKCE (S256), a single-use `state` kept
// hashed in the directory (directory-core.js › startOAuth / finishOAuth), an OIDC `nonce` for
// Google and Microsoft, and a browser-binding cookie so a callback finished in another browser
// (login CSRF) fails. No Cloudflare import: the Worker passes its `fetch` in and the tests a fake
// (tests/cloud-oauth.test.mjs).
//
// The id_token comes straight from the provider's token endpoint over TLS, so its signature is
// not verified (OIDC Core 3.1.3.7, point 6); its claims are: iss, aud, exp, iat and nonce, and the
// email must be one the provider says is verified. Outgoing requests only go to the fixed URLs
// below, with a timeout. Tokens never go into URLs or logs.
import { createHash } from "node:crypto";
import { parseCookies } from "./http.js";

/** Microsoft's tenant of personal accounts (outlook.com, hotmail.com…): their email is the account. */
export const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const TIMEOUT_MS = 10000;
const SKEW_S = 60;

export const PROVIDERS = Object.freeze({
  google: Object.freeze({
    name: "Google",
    oidc: true,
    authorize: () => "https://accounts.google.com/o/oauth2/v2/auth",
    token: () => "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    prompt: "select_account",
    id: "GOOGLE_CLIENT_ID",
    secret: "GOOGLE_CLIENT_SECRET",
  }),
  microsoft: Object.freeze({
    name: "Microsoft",
    oidc: true,
    authorize: (env) => `https://login.microsoftonline.com/${microsoftTenant(env)}/oauth2/v2.0/authorize`,
    token: (env) => `https://login.microsoftonline.com/${microsoftTenant(env)}/oauth2/v2.0/token`,
    scope: "openid email profile",
    prompt: "select_account",
    id: "MICROSOFT_CLIENT_ID",
    secret: "MICROSOFT_CLIENT_SECRET",
  }),
  github: Object.freeze({
    name: "GitHub",
    oidc: false,
    authorize: () => "https://github.com/login/oauth/authorize",
    token: () => "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    prompt: null,
    id: "GITHUB_CLIENT_ID",
    secret: "GITHUB_CLIENT_SECRET",
  }),
});
const GITHUB_API = "https://api.github.com";

/** A failed sign-in: `code` goes to /entrar?error=<code> (never the details). */
export class OAuthError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

/** `common` unless MICROSOFT_TENANT names one (a tenant GUID, `organizations` or `consumers`). */
export function microsoftTenant(env) {
  const t = String(env?.MICROSOFT_TENANT || "common").trim();
  return /^[A-Za-z0-9.-]{1,80}$/.test(t) ? t : "common";
}

/** The providers configured with both a client id and a secret, in a fixed order. */
export function enabledProviders(env) {
  return Object.entries(PROVIDERS).filter(([, p]) => env?.[p.id] && env?.[p.secret]).map(([id, p]) => ({ id, name: p.name }));
}
/** The provider and its credentials, or null when unknown or not configured. */
export function providerConfig(env, id) {
  if (!Object.hasOwn(PROVIDERS, id)) return null;
  const p = PROVIDERS[id];
  if (!env?.[p.id] || !env?.[p.secret]) return null;
  return { ...p, key: id, clientId: String(env[p.id]), clientSecret: String(env[p.secret]), authorizeUrl: p.authorize(env), tokenUrl: p.token(env) };
}

export const redirectUri = (origin, id) => `${origin}/auth/oauth/${id}/callback`;
const b64url = (buf) => Buffer.from(buf).toString("base64url");
/** PKCE S256: BASE64URL(SHA-256(verifier)). */
export const pkceChallenge = (verifier) => b64url(createHash("sha256").update(String(verifier), "ascii").digest());

/** Where the browser goes to sign in with `id`. */
export function authorizationUrl(env, id, { origin, state, verifier, nonce }) {
  const p = providerConfig(env, id);
  if (!p) throw new OAuthError("provider", "Proveedor no disponible.");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: redirectUri(origin, id),
    scope: p.scope,
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
  });
  if (p.oidc) q.set("nonce", nonce);
  if (p.prompt) q.set("prompt", p.prompt);
  if (id === "github") q.set("allow_signup", "true");
  return `${p.authorizeUrl}?${q}`;
}

// ------------------------------------------------------------------ the binding cookie
/** The browser that started a sign-in holds this random value; the callback must bring it back. */
export const BINDING_COOKIE = "__Host-colmena-oauth";
export const LOCAL_BINDING_COOKIE = "colmena_oauth";
const isLocal = (url) => url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
export const bindingCookieName = (url) => (isLocal(url) ? LOCAL_BINDING_COOKIE : BINDING_COOKIE);
/** Set-Cookie for the binding (10 minutes), or clearing it (value null). */
export function bindingCookie(url, value) {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", ...(isLocal(url) ? [] : ["Secure"])].join("; ");
  return value ? `${bindingCookieName(url)}=${value}; Max-Age=600; ${attrs}` : `${bindingCookieName(url)}=; Max-Age=0; ${attrs}`;
}
export function bindingFromRequest(request) {
  return parseCookies(request.headers.get("Cookie"))[bindingCookieName(new URL(request.url))] || null;
}

// ------------------------------------------------------------------ id_token
/** header.payload.signature → {header, payload}; the signature is not checked (see the top). */
export function decodeJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new OAuthError("provider", "id_token mal formado.");
  try {
    return { header: JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")), payload: JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) };
  } catch {
    throw new OAuthError("provider", "id_token mal formado.");
  }
}
const truthy = (v) => v === true || v === "true" || v === 1 || v === "1";

/**
 * The claims of an id_token from `provider` → {subject, email, emailVerified, name}. Throws
 * OAuthError: `provider` for a token that is not for us (iss, aud, exp, iat, nonce), `unverified`
 * or `ms-email` when the email is not one the provider vouches for.
 */
export function checkIdToken(provider, claims, { clientId, nonce, now = Date.now(), tenant = "common" }) {
  const c = claims || {};
  const t = Math.floor(now / 1000);
  if (provider === "google") {
    if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") throw new OAuthError("provider", "Emisor no válido.");
  } else if (provider === "microsoft") {
    if (typeof c.tid !== "string" || !/^[0-9a-f-]{36}$/i.test(c.tid) || c.iss !== `https://login.microsoftonline.com/${c.tid}/v2.0`) throw new OAuthError("provider", "Emisor no válido.");
    const tn = String(tenant || "common").toLowerCase();
    if (tn === "consumers" && c.tid !== MICROSOFT_CONSUMER_TENANT) throw new OAuthError("provider", "Inquilino no válido.");
    if (tn === "organizations" && c.tid === MICROSOFT_CONSUMER_TENANT) throw new OAuthError("provider", "Inquilino no válido.");
    if (/^[0-9a-f-]{36}$/.test(tn) && c.tid.toLowerCase() !== tn) throw new OAuthError("provider", "Inquilino no válido.");
  } else throw new OAuthError("provider", "Proveedor no válido.");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(clientId)) throw new OAuthError("provider", "Audiencia no válida.");
  if (aud.length > 1 && c.azp !== clientId) throw new OAuthError("provider", "Audiencia no válida.");
  if (typeof c.exp !== "number" || c.exp + SKEW_S <= t) throw new OAuthError("provider", "id_token caducado.");
  if (typeof c.iat !== "number" || c.iat > t + 5 * 60 || c.iat < t - 24 * 3600) throw new OAuthError("provider", "id_token con fecha no válida.");
  if (!nonce || c.nonce !== nonce) throw new OAuthError("provider", "nonce no válido.");
  const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
  if (provider === "google") {
    if (!c.sub) throw new OAuthError("provider", "Sin sujeto.");
    if (!email || !truthy(c.email_verified)) throw new OAuthError("unverified", "Google no confirma ese correo.");
    return { subject: String(c.sub), email, emailVerified: true, name: typeof c.name === "string" ? c.name : null };
  }
  // Microsoft: the email of a personal account is the account; a work tenant's `email` is only
  // trusted with the optional claim xms_edov («email domain owner verified») set to true.
  const subject = c.oid ? `${c.tid}:${c.oid}` : c.sub ? String(c.sub) : null;
  if (!subject) throw new OAuthError("provider", "Sin sujeto.");
  if (!email || !(c.tid === MICROSOFT_CONSUMER_TENANT || truthy(c.xms_edov))) throw new OAuthError("ms-email", "Microsoft no confirma ese correo.");
  return { subject, email, emailVerified: true, name: typeof c.name === "string" ? c.name : null };
}

/** GitHub's /user/emails → the primary address, only if verified; else null. */
export function pickGithubEmail(emails) {
  if (!Array.isArray(emails)) return null;
  const primary = emails.find((e) => e && e.primary === true && e.verified === true && typeof e.email === "string");
  return primary ? primary.email.trim().toLowerCase() : null;
}

// ------------------------------------------------------------------ the exchange
async function call(fetchImpl, url, init, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new OAuthError("provider", "El proveedor no responde.");
  }
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || !data || typeof data !== "object") throw new OAuthError("provider", `El proveedor respondió ${response.status}.`);
  return data;
}

/**
 * The callback's `code` → who signed in: {provider, subject, email, emailVerified, name}.
 * `verifier` and `nonce` come from the directory (finishOAuth). `fetchImpl`: the Worker's fetch.
 */
export async function exchangeCode(env, id, { code, verifier, nonce, origin, fetchImpl, now = () => Date.now(), timeoutMs = TIMEOUT_MS }) {
  const p = providerConfig(env, id);
  if (!p) throw new OAuthError("provider", "Proveedor no disponible.");
  if (typeof code !== "string" || !code || code.length > 2048) throw new OAuthError("provider", "Falta el código.");
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(origin, id),
    client_id: p.clientId,
    client_secret: p.clientSecret,
    code_verifier: verifier,
  });
  const tokens = await call(fetchImpl, p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
  }, timeoutMs);
  if (tokens.error) throw new OAuthError("provider", "El proveedor rechazó el código.");
  if (p.oidc) {
    if (typeof tokens.id_token !== "string") throw new OAuthError("provider", "Falta el id_token.");
    const { payload } = decodeJwt(tokens.id_token);
    return { provider: id, ...checkIdToken(id, payload, { clientId: p.clientId, nonce, now: now(), tenant: microsoftTenant(env) }) };
  }
  // GitHub: an access token, then who it is and which of their addresses is primary and verified.
  if (typeof tokens.access_token !== "string" || !tokens.access_token) throw new OAuthError("provider", "Falta el token de acceso.");
  const headers = { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "Colmena", "X-GitHub-Api-Version": "2022-11-28" };
  const user = await call(fetchImpl, `${GITHUB_API}/user`, { headers }, timeoutMs);
  if (user.id === undefined || user.id === null) throw new OAuthError("provider", "GitHub no devolvió la cuenta.");
  const emails = await call(fetchImpl, `${GITHUB_API}/user/emails`, { headers }, timeoutMs);
  const email = pickGithubEmail(emails);
  if (!email) throw new OAuthError("unverified", "GitHub no tiene un correo principal verificado.");
  return { provider: id, subject: String(user.id), email, emailVerified: true, name: typeof user.name === "string" && user.name ? user.name : typeof user.login === "string" ? user.login : null };
}
