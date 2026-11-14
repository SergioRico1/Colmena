// MCP connections (OpenClaw «mcp.servers»): remote MCP servers the person connects with one
// click. Colmena registers itself with the service (OAuth dynamic client registration + PKCE),
// the sign-in happens in the system browser and comes back to a loopback address only this
// connection listens on. Tokens live in the Windows DPAPI store, never in SQLite.
//
// Records (SQLite, kind 'mcpServers'): {id, name, url, catalogId, auth, run, owner, account,
// status, tools:[…], toolsAt, error, createdAt, connectedAt}. status: 'connecting' | 'connected' |
// 'needs_auth' | 'error'. auth (docs/CONNECTIONS.md › Marketplace): 'oauth' (dynamic client
// registration, the default of older records), 'token' (a pasted key in a header), 'google'
// (Colmena's own Google client, ./google.mjs), 'mail' (IMAP/SMTP, ./mail.mjs). run: 'remote',
// 'local' (an official open-source server through the process seam, ./local.mjs) or 'builtin'.
// owner: null = the company's (everyone's bots use it); a person's id = theirs alone (hosted
// workspaces): only that person sees it, and only their bots' turns get it.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { now } from "../store.mjs";
import { validateWebUrl } from "../web.mjs";
import { windowsVault } from "../nexo/credential-vault.mjs";
import { catalogEntry } from "./catalog.mjs";
import { currentPerson, isPerson } from "../identity.mjs";
import { GOOGLE_ENDPOINTS, adcFile, authorizeUrl as googleAuthorizeUrl, exchangeCode, pkce, refreshTokens, revoke as googleRevoke, stale } from "./google.mjs";
import { LocalMcpHost } from "./local.mjs";
import { MailConnector, mailSettings, nodeTcp } from "./mail.mjs";
import { localMachine } from "../machine/seam.mjs";

const AUTH_WINDOW_MS = 10 * 60000;
const CALL_TIMEOUT_MS = 120000;
const MAX_TOOLS = 200;
const clip = (t, n) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const binding = (id) => ({ profile: "mcp-" + id, hostId: os.hostname() || "local", clientId: "colmena-mcp", subject: "local" });

export const serverView = (s, me = currentPerson()) => ({
  id: s.id, name: s.name, url: s.auth === "mail" ? null : s.url, catalogId: s.catalogId || null, status: s.status, error: s.error || null,
  auth: s.auth || "oauth", run: s.run || "remote", scope: s.owner ? "mine" : "company", mine: !!s.owner && s.owner === me?.id, account: s.account || null,
  toolCount: (s.tools || []).length, createdAt: s.createdAt || null, connectedAt: s.connectedAt || null,
});
const MANAGERS = new Set(["owner", "admin"]);
const TOKEN = /^[\x21-\x7e]{8,4000}$/;
const unauthorized = (error) => error instanceof UnauthorizedError || error?.name === "UnauthorizedError" || /\b401\b|unauthori[sz]ed|invalid_token/i.test(String(error?.message || ""));

/** Short id for a server: «Jira y Confluence» → jira-y-confluence (unique). */
function slugFor(name, taken) {
  const base = String(name || "mcp").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "mcp";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = base + "-" + n;
  return id;
}

/** OAuth state for one server; the SDK drives discovery, registration, PKCE and refresh. */
class Provider {
  constructor(hub, id, { redirect = null, state = null } = {}) {
    Object.assign(this, { hub, id, redirect, stateValue: state, verifier: null, authorizeUrl: null });
  }
  get redirectUrl() { return this.redirect || this.hub.cachedSecret(this.id)?.redirect || undefined; }
  get clientMetadata() {
    return {
      client_name: "Colmena", client_uri: "https://colmena.app",
      redirect_uris: [this.redirectUrl || "http://127.0.0.1/callback"],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
    };
  }
  state() { return this.stateValue || randomBytes(16).toString("hex"); }
  async clientInformation() { return (await this.hub.secret(this.id))?.client; }
  async saveClientInformation(client) { await this.hub.saveSecret(this.id, { client, redirect: this.redirectUrl }); }
  async tokens() { return (await this.hub.secret(this.id))?.tokens; }
  async saveTokens(tokens) { await this.hub.saveSecret(this.id, { tokens }); }
  redirectToAuthorization(url) { this.authorizeUrl = url.href; }
  saveCodeVerifier(v) {
    this.verifier = v;
    // A public redirect (the cloud) may come back to another wake-up of the server: kept with the state.
    if (this.hub.redirect && this.stateValue) return this.hub.saveSecret(this.id, { pending: { state: this.stateValue, verifier: v, at: Date.now() } });
  }
  codeVerifier() { if (!this.verifier) throw Error("Falta el verificador de la autorización."); return this.verifier; }
  async invalidateCredentials(scope) {
    if (scope === "all") await this.hub.saveSecret(this.id, { client: null, tokens: null }, true);
    else if (scope === "client") await this.hub.saveSecret(this.id, { client: null });
    else if (scope === "tokens") await this.hub.saveSecret(this.id, { tokens: null });
  }
}

