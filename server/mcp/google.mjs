// Colmena's own Google OAuth client (docs/GOOGLE-CLIENTE-COLMENA.md): one client for the whole
// product, created by the owner in Colmena's Google Cloud project, with sensitive or non-sensitive
// scopes only (Google's standard verification, never a restricted scope that would need a CASA
// assessment). Each person signs in with their own Google account; their tokens live in the vault
// under their own server record. Until the client exists the Google entries read «Disponible pronto».
//
// Two clients of the same project: a «Web application» one for the hosted app (redirect
// https://<site>/api/mcp/oauth/callback) and a «Desktop app» one for the desktop (loopback redirect
// on any port, which Google allows only for that client type).
//
//   COLMENA_GOOGLE_CLIENT_ID / COLMENA_GOOGLE_CLIENT_SECRET          web (Worker secrets)
//   COLMENA_GOOGLE_DESKTOP_CLIENT_ID / COLMENA_GOOGLE_DESKTOP_CLIENT_SECRET   desktop
//   COLMENA_GOOGLE_PROJECT                                         the project id (quota project)
import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_ENDPOINTS = Object.freeze({
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
});

// Scopes Colmena's client may ask for: sensitive or non-sensitive only (docs/CONNECTIONS.md ›
// «Permisos de Google»). A restricted scope (gmail.readonly/compose/modify, drive, drive.readonly,
// chat.messages.readonly, adwords) is refused here whatever an entry says.
export const RESTRICTED_SCOPES = new Set([
  "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.insert", "https://www.googleapis.com/auth/gmail.metadata", "https://mail.google.com/",
  "https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/chat.messages.readonly", "https://www.googleapis.com/auth/chat.messages", "https://www.googleapis.com/auth/adwords",
]);

const ID = /^[0-9A-Za-z._-]{8,200}$/;

/** The configured client for `kind` ("web" | "desktop") from an env-like object, or null. */
export function googleClient(env = process.env, kind = "web") {
  const pre = kind === "desktop" ? "COLMENA_GOOGLE_DESKTOP_CLIENT_" : "COLMENA_GOOGLE_CLIENT_";
  const clientId = String(env?.[pre + "ID"] || "").trim();
  const clientSecret = String(env?.[pre + "SECRET"] || "").trim();
  if (!ID.test(clientId) || !clientSecret) return null;
  return { clientId, clientSecret, project: String(env?.COLMENA_GOOGLE_PROJECT || "").trim() || null, kind };
}

/** PKCE (S256): a verifier kept with the state, its challenge in the authorize URL. */
export function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function checkScopes(scopes) {
  const bad = (scopes || []).find((s) => RESTRICTED_SCOPES.has(s));
  if (bad) throw Error("Ese permiso de Google es restringido (" + bad.split("/").pop() + "): Colmena no lo pide.");
  return scopes;
}

/** Where the person signs in: offline access (a refresh token) and the consent screen every time. */
export function authorizeUrl({ client, endpoints = GOOGLE_ENDPOINTS, redirect, scopes, state, challenge, loginHint = null }) {
  const u = new URL(endpoints.authorize);
  const q = {
    client_id: client.clientId, redirect_uri: redirect, response_type: "code", scope: ["openid", "email", ...checkScopes(scopes)].join(" "),
    state, code_challenge: challenge, code_challenge_method: "S256", access_type: "offline", prompt: "consent", include_granted_scopes: "true",
  };
  if (loginHint) q.login_hint = loginHint;
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return u.href;
}

async function tokenCall({ endpoints, body, fetchImpl }) {
  let res;
  try {
    res = await fetchImpl(endpoints.token, { method: "POST", redirect: "error", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(20000) });
  } catch { throw Error("Google no respondió. Inténtalo otra vez en un momento."); }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || !data.access_token) {
    const why = data.error === "invalid_grant" ? "Google ya no acepta ese permiso: vuelve a conectar la cuenta." : data.error_description || data.error || "error " + res.status;
    throw Object.assign(Error(String(why).slice(0, 200)), { code: data.error || "token_error" });
  }
  return data;
}

const stamp = (data, old = {}) => ({
  access_token: data.access_token,
  refresh_token: data.refresh_token || old.refresh_token || null,
  scope: data.scope || old.scope || "",
  expires_at: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
  token_type: "Bearer",
});

/** The code back from Google → {access_token, refresh_token, scope, expires_at}. */
export async function exchangeCode({ client, endpoints = GOOGLE_ENDPOINTS, code, verifier, redirect, fetchImpl = fetch }) {
  const data = await tokenCall({ endpoints, fetchImpl, body: { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirect, client_id: client.clientId, client_secret: client.clientSecret } });
  if (!data.refresh_token) throw Error("Google no devolvió un permiso duradero. Quita a Colmena en myaccount.google.com/permissions y vuelve a conectar.");
  return stamp(data);
}

/** A fresh access token from the refresh token (kept when Google sends none). */
export async function refreshTokens({ client, endpoints = GOOGLE_ENDPOINTS, tokens, fetchImpl = fetch }) {
  if (!tokens?.refresh_token) throw Object.assign(Error("Falta el permiso duradero de Google: vuelve a conectar."), { code: "invalid_grant" });
  const data = await tokenCall({ endpoints, fetchImpl, body: { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.clientId, client_secret: client.clientSecret } });
  return stamp(data, tokens);
}

/** Expired, or about to (two minutes). */
export const stale = (tokens, now = Date.now()) => !tokens?.access_token || !tokens.expires_at || tokens.expires_at - now < 120000;

/**
 * Application Default Credentials of type authorized_user, for Google's open-source servers
 * (Analytics, Ads): what `gcloud auth application-default login` writes, built from Colmena's
 * client and the person's refresh token. Never written outside the vault or the machine.
 */
export function adcFile(client, tokens) {
  if (!tokens?.refresh_token) throw Error("Falta el permiso duradero de Google: vuelve a conectar.");
  return { type: "authorized_user", client_id: client.clientId, client_secret: client.clientSecret, refresh_token: tokens.refresh_token, ...(client.project ? { quota_project_id: client.project } : {}) };
}

/** Best effort: tells Google to forget the grant when the person disconnects. */
export async function revoke({ endpoints = GOOGLE_ENDPOINTS, tokens, fetchImpl = fetch }) {
  const token = tokens?.refresh_token || tokens?.access_token;
  if (!token) return;
  try { await fetchImpl(endpoints.revoke, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString(), signal: AbortSignal.timeout(8000) }); } catch {}
}
