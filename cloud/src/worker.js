// Colmena hosted, Phase 1 (docs/CLOUD.md): the Worker `colmena-nube`.
//   /auth/*   sign-in by email link, sessions, companies, roles, invitations (the Directory DO)
//   /api/*    the signed-in person's company: its Workspace DO runs the desktop's server
//   /api/live that company's live channel (a hibernating WebSocket)
//   pages     the built UI (Workers static assets): the app for people signed in and in a
//             company; /entrar, /empresa and /invitacion (cloud.html) for everyone
// Secrets: WORKSPACE_KEYS (64 hex: the master of the per-workspace database keys),
// VAULT_MASTER_KEY (the master of the secrets' envelope encryption), ADMIN_BOOTSTRAP_TOKEN
// (reads the dev mail while there is no mail provider), RESEND_API_KEY (optional: real mail),
// GOOGLE_CLIENT_ID/SECRET, MICROSOFT_CLIENT_ID/SECRET (+ var MICROSOFT_TENANT), GITHUB_CLIENT_ID/
// SECRET (optional: each pair turns on «Continuar con …» on /entrar; cloud/src/oauth.js).
import { Directory } from "./directory.js";
import { Workspace } from "./workspace.js";
import { hasMail, sendMail } from "./mail.js";
import { OAuthError, authorizationUrl, bindingCookie, bindingFromRequest, enabledProviders, exchangeCode, providerConfig } from "./oauth.js";
import { SECURITY_HEADERS, csrfOk, fail, json, pagePolicy, sameOrigin, sameSecret, sessionCookie, sessionToken, withHeaders } from "./http.js";

export { Directory, Workspace };

const CLOUD_PAGES = /^\/(entrar|entrar\/verificar|empresa|empresa\/nueva|invitacion)\/?$/;
const ID = /^[0-9a-f-]{36}$/;
const namespace = (env, binding) => (env.JURISDICTION ? binding.jurisdiction(env.JURISDICTION) : binding);
const directoryStub = (env) => { const n = namespace(env, env.DIRECTORY); return n.get(n.idFromName("directory")); };
const workspaceStub = (env, id) => { const n = namespace(env, env.WORKSPACE); return n.get(n.idFromName("ws:" + id)); };

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
/** One directory operation by RPC; its errors come back as HttpError with their status. */
async function dir(env, method, ...args) {
  const r = await directoryStub(env).call(method, ...args);
  if (!r.ok) throw new HttpError(r.status || 500, r.error || "Error.", r.code ? { code: r.code } : {});
  return r.value;
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.message, error.extra);
      console.error("colmena-nube: " + (error?.stack || error));
      return fail(500, "Algo ha fallado. Prueba otra vez.");
    }
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === "/health") return json({ ok: true, service: "colmena-nube", phase: 1 });
  if (!env.WORKSPACE_KEYS) return fail(503, "Colmena en la nube no está configurada todavía.");
  if (url.pathname.startsWith("/auth/")) return auth(request, env, url, ctx);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return api(request, env, url);
  return page(request, env, url);
}

// ------------------------------------------------------------------ who is asking
/** The signed-in person, or null; `cookie`: the Set-Cookie a replaced (or dead) token needs. */
async function who(request, env, url) {
  const token = sessionToken(request);
  if (!token) return null;
  const s = await dir(env, "session", token);
  if (!s) return { cookie: sessionCookie(url, null) };
  return { ...s, token: s.rotated?.token || token, cookie: s.rotated ? sessionCookie(url, s.rotated.token, s.rotated.expiresAt - Date.now()) : null };
}
const finish = (response, me) => (me?.cookie ? withHeaders(response, { "Set-Cookie": me.cookie }) : response);
/** `origin`: an Origin header is required (a WebSocket: it cannot carry the CSRF header). */
async function must(request, env, url, { write = false, origin = false } = {}) {
  if (!sameOrigin(request, { write: write || origin })) throw new HttpError(403, "Petición externa no permitida.");
  const me = await who(request, env, url);
  if (!me?.user) throw new HttpError(401, "Inicia sesión.", { signIn: "/entrar" });
  if (write && !csrfOk(request, me.session.csrf)) throw new HttpError(403, "Tu sesión ha cambiado. Recarga la página.");
  return me;
}
async function body(request, max = 20000) {
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) throw new HttpError(415, "Se requiere JSON.");
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, "La petición es demasiado grande.");
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, "La petición no es un JSON válido."); }
}
const ipOf = (request) => request.headers.get("CF-Connecting-IP") || "local";
const personOf = (me) => ({ id: me.user.id, name: me.user.name, email: me.user.email, role: me.session.role });