export class McpHub {
  /** `secrets` = {load(binding), save(binding, data), remove(profile)} (DPAPI; tests pass one in memory). */
  /**
   * `redirect`: a public callback URL (the cloud: https://<site>/api/mcp/oauth/callback) instead of
   * a loopback listener per sign-in; the browser comes back there and the host calls publicCallback.
   */
  /**
   * Marketplace options: `google` {web, desktop, endpoints, fetchImpl} (./google.mjs; without a client
   * the Google entries read «Disponible pronto»); `local` the host of official local servers (desktop:
   * a LocalMcpHost on this computer; cloud: machineMcp of the company's machine; null = none);
   * `localCommand(entry)` → {command, args}; `tcp` the TCP seam for mail (./mail.mjs);
   * `personal(personId)` whether that person keeps their apps to themselves («Mis propias apps»);
   * `allowPlain` tests only (plain IMAP/SMTP on loopback).
   */
  constructor(store, { secrets, transports = null, onChange = null, redirect = null, google = null, local = undefined, localCommand = null, tcp = null, personal = () => false, allowPlain = false } = {}) {
    this.redirect = redirect;
    this.google = google;
    this.local = local === undefined ? new LocalMcpHost({ spawn: localMachine.spawn, dir: path.join(store.directory || os.tmpdir(), "mcp-run") }) : local;
    this.localCommand = localCommand || ((e) => ({ command: "pipx", args: ["run", "--spec", e.local.package + "==" + e.local.version, e.local.command] }));
    this.tcp = tcp || nodeTcp({ allowPlain });
    this.personal = personal;
    this.allowPlain = allowPlain;
    this.store = store;
    this.secrets = secrets === undefined ? windowsVault(path.join(store.directory, "mcp")) : secrets;
    this.transports = transports; // tests: (url, provider) => transport
    this.onChange = onChange;
    this.live = new Map(); // id → {client, transport}
    this.pending = new Map(); // id → {server, provider, state, timer}
    this.cache = new Map(); // id → secret (in memory while running)
    // An action cut by a close may or may not have happened: never repeated on its own.
    for (const a of store.list("approvals"))
      if (a.tool === "mcp_call" && a.status === "executing")
        store.patch("approvals", a.id, { status: "executed", result: { ok: false, uncertain: true, error: "Colmena se cerró durante la acción. Comprueba el resultado en la app; no se repetirá." } });
    // Sign-ins left half-way when Colmena closed have nothing to come back to.
    if (!redirect) for (const s of store.list("mcpServers")) if (["connecting", "needs_auth"].includes(s.status) && !(s.tools || []).length) store.patch("mcpServers", s.id, { status: "error", error: "La autorización no se completó. Vuelve a conectar." });
  }
  get available() { return !!this.secrets; }
  /** Colmena's Google client for this place (the web one with a public redirect, else the desktop one). */
  googleClient() { return (this.redirect ? this.google?.web : this.google?.desktop) || null; }
  /** A record the person acting may see: the company's, or their own. Never someone else's. */
  visible(s, me = currentPerson()) { return !s.owner || (!!me?.id && s.owner === me.id); }
  servers() { return this.store.list("mcpServers").filter((s) => this.visible(s)).map((s) => serverView(s)).sort((a, b) => a.name.localeCompare(b.name, "es")); }
  connected() { return this.store.list("mcpServers").filter((s) => s.status === "connected" && this.visible(s)); }
  server(id) {
    const s = this.store.get("mcpServers", id);
    if (!s || !this.visible(s)) throw Object.assign(Error("Esa conexión ya no existe."), { status: 404 });
    return s;
  }
  /**
   * Whose a new connection is: nobody's on the desktop; the person's own for apps that are always
   * personal, when they ask for it or keep their apps to themselves; the company's when an owner or
   * admin connects it for everyone (members never connect for the whole company).
   */
  ownerFor(entry, scope = null) {
    const me = currentPerson();
    if (!isPerson(me)) return null;
    if (me.role === "guest") throw Object.assign(Error("Los invitados no conectan apps."), { status: 403 });
    if (entry?.perPerson || scope === "mine") return me.id;
    if (scope === "company") {
      if (!MANAGERS.has(me.role)) throw Object.assign(Error("Solo quien administra la empresa conecta apps para todos."), { status: 403 });
      return null;
    }
    return this.personal(me.id) || !MANAGERS.has(me.role) ? me.id : null;
  }
  /** The record for an entry (or an address) and owner: the existing one, or a new one. */
  record(entry, owner, { url, name = null, account = null }) {
    const existing = this.store.list("mcpServers").find((s) => (s.owner || null) === owner && (entry ? s.catalogId === entry.id && (s.account || null) === account : s.url === url));
    if (existing) return existing;
    const base = entry?.auth === "mail" ? "correo " + account.split("@")[0] : (entry?.name || name || "mcp") + (account ? " " + account.split("@")[0] : "");
    const id = slugFor(base, new Set(this.store.list("mcpServers").map((s) => s.id)));
    return this.store.put("mcpServers", { id, name: entry ? (account ? entry.name + " · " + account : entry.name) : clip(name, 60) || "MCP", url, catalogId: entry?.id || null, auth: entry?.auth || "oauth", run: entry?.run || "remote", owner, account, status: "connecting", tools: [], createdAt: now() });
  }
  cachedSecret(id) { return this.cache.get(id) || null; }
  async secret(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const data = this.secrets ? (await this.secrets.load(binding(id))) || {} : {};
    this.cache.set(id, data);
    return data;
  }
  async saveSecret(id, changes, replace = false) {
    const next = replace ? { ...changes } : { ...(await this.secret(id)), ...changes };
    this.cache.set(id, next);
    if (this.secrets) await this.secrets.save(binding(id), next);
  }
  patch(id, changes) {
    const s = this.store.patch("mcpServers", id, changes);
    this.onChange?.(s);
    return s;
  }
  tokenHeaders(s, token) {
    if (!token) throw Error("Falta la clave de " + s.name + ": vuelve a conectarlo.");
    const spec = catalogEntry(s.catalogId)?.token || { header: "Authorization", scheme: "Bearer" };
    return { [spec.header]: (spec.scheme ? spec.scheme + " " : "") + token };
  }
  headerTransport(url, headers, kind = "http") {
    if (this.transports) return this.transports(url, null, kind, headers);
    const requestInit = { headers };
    return kind === "sse" ? new SSEClientTransport(new URL(url), { requestInit, eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers || {}), ...headers } }) } }) : new StreamableHTTPClientTransport(new URL(url), { requestInit });
  }
  transportFor(url, provider, kind = "http") {
    if (this.transports) return this.transports(url, provider, kind);
    return kind === "sse" ? new SSEClientTransport(new URL(url), { authProvider: provider }) : new StreamableHTTPClientTransport(new URL(url), { authProvider: provider });
  }
  /** Connects (Streamable HTTP, falling back to SSE). Throws UnauthorizedError when it needs a sign-in. */
  async open(s, provider) {
    if (s.auth === "mail") {
      const mail = (await this.secret(s.id))?.mail;
      if (!mail) throw Error("Faltan los datos del buzón: vuelve a conectarlo.");
      return { client: new MailConnector(mail, { tcp: this.tcp }), transport: null };
    }
    if (s.run === "local") return { client: this.localClient(s), transport: null };
    let headers = null;
    if (s.auth === "token") headers = this.tokenHeaders(s, (await this.secret(s.id))?.token);
    if (s.auth === "google") headers = { Authorization: "Bearer " + (await this.googleTokens(s.id)).access_token };
    const attempt = async (kind) => {
      const client = new Client({ name: "Colmena", version: "1.0.0" });
      const transport = headers ? this.headerTransport(s.url, headers, kind) : this.transportFor(s.url, provider, kind);
      await client.connect(transport);
      return { client, transport };
    };
    try {
      return await attempt("http");
    } catch (error) {
      if (error instanceof UnauthorizedError || error?.name === "UnauthorizedError") throw error;
      return await attempt("sse");
    }
  }
  async refreshTools(id, client) {
    const tools = [];
    let cursor;
    for (let page = 0; page < 10 && tools.length < MAX_TOOLS; page++) {
      const out = await client.listTools(cursor ? { cursor } : {});
      tools.push(...(out.tools || []));
      cursor = out.nextCursor;
      if (!cursor) break;
    }
    return this.patch(id, {
      tools: tools.slice(0, MAX_TOOLS).map((t) => ({ name: String(t.name).slice(0, 120), title: clip(t.title || t.annotations?.title || "", 120), description: clip(t.description, 1200), inputSchema: t.inputSchema || { type: "object" }, annotations: t.annotations || {} })),
      toolsAt: now(), status: "connected", error: null,
    });
  }

  /**
   * «Conectar»: from the catalogue (catalogId) or a URL. Returns {server, authorizeUrl?}: open
   * authorizeUrl in the browser; the record turns 'connected' by itself when the sign-in returns.
   */
  async connect({ catalogId = null, url = null, name = null, token = null, mail = null, scope = null } = {}) {
    if (!this.secrets) throw Error("Las conexiones MCP necesitan el almacén cifrado (en el escritorio, el de Windows).");
    const entry = catalogId ? catalogEntry(catalogId) : null;
    if (catalogId && (!entry || entry.auth === "composio")) throw Object.assign(Error(entry ? entry.name + " se conecta con tu cuenta de Composio." : "Esa app no está en el catálogo."), { status: 400 });
    if (entry?.blocked) throw Object.assign(Error("Disponible pronto. " + entry.blocked), { status: 409 });
    const owner = this.ownerFor(entry, scope);
    if (entry?.auth === "google") return this.connectGoogle(entry, owner);
    if (entry?.auth === "mail") return this.connectMail(entry, owner, mail);
    if (entry?.auth === "token" || (!entry && token)) return this.connectToken(entry, owner, { url, name, token });
    const target = validateWebUrl(entry?.url || url);
    if (target.protocol !== "https:") throw Error("La conexión tiene que ser https.");
    const id = this.record(entry, owner, { url: target.href, name: name || target.hostname.replace(/^mcp\./, "") }).id;
    const s = this.patch(id, { status: "connecting", error: null, url: target.href });
    this.close(id);
    this.cancelPending(id);
    const state = randomBytes(16).toString("hex");
    const loopback = this.redirect ? { redirect: this.redirect, close() {} } : await this.listen(id, state);
    // A fresh registration for this redirect (its port changes every time).
    await this.saveSecret(id, { client: null, redirect: loopback.redirect });
    const provider = new Provider(this, id, { redirect: loopback.redirect, state });
    try {
      const live = await this.open(s, provider);
      loopback.close();
      this.live.set(id, live);
      this.patch(id, { connectedAt: now() });
      await this.refreshTools(id, live.client);
      return { server: serverView(this.server(id)) };
    } catch (error) {
      if (!(error instanceof UnauthorizedError || error?.name === "UnauthorizedError") || !provider.authorizeUrl) {
        loopback.close();
        const message = /registration|register|client/i.test(error?.message || "") ? "Este servicio no deja que Colmena se registre sola. Conéctalo con Composio si está en el catálogo." : "No se pudo conectar con " + s.name + ": " + clip(error?.message || "error desconocido", 200);
        this.patch(id, { status: "error", error: message });
        throw Error(message);
      }
      const timer = setTimeout(() => this.cancelPending(id, "La autorización no se completó a tiempo. Vuelve a conectar."), AUTH_WINDOW_MS);
      timer.unref?.();
      this.pending.set(id, { provider, state, loopback, timer });
      this.patch(id, { status: "needs_auth" });
      return { server: serverView(this.server(id)), authorizeUrl: provider.authorizeUrl };
    }
  }
  /** A key or token pasted by the person (or an admin for the company), sent in the entry's header. */
  async connectToken(entry, owner, { url = null, name = null, token = null }) {
    const value = String(token || "").trim();
    if (!TOKEN.test(value)) throw Object.assign(Error("Pega la clave o el token completo."), { status: 400 });
    const target = validateWebUrl(entry?.url || url);
    if (target.protocol !== "https:") throw Error("La conexión tiene que ser https.");
    const id = this.record(entry, owner, { url: target.href, name: name || target.hostname }).id;
    this.close(id);
    this.patch(id, { auth: "token", run: "remote", status: "connecting", error: null });
    await this.saveSecret(id, { token: value }, true);
    try {
      const live = await this.open(this.server(id));
      this.live.set(id, live);
      this.patch(id, { connectedAt: now() });
      await this.refreshTools(id, live.client);
      return { server: serverView(this.server(id)) };
    } catch (error) {
      const label = entry?.name || this.server(id).name;
      const message = unauthorized(error) ? label + " no aceptó esa clave. Comprueba que está completa y que tiene permisos." : "No se pudo conectar con " + label + ": " + clip(error?.message, 200);
      this.patch(id, { status: "error", error: message });
      throw Object.assign(Error(message), { status: 422 });
    }
  }
  /** A mailbox with an app password: tested (IMAP and SMTP, nothing sent) before it is kept. */
  async connectMail(entry, owner, mail) {
    let settings;
    try { settings = mailSettings(mail || {}, { allowPlain: this.allowPlain }); } catch (e) { throw Object.assign(e, { status: 400 }); }
    await new MailConnector(settings, { tcp: this.tcp }).test().catch((e) => { throw Object.assign(Error(e.message), { status: 422 }); });
    const id = this.record(entry, owner, { url: "mail:" + settings.email, account: settings.email }).id;
    await this.saveSecret(id, { mail: settings }, true);
    this.close(id);
    this.patch(id, { status: "connected", error: null, connectedAt: now(), url: "mail:" + settings.email });
    await this.refreshTools(id, await this.client(id));
    return { server: serverView(this.server(id)) };
  }
  /** Google with Colmena's own client: PKCE + state, the person's sign-in, back to the redirect. */
  async connectGoogle(entry, owner) {
    const client = this.googleClient();
    if (!client) throw Object.assign(Error("Disponible pronto: Colmena todavía no tiene su conexión con Google."), { status: 409 });
    const id = this.record(entry, owner, { url: entry.endpoint || "local:" + entry.id }).id;
    this.close(id);
    this.cancelPending(id);
    const state = randomBytes(16).toString("hex");
    const { verifier, challenge } = pkce();
    const loopback = this.redirect ? { redirect: this.redirect, close() {} } : await this.listen(id, state);
    await this.saveSecret(id, { pending: { state, verifier, at: Date.now(), google: true } });
    const timer = setTimeout(() => this.cancelPending(id, "La autorización no se completó a tiempo. Vuelve a conectar."), AUTH_WINDOW_MS);
    timer.unref?.();
    this.pending.set(id, { google: true, verifier, redirect: loopback.redirect, state, loopback, timer });
    this.patch(id, { status: "needs_auth", error: null });
    return { server: serverView(this.server(id)), authorizeUrl: googleAuthorizeUrl({ client, endpoints: this.google?.endpoints || GOOGLE_ENDPOINTS, redirect: loopback.redirect, scopes: entry.scopes, state, challenge }) };
  }
  /** The person's Google tokens, refreshed when about to expire (and saved back). */
  async googleTokens(id, { force = false } = {}) {
    let tokens = (await this.secret(id))?.google;
    if (!tokens) throw Object.assign(Error("Falta el permiso de Google: vuelve a conectar."), { code: "invalid_grant" });
    if (force || stale(tokens)) {
      const client = this.googleClient();
      if (!client) throw Error("Colmena ya no tiene su conexión con Google configurada.");
      tokens = await refreshTokens({ client, endpoints: this.google?.endpoints || GOOGLE_ENDPOINTS, tokens, fetchImpl: this.google?.fetchImpl || fetch });
      await this.saveSecret(id, { google: tokens });
    }
    return tokens;
  }
  /** An official local server (Analytics…) as a client: through the seam, with the person's credential. */
  localClient(s) {
    const entry = catalogEntry(s.catalogId);
    if (!entry?.local) throw Error("Ese servidor local ya no está en el catálogo.");
    if (!this.local) throw Error("Aquí no se pueden ejecutar servidores locales.");
    const spec = async () => {
      const client = this.googleClient();
      if (!client) throw Error("Colmena ya no tiene su conexión con Google configurada.");
      const tokens = await this.googleTokens(s.id);
      const { command, args } = this.localCommand(entry);
      const env = { GOOGLE_APPLICATION_CREDENTIALS: "${file:adc.json}", ...(client.project && entry.local.env?.project ? { [entry.local.env.project]: client.project } : {}) };
      return { command, args, env, files: { "adc.json": adcFile(client, tokens) } };
    };
    return {
      listTools: async () => ({ tools: await this.local.listTools(s.id, await spec()) }),
      callTool: async ({ name, arguments: args }) => this.local.callTool(s.id, await spec(), name, args || {}),
      close: () => this.local.close(s.id),
    };
  }
  /** «Probar»: talks to it again (mail: signs in to IMAP and SMTP) and re-reads its tools. */
  async test(id) {
    const s = this.server(id);
    this.close(id);
    try {
      if (s.auth === "mail") await new MailConnector((await this.secret(id)).mail, { tcp: this.tcp }).test();
      await this.refreshTools(id, await this.client(id, { retry: true }));
      return { ok: true, server: serverView(this.server(id)) };
    } catch (error) {
      const message = clip(error?.message, 240);
      if (this.server(id).status === "connected") this.patch(id, { error: message });
      return { ok: false, error: message, server: serverView(this.server(id)) };
    }
  }
  /** One loopback listener per sign-in: http://127.0.0.1:<port>/callback?code&state. */
  listen(id, state) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const page = (title, text) => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
          res.end(`<!doctype html><meta charset="utf-8"><title>Colmena</title><body style="font:16px system-ui;padding:48px;color:#12131A"><h1 style="font-size:24px">${title}</h1><p>${text}</p></body>`);
        };
        let u;
        try { u = new URL(req.url, "http://127.0.0.1"); } catch { return page("Enlace no válido", "Vuelve a Colmena e inténtalo otra vez."); }
        if (u.pathname !== "/callback") { res.writeHead(404); return res.end(); }
        if (u.searchParams.get("state") !== state) return page("Enlace no válido", "Esta autorización no es la que Colmena esperaba.");
        const code = u.searchParams.get("code");
        if (!code) return page("No se autorizó", "Puedes cerrar esta pestaña y volver a intentarlo desde Colmena.") || this.cancelPending(id, "No se autorizó la conexión.");
        this.finish(id, code).then(
          (ok) => page(ok ? "Conectado" : "No se pudo conectar", ok ? "Ya puedes cerrar esta pestaña y volver a Colmena." : "Vuelve a Colmena para ver qué ha pasado."),
          () => page("No se pudo conectar", "Vuelve a Colmena para ver qué ha pasado."),
        );
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => resolve({ redirect: `http://127.0.0.1:${server.address().port}/callback`, close: () => server.close() }));
    });
  }
  /**
   * The browser back at the public redirect (the cloud): {state, code, error}. Finds the sign-in by
   * its state, also after the server was restarted (the verifier was kept with it). true = connected.
   */
  async publicCallback({ state, code = null, error = null } = {}) {
    if (!this.redirect || typeof state !== "string" || !/^[0-9a-f]{32}$/.test(state)) return false;
    let id = [...this.pending].find(([, p]) => p.state === state)?.[0] || null;
    if (!id) {
      for (const s of this.store.list("mcpServers").filter((x) => x.status === "needs_auth")) {
        const p = (await this.secret(s.id))?.pending;
        if (p?.state === state && Date.now() - p.at < AUTH_WINDOW_MS) {
          id = s.id;
          if (p.google) { this.pending.set(id, { google: true, verifier: p.verifier, redirect: this.redirect, state, loopback: { close() {} }, timer: null }); break; }
          const provider = new Provider(this, id, { redirect: this.redirect, state });
          provider.verifier = p.verifier;
          this.pending.set(id, { provider, state, loopback: { close() {} }, timer: null });
          break;
        }
      }
    }
    if (!id) return false;
    if (error || !code) { this.cancelPending(id, "No se autorizó la conexión."); return false; }
    const ok = await this.finish(id, String(code).slice(0, 4096));
    await this.saveSecret(id, { pending: null });
    return ok;
  }
  async finish(id, code) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    try {
      const s = this.store.get("mcpServers", id);
      if (!s) return false;
      if (p.google) {
        const client = this.googleClient();
        if (!client) throw Error("Colmena ya no tiene su conexión con Google configurada.");
        const tokens = await exchangeCode({ client, endpoints: this.google?.endpoints || GOOGLE_ENDPOINTS, code, verifier: p.verifier, redirect: p.redirect, fetchImpl: this.google?.fetchImpl || fetch });
        await this.saveSecret(id, { google: tokens, pending: null });
      } else {
        const probe = this.transportFor(s.url, p.provider);
        await probe.finishAuth(code);
      }
      const live = await this.open(s, p.provider);
      this.live.set(id, live);
      this.patch(id, { connectedAt: now() });
      await this.refreshTools(id, live.client);
      return true;
    } catch (error) {
      this.patch(id, { status: "error", error: "No se pudo completar la conexión: " + clip(error?.message, 200) });
      return false;
    } finally {
      setTimeout(() => p.loopback.close(), 2000).unref?.();
    }
  }
  cancelPending(id, error = null) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.loopback.close();
    if (error && this.store.get("mcpServers", id)?.status !== "connected") this.patch(id, { status: "error", error });
  }
  /** A live client for a connected server (reconnects with the saved tokens; refresh is automatic). */
  async client(id, { retry = false } = {}) {
    const s = this.server(id);
    if (s.status !== "connected" && !retry) throw Error(s.name + " no está conectado. Conéctalo en Ajustes › Apps.");
    if (this.live.has(id)) return this.live.get(id).client;
    const provider = new Provider(this, id);
    try {
      let live;
      try {
        live = await this.open(s, provider);
      } catch (error) {
        // Google: an access token revoked early; one forced refresh, then a new sign-in.
        if (s.auth !== "google" || !unauthorized(error)) throw error;
        await this.googleTokens(id, { force: true });
        live = await this.open(s, provider);
      }
      this.live.set(id, live);
      return live.client;
    } catch (error) {
      if (unauthorized(error) || error?.code === "invalid_grant") {
        this.patch(id, { status: "needs_auth", error: "La sesión con " + s.name + " ha caducado. Vuelve a conectarlo." });
        throw Error("La sesión con " + s.name + " ha caducado: pide a la persona que lo vuelva a conectar en Ajustes › Conexiones.");
      }
      throw Error("No se pudo hablar con " + s.name + ": " + clip(error?.message, 200));
    }
  }
  async callTool(id, name, args, { signal } = {}) {
    const s = this.server(id);
    if (!(s.tools || []).some((t) => t.name === name)) throw Error("«" + name + "» no es una herramienta de " + s.name + ". Consulta la lista con mcp_tools.");
    const run = async () => (await this.client(id)).callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS, signal });
    try {
      return await run();
    } catch (error) {
      if (signal?.aborted) throw error;
      // A dropped session: one fresh connection and one more try.
      this.close(id);
      return await run();
    }
  }
  close(id) {
    const live = this.live.get(id);
    this.live.delete(id);
    try { live?.client?.close?.(); } catch {}
  }
  async remove(id) {
    const s = this.server(id);
    const me = currentPerson();
    // A company connection is removed by an owner or admin; a personal one by its person.
    if (isPerson(me) && !s.owner && !MANAGERS.has(me.role)) throw Object.assign(Error("Solo quien administra la empresa quita las apps de todos."), { status: 403 });
    this.close(id);
    if (s.auth === "google") {
      const secret = await this.secret(id).catch(() => null);
      if (secret?.google) await googleRevoke({ endpoints: this.google?.endpoints || GOOGLE_ENDPOINTS, tokens: secret.google, fetchImpl: this.google?.fetchImpl || fetch });
    }
    if (s.run === "local") await this.local?.close?.(id);
    this.cancelPending(id);
    this.cache.delete(id);
    try { await this.secrets?.remove?.(binding(id).profile); } catch {}
    this.store.remove("mcpServers", id);
    for (const g of this.store.list("grants")) if (String(g.scope || "").startsWith("mcp:" + id + ":")) this.store.remove("grants", g.id);
    return { ok: true };
  }
  shutdown() {
    for (const id of [...this.live.keys()]) this.close(id);
    void this.local?.shutdown?.();
    for (const id of [...this.pending.keys()]) this.cancelPending(id);
  }
}
