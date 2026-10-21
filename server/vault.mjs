// Password vault (Hermes credential vault, Colmena-style): you keep site accounts here and a
// bot can sign in with one, but it never sees nor types the password.
// - Metadata (site, user name, label, uses) lives in SQLite (kind 'vault'); the passwords only
//   in the Windows DPAPI store (server/credential_vault.py), bound to this user and machine.
// - No API returns a password. The bot asks with browser_sign_in {entry}; the first time per
//   bot and account you approve it; Colmena then fills the login form in the bot's browser
//   only if the open page belongs to that site (no phishing look-alikes).
import os from "node:os";
import path from "node:path";
import { id, now } from "./store.mjs";
import { windowsVault } from "./nexo/credential-vault.mjs";

const BINDING = { profile: "site-passwords", hostId: os.hostname() || "local", clientId: "colmena-vault", subject: "local" };

/** «https://www.example.com/login» → «example.com»; null if it is not a public web address. */
export function siteDomain(raw) {
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(String(raw || "").trim()) ? String(raw).trim() : "https://" + String(raw || "").trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.endsWith(".local") || host === "localhost") return null;
  return host;
}

/** The page host belongs to the saved site: the same host or one of its subdomains. */
export function sameSite(pageHost, domain) {
  const host = String(pageHost || "").toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const d = String(domain || "").toLowerCase();
  return !!host && !!d && (host === d || host.endsWith("." + d));
}

export const entryView = (e) => ({
  id: e.id, domain: e.domain, label: e.label || e.domain, username: e.username, createdAt: e.createdAt || null,
  updatedAt: e.updatedAt || null, lastUsedAt: e.lastUsedAt || null, uses: e.uses || 0,
});

export class SiteVault {
  /** `secrets` = {load(binding), save(binding, data)}: the DPAPI store (tests pass one in memory). */
  constructor(store, { secrets } = {}) {
    this.store = store;
    this.secrets = secrets === undefined ? windowsVault(path.join(store.directory, "vault")) : secrets;
    this.queue = Promise.resolve();
  }
  get available() {
    return !!this.secrets;
  }
  list() {
    return this.store.list("vault").map(entryView).sort((a, b) => a.label.localeCompare(b.label, "es"));
  }
  entry(entryId) {
    const e = this.store.get("vault", entryId);
    if (!e) throw Object.assign(Error("Esa cuenta ya no está en la bóveda."), { status: 404 });
    return e;
  }
  // One write at a time: read, change and save the encrypted blob.
  change(fn) {
    const next = this.queue.then(async () => {
      if (!this.secrets) throw Error("La bóveda cifrada solo funciona en Windows, en la aplicación de escritorio.");
      const data = (await this.secrets.load(BINDING)) || { version: 1, passwords: {} };
      const out = await fn(data);
      await this.secrets.save(BINDING, data);
      return out;
    });
    this.queue = next.catch(() => {});
    return next;
  }
  async add({ url, username, password, label = "" }) {
    const domain = siteDomain(url);
    if (!domain) throw Error("Escribe la dirección de la web (por ejemplo, https://www.ejemplo.com).");
    if (!String(username || "").trim()) throw Error("Escribe el usuario o el correo con el que entras.");
    if (!String(password || "")) throw Error("Escribe la contraseña.");
    const entryId = id();
    await this.change((data) => { data.passwords[entryId] = String(password); });
    return entryView(this.store.put("vault", { id: entryId, domain, username: String(username).trim(), label: String(label || "").trim() || domain, createdAt: now(), uses: 0 }));
  }
  async update(entryId, { username, password, label } = {}) {
    const e = this.entry(entryId);
    if (password !== undefined) {
      if (!String(password)) throw Error("La contraseña no puede quedar vacía.");
      await this.change((data) => { data.passwords[entryId] = String(password); });
    }
    const changes = { updatedAt: now() };
    if (username !== undefined) changes.username = String(username).trim() || e.username;
    if (label !== undefined) changes.label = String(label).trim() || e.domain;
    return entryView(this.store.patch("vault", entryId, changes));
  }
  async remove(entryId) {
    this.entry(entryId);
    await this.change((data) => { delete data.passwords[entryId]; });
    this.store.remove("vault", entryId);
    // Its «Permitir siempre» rules go with it.
    for (const g of this.store.list("grants")) if (g.scope === "vault:" + entryId) this.store.remove("grants", g.id);
    return { ok: true };
  }
  /** Only for the sign-in step, never for an API or a model: {domain, username, password}. */
  async secret(entryId) {
    const e = this.entry(entryId);
    if (!this.secrets) throw Error("La bóveda cifrada solo funciona en Windows, en la aplicación de escritorio.");
    const data = (await this.secrets.load(BINDING)) || { passwords: {} };
    const password = data.passwords?.[entryId];
    if (!password) throw Error("No encuentro la contraseña de esa cuenta en la bóveda. Vuelve a guardarla en Ajustes › Seguridad.");
    return { domain: e.domain, username: e.username, password };
  }
  used(entryId) {
    const e = this.store.get("vault", entryId);
    if (e) this.store.patch("vault", entryId, { lastUsedAt: now(), uses: (e.uses || 0) + 1 });
  }
}

/** Lines for the tool description: the accounts a bot may sign in with (no secrets). */
export function vaultCatalog(entries) {
  return entries.map((e) => e.id + " = " + e.domain + (e.label && e.label !== e.domain ? " («" + e.label + "»)" : "") + ", usuario " + maskUser(e.username)).join("; ");
}
export function maskUser(user) {
  const s = String(user || "");
  const at = s.indexOf("@");
  if (at > 1) return s[0] + "…" + s.slice(at);
  return s.length > 3 ? s.slice(0, 2) + "…" : s;
}

/**
 * HTTP routes (Ajustes › Seguridad › Bóveda). None returns a password.
 *   GET    /api/vault        → {available, entries:[…]}
 *   POST   /api/vault        {url, username, password, label?}
 *   PATCH  /api/vault/:id    {username?, password?, label?}
 *   DELETE /api/vault/:id
 */
export function registerVaultRoutes(app, { vault, z }) {
  const text = (max) => z.string().max(max);
  const parse = (schema, body) => schema.parse(body ?? {});
  app.get("/api/vault", (req, res) => res.json({ available: vault.available, entries: vault.list() }));
  app.post("/api/vault", async (req, res) => {
    const data = parse(z.object({ url: text(2000), username: text(320), password: z.string().min(1).max(1000), label: text(80).optional() }).strict(), req.body);
    res.status(201).json(await vault.add(data));
  });
  app.patch("/api/vault/:id", async (req, res) => {
    const data = parse(z.object({ username: text(320), password: z.string().min(1).max(1000), label: text(80) }).partial().strict(), req.body);
    res.json(await vault.update(req.params.id, data));
  });
  app.delete("/api/vault/:id", async (req, res) => res.json(await vault.remove(req.params.id)));
}
