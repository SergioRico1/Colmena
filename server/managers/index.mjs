// Password managers feed the vault (docs/COMPUTER.md › «Gestores de contraseñas»): 1Password
// through its CLI `op` (desktop-app integration: the app unlocks it with Windows Hello, Touch ID
// or its own password, never typed into Colmena) and Bitwarden through `bw` (unlocked by the
// person in bw's own prompt, in a console window of its own; its session key stays in this
// process's memory only).
//
// What is stored (SQLite, kind "logins"): the item id, its title, the site's domain and a masked
// user name — for the logins the person ticked, one by one. Nothing is imported in bulk.
// The user name and the password are read from the manager at the moment of filling and handed
// straight to the browser fill code (the same path as SiteVault entries): never to the model,
// never logged, never in a tool result, a receipt or an approval card.
import { id as newId, now } from "../store.mjs";
import { siteDomain, maskUser } from "../vault.mjs";
import { findCli, cliEnv, runCli, wipe } from "./cli.mjs";
import { unlockInWindow } from "./bw-window.mjs";

export const MANAGERS = Object.freeze({
  "1password": { id: "1password", label: "1Password", cli: "op", install: "https://developer.1password.com/docs/cli/get-started/" },
  bitwarden: { id: "bitwarden", label: "Bitwarden", cli: "bw", install: "https://bitwarden.com/help/cli/" },
});
const ITEM_ID = /^[A-Za-z0-9-]{1,64}$/;

/** What a stored login looks like outside this module: no secret, a masked user. */
export const loginView = (l) => ({
  id: l.id, manager: l.manager, managerLabel: MANAGERS[l.manager]?.label || l.manager, itemId: l.itemId, label: l.title || l.domain,
  title: l.title, domain: l.domain, username: l.user, createdAt: l.createdAt || null, lastUsedAt: l.lastUsedAt || null, uses: l.uses || 0,
});

const parseJson = (buf) => {
  try { return JSON.parse(buf.toString("utf8")); } catch { return null; }
};
const failure = (manager, why) => Object.assign(Error(why), { status: 409, manager });

/** 1Password's list → the rows the person picks from (no secret is in it: `op item list` never prints one). */
function opRows(list) {
  return (Array.isArray(list) ? list : []).map((it) => {
    const urls = Array.isArray(it?.urls) ? it.urls : [];
    const href = (urls.find((u) => u?.primary) || urls[0])?.href || "";
    return { itemId: String(it?.id || ""), title: String(it?.title || "").slice(0, 120), domain: siteDomain(href), user: maskUser(it?.additional_information || "") };
  }).filter((r) => ITEM_ID.test(r.itemId) && r.domain);
}
/** Bitwarden's list carries every password of the vault: only id, name, first site and a masked user are kept. */
function bwRows(list) {
  return (Array.isArray(list) ? list : []).filter((it) => it?.type === 1 && it.login).map((it) => {
    const uri = (it.login.uris || []).map((u) => u?.uri).find((u) => siteDomain(u)) || "";
    return { itemId: String(it.id || ""), title: String(it.name || "").slice(0, 120), domain: siteDomain(uri), user: maskUser(it.login.username || "") };
  }).filter((r) => ITEM_ID.test(r.itemId) && r.domain);
}

export class PasswordManagers {
  /** `env`: where to look for the programs (COLMENA_OP_PATH / COLMENA_BW_PATH, PATH…). */
  constructor(store, { env = process.env, unlock = unlockInWindow } = {}) {
    this.store = store;
    this.env = env;
    this.unlockFn = unlock;
    // Bitwarden's session key: from Colmena's own environment, or from an unlock window. Memory only.
    this.bwSession = env.BW_SESSION || null;
  }
  path(manager) {
    return findCli(MANAGERS[manager].cli, { env: this.env });
  }
  run(manager, args, extra = {}) {
    const file = this.path(manager);
    if (!file) throw failure(manager, MANAGERS[manager].label + " no está instalado en este ordenador.");
    const env = cliEnv(manager === "bitwarden" && this.bwSession ? { BW_SESSION: this.bwSession, ...extra } : extra, this.env);
    return runCli(file, args, { env });
  }

