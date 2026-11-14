// HTTP helpers of the hosted Worker: cookies, the session cookie, same-origin and CSRF checks,
// security headers. No Cloudflare import: tested in Node (tests/cloud-auth.test.mjs).
import { timingSafeEqual } from "node:crypto";

/** The session cookie: host-only, HTTPS only, invisible to scripts, sent on same-site navigation. */
export const SESSION_COOKIE = "__Host-colmena";
/** Plain-HTTP local runs (wrangler dev on 127.0.0.1) cannot keep a __Host- cookie. */
export const LOCAL_COOKIE = "colmena_local";

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    if (!name || name in out) continue;
    try { out[name] = decodeURIComponent(part.slice(at + 1).trim()); } catch { out[name] = part.slice(at + 1).trim(); }
  }
  return out;
}
const isLocal = (url) => url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
export const cookieName = (url) => (isLocal(url) ? LOCAL_COOKIE : SESSION_COOKIE);
export function sessionToken(request) {
  return parseCookies(request.headers.get("Cookie"))[cookieName(new URL(request.url))] || null;
}
/** Set-Cookie for a session token (`maxAgeMs` until it expires), or clearing it (token null). */
export function sessionCookie(url, token, maxAgeMs = 0) {
  const name = cookieName(url);
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", ...(isLocal(url) ? [] : ["Secure"])];
  if (!token) return `${name}=; Max-Age=0; ${attrs.join("; ")}`;
  return `${name}=${token}; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}; ${attrs.join("; ")}`;
}

/**
 * A request from this site's own pages: an Origin, when sent, is this origin; browsers that say
 * where it comes from (Sec-Fetch-Site) say same-origin. Writes must send an Origin.
 */
export function sameOrigin(request, { write = false } = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return false;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && !["same-origin", "none"].includes(site)) return false;
  if (write && !origin && site !== "same-origin") return false;
  return true;
}
export function sameSecret(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || !expected) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** Writes carry the session's CSRF token (X-Colmena-Token), on top of SameSite=Lax and the origin check. */
export const csrfOk = (request, csrf) => sameSecret(request.headers.get("X-Colmena-Token") || "", csrf);

export const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), geolocation=(), payment=()",
});
/** The pages' policy: everything from this origin; the live socket on this host. */
export function pagePolicy(url) {
  const ws = (url.protocol === "https:" ? "wss://" : "ws://") + url.host;
  return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; " +
    `connect-src 'self' ${ws}; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`;
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS, ...headers } });
export const fail = (status, error, extra = {}) => json({ error, ...extra }, status);
export function withHeaders(response, headers) {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}