/** The workspace's own list of people follows the directory's (and its name). */
async function syncWorkspace(env, workspaceId) {
  const [members, workspace] = await Promise.all([dir(env, "members", workspaceId), dir(env, "workspace", workspaceId)]);
  await workspaceStub(env, workspaceId).syncMembers(workspaceId, members, workspace?.name || null);
  return members;
}
async function mailOut(env, mail) {
  return sendMail(env, mail, { keep: (m) => dir(env, "keepDevMail", m) });
}
/** The company's own record of what its admins did (Workspace#audit); a failure never undoes the action. */
async function audit(env, workspaceId, me, action, target, details = {}) {
  try {
    await workspaceStub(env, workspaceId).audit(workspaceId, { actor: { id: me.user.id, name: me.user.name, email: me.user.email }, action, target, details });
  } catch (error) {
    console.error(`audit ${action}: ${error?.message || error}`);
  }
}
const personTarget = (members, id) => {
  const m = (members || []).find((x) => x.id === id);
  return { type: "person", id, name: m?.name || null, email: m?.email || null };
};
/** Syncs each company once; a failure is logged (the sign-in itself already happened). */
async function syncAll(env, ids) {
  for (const id of new Set(ids.filter(Boolean))) {
    try { await syncWorkspace(env, id); } catch (error) { console.error(`sync ${id}: ${error?.message || error}`); }
  }
}

// ------------------------------------------------------------------ /auth/oauth (Google, Microsoft, GitHub)
function redirect(to, cookies = []) {
  const headers = new Headers({ Location: to, "Cache-Control": "no-store", ...SECURITY_HEADERS });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}
/** GET /auth/oauth/:provider?next=/x → the provider, with the browser-binding cookie. */
async function oauthStart(request, env, url, id) {
  if (!providerConfig(env, id)) throw new HttpError(404, "No encontrado.");
  let flow;
  try {
    flow = await dir(env, "startOAuth", { provider: id, next: url.searchParams.get("next") || "/", ip: ipOf(request) });
  } catch (error) {
    if (error instanceof HttpError) return redirect("/entrar?error=" + (error.extra?.code === "rate" ? "rate" : "provider"));
    throw error;
  }
  const to = authorizationUrl(env, id, { origin: url.origin, state: flow.state, verifier: flow.verifier, nonce: flow.nonce });
  return redirect(to, [bindingCookie(url, flow.binding)]);
}
/**
 * GET /auth/oauth/:provider/callback?code&state: the flow (single use, same browser), the code for
 * who it is, the person, the session cookie as /auth/verify sets it. Any failure → /entrar?error=.
 */
async function oauthCallback(request, env, url, id) {
  if (!providerConfig(env, id)) throw new HttpError(404, "No encontrado.");
  const q = url.searchParams;
  const clear = bindingCookie(url, null);
  const back = (code, next = "/") => redirect("/entrar?error=" + code + (next && next !== "/" ? "&next=" + encodeURIComponent(next) : ""), [clear]);
  if (q.get("error")) return back(q.get("error") === "access_denied" ? "denied" : "provider");
  let flow;
  try {
    flow = await dir(env, "finishOAuth", { provider: id, state: q.get("state") || "", binding: bindingFromRequest(request) || "" });
  } catch (error) {
    if (error instanceof HttpError) return back("state");
    throw error;
  }
  let person;
  try {
    person = await exchangeCode(env, id, { code: q.get("code") || "", verifier: flow.verifier, nonce: flow.nonce, origin: url.origin, fetchImpl: (u, init) => fetch(u, init) });
  } catch (error) {
    if (!(error instanceof OAuthError)) throw error;
    console.error(`oauth ${id}: ${error.code}: ${error.message}`);
    return back(error.code, flow.next);
  }
  let done;
  try {
    done = await dir(env, "signInWith", { ...person, agent: request.headers.get("User-Agent") });
  } catch (error) {
    if (error instanceof HttpError) return back(error.extra?.code === "unverified" ? "unverified" : error.extra?.code === "rate" ? "rate" : "account", flow.next);
    throw error;
  }
  await syncAll(env, [...(done.joined || []), done.session.workspaceId]);
  const next = flow.next || "/";
  const to = next.startsWith("/invitacion") ? next : done.session.workspaceId ? next : "/empresa";
  return redirect(to, [sessionCookie(url, done.session.token, done.session.expiresAt - Date.now()), clear]);
}