  /** {id, label, state: 'connected'|'locked'|'setup'|'missing', detail, install}: what Ajustes shows next to the name. */
  async status(manager) {
    const m = MANAGERS[manager];
    const base = {
      id: m.id, label: m.label, install: m.install, chosen: this.list().filter((l) => l.manager === manager).length,
      // Bitwarden can open its own prompt in a window here (server/managers/bw-window.mjs).
      ...(manager === "bitwarden" ? { canUnlock: ["win32", "darwin"].includes(process.platform), unlockedByColmena: !!this.bwSession && this.bwSession !== this.env.BW_SESSION } : {}),
    };
    if (!this.path(manager)) return { ...base, state: "missing", detail: "No instalado" };
    try {
      if (manager === "1password") {
        const accounts = await this.run(manager, ["account", "list", "--format", "json"]);
        const list = parseJson(accounts.stdout);
        wipe(accounts.stdout);
        if (accounts.code !== 0 || !Array.isArray(list) || !list.length)
          return { ...base, state: "setup", detail: "Activa «Integrar con 1Password CLI» en 1Password › Ajustes › Desarrollador" };
        const who = await this.run(manager, ["whoami", "--format", "json"]);
        wipe(who.stdout);
        return who.code === 0 ? { ...base, state: "connected", detail: "Conectado" } : { ...base, state: "locked", detail: "Bloqueado — desbloquéalo en 1Password" };
      }
      const st = await this.run(manager, ["status", "--nointeraction"]);
      const s = parseJson(st.stdout);
      wipe(st.stdout);
      if (s?.status === "unlocked") return { ...base, state: "connected", detail: "Conectado" };
      if (s?.status === "locked") return { ...base, state: "locked", detail: "Bloqueado — desbloquéalo para que Colmena pueda usarlo" };
      return { ...base, state: "setup", detail: "Sin sesión: escribe «bw login» una vez en una terminal" };
    } catch {
      return { ...base, state: "missing", detail: "No responde" };
    }
  }
  async statuses() {
    return Promise.all(Object.keys(MANAGERS).map((m) => this.status(m)));
  }

  /** The logins of a manager the person can pick from (read now, never stored as a whole). */
  async items(manager) {
    if (!MANAGERS[manager]) throw failure(manager, "Gestor desconocido.");
    const r = manager === "1password"
      ? await this.run(manager, ["item", "list", "--categories", "Login", "--format", "json"])
      : await this.run(manager, ["list", "items", "--nointeraction"]);
    let list = r.code === 0 ? parseJson(r.stdout) : null;
    wipe(r.stdout);
    if (!Array.isArray(list)) throw failure(manager, MANAGERS[manager].label + (manager === "1password" ? " está bloqueado: desbloquéalo en la app de 1Password y vuelve a intentarlo." : " está bloqueado: desbloquéalo y vuelve a intentarlo."));
    const rows = manager === "1password" ? opRows(list) : bwRows(list);
    list = null;
    const chosen = new Map(this.list().filter((l) => l.manager === manager).map((l) => [l.itemId, l.id]));
    return rows.map((row) => ({ ...row, chosenId: chosen.get(row.itemId) || null })).sort((a, b) => a.domain.localeCompare(b.domain, "es") || a.title.localeCompare(b.title, "es"));
  }

