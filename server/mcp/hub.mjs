// MCP connections (OpenClaw «mcp.servers»): remote MCP servers the person connects with one
// click. Colmena registers itself with the service (OAuth dynamic client registration + PKCE),
// the sign-in happens in the system browser and comes back to a loopback address only this
// connection listens on. Tokens live in the Windows DPAPI store, never in SQLite.
//
// Records (SQLite, kind 'mcpServers'): {id, name, url, catalogId, status, tools:[…], toolsAt,
// error, createdAt, connectedAt}. status: 'connecting' | 'connected' | 'needs_auth' | 'error'.
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

const AUTH_WINDOW_MS = 10 * 60000;
const CALL_TIMEOUT_MS = 120000;
const MAX_TOOLS = 200;
const clip = (t, n) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const binding = (id) => ({ profile: "mcp-" + id, hostId: os.hostname() || "local", clientId: "colmena-mcp", subject: "local" });

export const serverView = (s) => ({
  id: s.id, name: s.name, url: s.url, catalogId: s.catalogId || null, status: s.status, error: s.error || null,
  toolCount: (s.tools || []).length, createdAt: s.createdAt || null, connectedAt: s.connectedAt || null,
});

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
  saveCodeVerifier(v) { this.verifier = v; }
  codeVerifier() { if (!this.verifier) throw Error("Falta el verificador de la autorización."); return this.verifier; }
  async invalidateCredentials(scope) {
    if (scope === "all") await this.hub.saveSecret(this.id, { client: null, tokens: null }, true);
    else if (scope === "client") await this.hub.saveSecret(this.id, { client: null });
    else if (scope === "tokens") await this.hub.saveSecret(this.id, { tokens: null });
  }
}

export class McpHub {
  /** `secrets` = {load(binding), save(binding, data), remove(profile)} (DPAPI; tests pass one in memory). */
  constructor(store, { secrets, transports = null, onChange = null } = {}) {
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
    for (const s of store.list("mcpServers")) if (["connecting", "needs_auth"].includes(s.status) && !(s.tools || []).length) store.patch("mcpServers", s.id, { status: "error", error: "La autorización no se completó. Vuelve a conectar." });
  }
  get available() { return !!this.secrets; }
  servers() { return this.store.list("mcpServers").map(serverView).sort((a, b) => a.name.localeCompare(b.name, "es")); }
  connected() { return this.store.list("mcpServers").filter((s) => s.status === "connected"); }
  server(id) {
    const s = this.store.get("mcpServers", id);
    if (!s) throw Object.assign(Error("Esa conexión ya no existe."), { status: 404 });
    return s;
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
  transportFor(url, provider, kind = "http") {
    if (this.transports) return this.transports(url, provider, kind);
    return kind === "sse" ? new SSEClientTransport(new URL(url), { authProvider: provider }) : new StreamableHTTPClientTransport(new URL(url), { authProvider: provider });
  }
  /** Connects (Streamable HTTP, falling back to SSE). Throws UnauthorizedError when it needs a sign-in. */
  async open(s, provider) {
    const attempt = async (kind) => {
      const client = new Client({ name: "Colmena", version: "1.0.0" });
      const transport = this.transportFor(s.url, provider, kind);
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
  async connect({ catalogId = null, url = null, name = null } = {}) {
    if (!this.secrets) throw Error("Las conexiones MCP necesitan el almacén cifrado de Windows (aplicación de escritorio).");
    const entry = catalogId ? catalogEntry(catalogId) : null;
    if (catalogId && (!entry || entry.via !== "mcp")) throw Error("Esa app no se conecta por MCP.");
    const target = validateWebUrl(entry?.url || url);
    if (target.protocol !== "https:") throw Error("La conexión tiene que ser https.");
    const existing = this.store.list("mcpServers").find((s) => s.url === target.href);
    const id = existing?.id || slugFor(entry?.name || name || target.hostname.replace(/^mcp\./, ""), new Set(this.store.list("mcpServers").map((s) => s.id)));
    const s = existing ? this.patch(id, { status: "connecting", error: null }) : this.store.put("mcpServers", { id, name: entry?.name || clip(name, 60) || target.hostname, url: target.href, catalogId: entry?.id || null, status: "connecting", tools: [], createdAt: now() });
    this.close(id);
    this.cancelPending(id);
    const state = randomBytes(16).toString("hex");
    const loopback = await this.listen(id, state);
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
  async finish(id, code) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    try {
      const s = this.server(id);
      const probe = this.transportFor(s.url, p.provider);
      await probe.finishAuth(code);
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
  async client(id) {
    const s = this.server(id);
    if (s.status !== "connected") throw Error(s.name + " no está conectado. Conéctalo en Ajustes › Conexiones.");
    if (this.live.has(id)) return this.live.get(id).client;
    const provider = new Provider(this, id);
    try {
      const live = await this.open(s, provider);
      this.live.set(id, live);
      return live.client;
    } catch (error) {
      if (error instanceof UnauthorizedError || error?.name === "UnauthorizedError") {
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
    try { live?.client?.close(); } catch {}
  }
  async remove(id) {
    this.server(id);
    this.close(id);
    this.cancelPending(id);
    this.cache.delete(id);
    try { await this.secrets?.remove?.(binding(id).profile); } catch {}
    this.store.remove("mcpServers", id);
    for (const g of this.store.list("grants")) if (String(g.scope || "").startsWith("mcp:" + id + ":")) this.store.remove("grants", g.id);
    return { ok: true };
  }
  shutdown() {
    for (const id of [...this.live.keys()]) this.close(id);
    for (const id of [...this.pending.keys()]) this.cancelPending(id);
  }
}