// ------------------------------------------------------------------ /auth
async function auth(request, env, url) {
  const p = url.pathname, m = request.method;
  // Sign-in: a link by mail. The same answer whether or not the address has an account.
  if (p === "/auth/link" && m === "POST") {
    if (!sameOrigin(request, { write: true })) throw new HttpError(403, "Petición externa no permitida.");
    const data = await body(request);
    const link = await dir(env, "requestLink", { email: data.email, ip: ipOf(request), next: data.next });
    const sent = await mailOut(env, { to: link.email, kind: "signin", url: url.origin + "/entrar/verificar#t=" + link.token });
    return json({ ok: true, email: link.email, delivery: sent.sent ? "email" : "dev" }, 202);
  }
  if (p === "/auth/verify" && m === "POST") {
    if (!sameOrigin(request, { write: true })) throw new HttpError(403, "Petición externa no permitida.");
    const data = await body(request);
    const done = await dir(env, "verifyLink", { token: String(data.token || ""), agent: request.headers.get("User-Agent"), ip: ipOf(request) });
    await syncAll(env, [...(done.joined || []), done.session.workspaceId]);
    return json({ ok: true, user: done.user, next: done.next, isNew: done.isNew, workspaceId: done.session.workspaceId }, 200, { "Set-Cookie": sessionCookie(url, done.session.token, done.session.expiresAt - Date.now()) });
  }
  // Sign-in with Google, Microsoft or GitHub: which are configured, then the round trip.
  if (p === "/auth/providers" && m === "GET") {
    if (!sameOrigin(request)) throw new HttpError(403, "Petición externa no permitida.");
    return json({ providers: enabledProviders(env) });
  }
  const oauth = /^\/auth\/oauth\/([a-z]{2,20})(\/callback)?$/.exec(p);
  if (oauth && m === "GET") return oauth[2] ? oauthCallback(request, env, url, oauth[1]) : oauthStart(request, env, url, oauth[1]);
  // What an invitation shows before signing in (the token in the body, never in a URL).
  if (p === "/auth/invitations/preview" && m === "POST") {
    if (!sameOrigin(request, { write: true })) throw new HttpError(403, "Petición externa no permitida.");
    const data = await body(request);
    return json(await dir(env, "previewInvitation", String(data.token || "")));
  }
  // Dev mail (no provider yet): only for the holder of ADMIN_BOOTSTRAP_TOKEN.
  if (p === "/auth/dev/mail" && m === "GET") {
    const bearer = /^Bearer (\S+)$/.exec(request.headers.get("Authorization") || "")?.[1];
    if (hasMail(env) || !env.ADMIN_BOOTSTRAP_TOKEN || !sameSecret(bearer || "", env.ADMIN_BOOTSTRAP_TOKEN)) throw new HttpError(404, "No encontrado.");
    return json(await dir(env, "devMail", url.searchParams.get("email") || ""));
  }

  if (p === "/auth/me" && m === "GET") {
    if (!sameOrigin(request)) throw new HttpError(403, "Petición externa no permitida.");
    const me = await who(request, env, url);
    if (!me?.user) return finish(fail(401, "Inicia sesión.", { signIn: "/entrar" }), me);
    const workspaces = await dir(env, "workspacesOf", me.user.id);
    const current = workspaces.find((w) => w.id === me.session.workspaceId) || null;
    return finish(json({ user: me.user, workspaces, current, csrf: me.session.csrf, mail: hasMail(env) ? "email" : "dev" }), me);
  }
  const write = !["GET", "HEAD"].includes(m);
  const me = await must(request, env, url, { write });
  const reply = (data, status = 200) => finish(json(data, status), me);
  if (p === "/auth/me" && m === "PATCH") {
    const user = await dir(env, "rename", me.user.id, (await body(request)).name);
    for (const w of await dir(env, "workspacesOf", me.user.id)) await syncWorkspace(env, w.id);
    return reply({ user });
  }
  if (p === "/auth/logout" && m === "POST") {
    await dir(env, "logout", me.token);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(url, null) });
  }
  if (p === "/auth/workspaces" && m === "POST") {
    const created = await dir(env, "createWorkspace", me.user.id, (await body(request)).name);
    await dir(env, "selectWorkspace", me.token, created.id);
    await syncWorkspace(env, created.id);
    return reply({ workspace: created }, 201);
  }
  if (p === "/auth/workspaces/select" && m === "POST") {
    const { id } = await body(request);
    if (!ID.test(String(id || ""))) throw new HttpError(400, "Empresa no válida.");
    const chosen = await dir(env, "selectWorkspace", me.token, id);
    await syncWorkspace(env, id);
    return reply(chosen);
  }
  if (p === "/auth/invitations/accept" && m === "POST") {
    const accepted = await dir(env, "acceptInvitation", String((await body(request)).token || ""), me.user.id);
    await dir(env, "selectWorkspace", me.token, accepted.workspaceId);
    await syncWorkspace(env, accepted.workspaceId);
    return reply(accepted);
  }
  // Open invitations to my address (also imported ones, which carry no link), and taking one.
  if (p === "/auth/invitations/mine" && m === "GET") return reply({ invitations: await dir(env, "invitationsForEmail", me.user.id) });
  const mine = /^\/auth\/invitations\/([0-9a-f-]{36})\/accept$/.exec(p);
  if (mine && m === "POST") {
    const accepted = await dir(env, "acceptInvitationById", mine[1], me.user.id);
    await dir(env, "selectWorkspace", me.token, accepted.workspaceId);
    await syncWorkspace(env, accepted.workspaceId);
    return reply(accepted);
  }

  // ---- the current company (owners and admins manage it; everyone sees who is in it)
  const workspaceId = me.session.workspaceId;
  if (!workspaceId) throw new HttpError(409, "Elige una empresa.", { choose: "/empresa" });
  const role = me.session.role;
  if (p === "/auth/workspace" && m === "GET") {
    const [workspace, members] = await Promise.all([dir(env, "workspace", workspaceId), dir(env, "members", workspaceId)]);
    const invitations = ["owner", "admin"].includes(role) ? await dir(env, "invitations", workspaceId, me.user.id) : [];
    return reply({ workspace, role, me: me.user, members, invitations });
  }
  if (p === "/auth/workspace" && m === "PATCH") {
    const workspace = await dir(env, "renameWorkspace", workspaceId, me.user.id, (await body(request)).name);
    await syncWorkspace(env, workspaceId);
    await audit(env, workspaceId, me, "rename", { type: "workspace", id: workspaceId }, { name: workspace?.name || null });
    return reply({ workspace });
  }
  if (p === "/auth/workspace/domains" && m === "PUT") {
    const workspace = await dir(env, "setDomains", workspaceId, me.user.id, (await body(request)).domains);
    await audit(env, workspaceId, me, "domains", { type: "workspace", id: workspaceId }, { domains: workspace?.domains || [] });
    return reply({ workspace });
  }
  if (p === "/auth/workspace/invitations" && m === "POST") {
    const data = await body(request);
    const made = await dir(env, "invite", workspaceId, me.user.id, { email: data.email, role: data.role || "member" });
    const link = url.origin + "/invitacion#t=" + made.token;
    const workspace = await dir(env, "workspace", workspaceId);
    const sent = await mailOut(env, { to: made.invitation.email, kind: "invite", url: link, workspace: workspace?.name, inviter: me.user.name });
    await audit(env, workspaceId, me, "invite", { type: "invitation", id: made.invitation.id, email: made.invitation.email }, { role: made.invitation.role });
    // Whoever invites may pass the link on themselves: it only works for that address, signed in.
    return reply({ invitation: made.invitation, link, delivery: sent.sent ? "email" : "dev" }, 201);
  }
  // People from an import (a Slack export): invitations without mail or link, up to 5000 at once.
  if (p === "/auth/workspace/invitations/import" && m === "POST") {
    const result = await dir(env, "importInvitations", workspaceId, me.user.id, (await body(request, 2_000_000)).people);
    await audit(env, workspaceId, me, "invitations.import", { type: "workspace", id: workspaceId }, { created: result.created, existing: result.existing, skipped: result.skipped });
    return reply(result);
  }
  let r = /^\/auth\/workspace\/invitations\/([0-9a-f-]{36})$/.exec(p);
  if (r && m === "DELETE") {
    const revoked = await dir(env, "revokeInvitation", workspaceId, me.user.id, r[1]);
    await audit(env, workspaceId, me, "invitation.revoke", { type: "invitation", id: r[1] });
    return reply(revoked);
  }
  r = /^\/auth\/workspace\/members\/([0-9a-f-]{36})\/(deactivate|reactivate)$/.exec(p);
  if (r && m === "POST") {
    const deactivate = r[2] === "deactivate";
    const done = await dir(env, deactivate ? "deactivateMember" : "reactivateMember", workspaceId, me.user.id, r[1]);
    const members = await syncWorkspace(env, workspaceId);
    if (deactivate) await workspaceStub(env, workspaceId).revokePerson(workspaceId, r[1]);
    await audit(env, workspaceId, me, r[2], personTarget(members, r[1]));
    return reply(done);
  }
  r = /^\/auth\/workspace\/members\/([0-9a-f-]{36})$/.exec(p);
  if (r && m === "PATCH") {
    const changed = await dir(env, "setRole", workspaceId, me.user.id, r[1], String((await body(request)).role || ""));
    const members = await syncWorkspace(env, workspaceId);
    await audit(env, workspaceId, me, "role", personTarget(members, r[1]), { role: changed.role });
    return reply(changed);
  }
  if (r && m === "DELETE") {
    const before = await dir(env, "members", workspaceId);
    const removed = await dir(env, "removeMember", workspaceId, me.user.id, r[1]);
    await syncWorkspace(env, workspaceId);
    await workspaceStub(env, workspaceId).revokePerson(workspaceId, r[1]);
    await audit(env, workspaceId, me, "remove", personTarget(before, r[1]));
    return reply(removed);
  }
  if (p === "/auth/workspace/leave" && m === "POST") {
    const removed = await dir(env, "removeMember", workspaceId, me.user.id, me.user.id);
    await syncWorkspace(env, workspaceId);
    await workspaceStub(env, workspaceId).revokePerson(workspaceId, me.user.id);
    return json(removed, 200, { "Set-Cookie": sessionCookie(url, null) });
  }
  throw new HttpError(404, "No encontrado.");
}