  /** Lets Colmena use one login: its metadata is read again from the manager (never trusted from the client). */
  async choose(manager, itemId) {
    if (!MANAGERS[manager] || !ITEM_ID.test(String(itemId || ""))) throw failure(manager, "Ese inicio de sesión no existe.");
    const existing = this.list().find((l) => l.manager === manager && l.itemId === itemId);
    if (existing) return existing;
    const row = (await this.items(manager)).find((r) => r.itemId === itemId);
    if (!row) throw failure(manager, "Ese inicio de sesión ya no está en " + MANAGERS[manager].label + ".");
    return loginView(this.store.put("logins", { id: newId(), manager, itemId, title: row.title, domain: row.domain, user: row.user, createdAt: now(), uses: 0 }));
  }
  /** Stops using a login: its record and every bot's permission for it go. */
  remove(loginId) {
    this.entry(loginId);
    this.store.remove("logins", loginId);
    for (const g of this.store.list("grants")) if (g.scope === "login:" + loginId) this.store.remove("grants", g.id);
    return { ok: true };
  }

  list() {
    return this.store.list("logins").map(loginView).sort((a, b) => a.domain.localeCompare(b.domain, "es"));
  }
  has(loginId) {
    return !!this.store.get("logins", String(loginId || ""));
  }
  entry(loginId) {
    const l = this.store.get("logins", String(loginId || ""));
    if (!l) throw Object.assign(Error("Ese inicio de sesión ya no está en Colmena."), { status: 404 });
    return loginView(l);
  }

  /**
   * Only for the sign-in step, never for an API or a model: {domain, username, password}, read
   * from the manager now. The caller hands it to the browser and drops it.
   */
  async secret(loginId) {
    const l = this.store.get("logins", String(loginId || ""));
    if (!l) throw Error("Ese inicio de sesión ya no está en Colmena.");
    const label = MANAGERS[l.manager]?.label || "El gestor";
    if (l.manager === "1password") {
      const r = await this.run(l.manager, ["item", "get", l.itemId, "--fields", "label=username,label=password", "--reveal", "--format", "json"]);
      let fields = r.code === 0 ? parseJson(r.stdout) : null;
      wipe(r.stdout);
      if (!fields) throw Error(label + " no ha dado el acceso: puede estar bloqueado. Pide a la persona que lo desbloquee.");
      fields = Array.isArray(fields) ? fields : [fields];
      const pick = (name) => fields.find((f) => String(f?.label || f?.id || "").toLowerCase() === name)?.value || "";
      const out = { domain: l.domain, username: String(pick("username")), password: String(pick("password")) };
      fields = null;
      if (!out.password) throw Error(label + " no tiene contraseña para ese inicio de sesión.");
      return out;
    }
    const user = await this.run(l.manager, ["get", "username", l.itemId, "--nointeraction"]);
    const pass = await this.run(l.manager, ["get", "password", l.itemId, "--nointeraction"]);
    const out = { domain: l.domain, username: user.code === 0 ? user.stdout.toString("utf8").replace(/\r?\n$/, "") : "", password: pass.code === 0 ? pass.stdout.toString("utf8").replace(/\r?\n$/, "") : "" };
    wipe(user.stdout, pass.stdout);
    if (!out.password) throw Error(label + " no ha dado el acceso: puede estar bloqueado. Pide a la persona que lo desbloquee.");
    return out;
  }
  used(loginId) {
    const l = this.store.get("logins", loginId);
    if (l) this.store.patch("logins", loginId, { lastUsedAt: now(), uses: (l.uses || 0) + 1 });
  }

  /** Bitwarden: opens bw's own prompt in a window; the master password never passes through Colmena. */
  async unlockBitwarden() {
    const file = this.path("bitwarden");
    if (!file) throw failure("bitwarden", "Bitwarden no está instalado en este ordenador.");
    const key = await this.unlockFn(file, { env: cliEnv({}, this.env) });
    if (!key) throw failure("bitwarden", "Bitwarden sigue bloqueado.");
    this.bwSession = key;
    return this.status("bitwarden");
  }
  /** Forgets Bitwarden's session key (Colmena stops being able to read it until it is unlocked again). */
  lockBitwarden() {
    this.bwSession = null;
    return { ok: true };
  }
}