// ------------------------------------------------------------------ /api → the company's object
async function api(request, env, url) {
  const write = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const live = url.pathname === "/api/live";
  const me = await must(request, env, url, { write, origin: live });
  if (url.pathname === "/api/bootstrap") return finish(json({ csrf: me.session.csrf }), me);
  const workspaceId = me.session.workspaceId;
  if (!workspaceId) return finish(fail(409, "Elige una empresa.", { choose: "/empresa" }), me);
  const headers = new Headers(request.headers);
  // Only the Worker says who is asking: whatever a browser sent under these names goes.
  for (const name of [...headers.keys()]) if (name.toLowerCase().startsWith("x-colmena-") && name.toLowerCase() !== "x-colmena-token") headers.delete(name);
  headers.delete("Cookie");
  headers.set("X-Colmena-Workspace", workspaceId);
  headers.set("X-Colmena-Person", JSON.stringify(personOf(me)));
  const response = await workspaceStub(env, workspaceId).fetch(new Request(request, { headers }));
  return live ? response : finish(response, me);
}

// ------------------------------------------------------------------ pages
async function page(request, env, url) {
  if (!["GET", "HEAD"].includes(request.method)) return fail(405, "Método no permitido.");
  const p = url.pathname;
  // Files of the build (scripts, styles, fonts, images): public, cached by the platform.
  if (/\/[^/]+\.[A-Za-z0-9]{1,8}$/.test(p) && !/\.html?$/i.test(p)) return env.ASSETS.fetch(request);
  const headers = { ...SECURITY_HEADERS, "Content-Security-Policy": pagePolicy(url), "Cache-Control": "no-store" };
  const asset = (name) => env.ASSETS.fetch(new Request(new URL(name, url), { headers: request.headers }));
  if (CLOUD_PAGES.test(p)) return withHeaders(await asset("/cloud.html"), headers);
  const me = await who(request, env, url);
  const go = (to) => finish(new Response(null, { status: 302, headers: { Location: to, ...SECURITY_HEADERS } }), me);
  if (!me?.user) return go("/entrar" + (p === "/" ? "" : "?next=" + encodeURIComponent(p + url.search)));
  if (!me.session.workspaceId) return go("/empresa");
  // The app, marked as hosted (src/lib/cloud.js reads the mark).
  const app = new HTMLRewriter().on("head", { element(e) { e.append('<meta name="colmena-host" content="cloud">', { html: true }); } }).transform(await asset("/index.html"));
  return finish(withHeaders(app, headers), me);
}
