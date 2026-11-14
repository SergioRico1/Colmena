// The account directory of hosted Colmena (docs/CLOUD.md › Phase 1 › Accounts): people, their
// sign-in links and sessions, companies (workspaces), who belongs to which and with what role,
// and invitations. It lives in one SQLite-backed Durable Object (`Directory`, cloud/src/directory.js)
// because the deploy token has no D1 scope; this module is the logic over its SQL, with no
// Cloudflare import, so the same code runs on node:sqlite in the tests (server/do-sql-fake.mjs).
//
// Secrets are never stored: a link, invitation or session token is 32 random bytes the person
// holds; the directory keeps its SHA-256. Every write is one statement or one transactionSync.
import { createHash, randomBytes, randomUUID } from "node:crypto";

export const LIMITS = Object.freeze({
  linkMs: 15 * 60 * 1000, // a sign-in link lasts 15 minutes and works once
  linksPerEmail: 5, // per 15 minutes
  linksPerIp: 20, // per 15 minutes
  rateWindowMs: 15 * 60 * 1000,
  sessionMs: 30 * 24 * 3600 * 1000, // a session lasts 30 days at most
  idleMs: 14 * 24 * 3600 * 1000, // and ends after 14 days unused
  rotateMs: 6 * 3600 * 1000, // its token is replaced every 6 hours of use
  graceMs: 60 * 1000, // the replaced token still works for a minute (requests in flight)
  inviteMs: 7 * 24 * 3600 * 1000,
  importInviteMs: 30 * 24 * 3600 * 1000, // invitations from an import (never mailed) wait longer
  importPerCall: 5000,
  invitesPerDay: 50, // per workspace
  workspacesPerPerson: 10,
  oauthMs: 10 * 60 * 1000, // a sign-in with Google, Microsoft or GitHub has 10 minutes to come back
  oauthPerIp: 30, // started per 15 minutes
  desktopMs: 10 * 60 * 1000, // a desktop sign-in (Phase 5) has 10 minutes to be approved and picked up
  desktopPerIp: 20, // started per 15 minutes
  desktopAttempts: 5, // wrong hand-back codes before the request closes
  domains: 20, // auto-join domains per workspace
  name: 80,
  workspaceName: 60,
});
export const ROLES = Object.freeze(["owner", "admin", "member", "guest"]);
const MANAGERS = new Set(["owner", "admin"]);
export const OAUTH_PROVIDERS = Object.freeze(["google", "microsoft", "github"]);
/** Addresses anyone can get: never a company's own domain for auto-join. */
export const PUBLIC_MAIL_DOMAINS = Object.freeze(new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "yahoo.es", "icloud.com",
  "me.com", "proton.me", "protonmail.com", "gmx.com", "gmx.es", "aol.com", "hotmail.es", "outlook.es",
]));

export class DirectoryError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const hash = (token) => createHash("sha256").update(String(token)).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const DOMAIN = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/;
export function cleanEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (e.length > 254 || !EMAIL.test(e)) throw new DirectoryError("Escribe un correo válido.", 400, "email");
  return e;
}
const cleanName = (name, max = LIMITS.name) => String(name || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** Only a path of this site: «/sala/x», never «//elsewhere» or a full URL. */
export const safeNext = (next) => (typeof next === "string" && /^\/(?![/\\])[^\s]{0,300}$/.test(next) ? next : "/");
/** A short code people read and type: 8 letters and digits without look-alikes, «K7QX-4PZM». */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const shortCode = () => { const b = randomBytes(8); let s = ""; for (const x of b) s += CODE_ALPHABET[x % CODE_ALPHABET.length]; return s.slice(0, 4) + "-" + s.slice(4); };
const cleanCode = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const parseDomains = (text) => {
  try { const d = JSON.parse(text || "[]"); return Array.isArray(d) ? d.filter((x) => typeof x === "string") : []; } catch { return []; }
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER);
CREATE TABLE IF NOT EXISTS identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (provider, subject));
CREATE TABLE IF NOT EXISTS links (hash TEXT PRIMARY KEY, email TEXT NOT NULL, next TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, ip TEXT);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL, workspace_id TEXT, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, rotated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, replaced_by TEXT, grace_until INTEGER, agent TEXT);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS memberships (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, user_id));
CREATE INDEX IF NOT EXISTS memberships_user ON memberships(user_id);
CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, invited_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, accepted_at INTEGER, accepted_by TEXT, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS invitations_workspace ON invitations(workspace_id);
CREATE INDEX IF NOT EXISTS invitations_email ON invitations(email);
CREATE TABLE IF NOT EXISTS rate (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, email TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, provider TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL, next TEXT NOT NULL, binding TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, ip TEXT);
CREATE TABLE IF NOT EXISTS departures (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (workspace_id, user_id));
CREATE TABLE IF NOT EXISTS desktop_signins (id TEXT PRIMARY KEY, poll_hash TEXT NOT NULL, user_code TEXT NOT NULL, name TEXT NOT NULL, handback_hash TEXT, user_id TEXT, workspace_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, approved_at INTEGER, used_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, ip TEXT);
`;
/** Columns added after the first deploy: ALTER TABLE once, when missing. */
const COLUMNS = [
  ["memberships", "deactivated_at", "INTEGER"],
  ["workspaces", "domains", "TEXT"],
  ["invitations", "imported", "INTEGER NOT NULL DEFAULT 0"],
  ["invitations", "name", "TEXT"],
];

/**
 * `storage`: a Durable Object's storage ({sql, transactionSync}); `clock`: () => ms.
 */
export class DirectoryCore {
  constructor(storage, { clock = () => Date.now() } = {}) {
    this.storage = storage;
    this.sql = storage.sql;
    this.clock = clock;
    this.sql.exec(SCHEMA);
    for (const [table, column, type] of COLUMNS) {
      if (!this.rows(`PRAGMA table_info(${table})`).some((c) => c.name === column)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
  rows(text, ...args) { return this.sql.exec(text, ...args).toArray(); }
  row(text, ...args) { return this.rows(text, ...args)[0] || null; }
  run(text, ...args) { this.sql.exec(text, ...args).toArray(); }
  tx(fn) { return this.storage.transactionSync(fn); }

  // ------------------------------------------------------------------ limits
  /** Counts one use of `key` in its window; throws once over `max`. */
  limit(key, max, message = "Demasiados intentos. Espera unos minutos y vuelve a probar.") {
    const t = this.clock();
    const r = this.row("SELECT window_start, count FROM rate WHERE key=?", key);
    if (!r || t - r.window_start >= LIMITS.rateWindowMs) {
      this.run("INSERT INTO rate(key, window_start, count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=1", key, t);
      return;
    }
    if (r.count >= max) throw new DirectoryError(message, 429, "rate");
    this.run("UPDATE rate SET count=count+1 WHERE key=?", key);
  }
  /** Upkeep: expired links, sessions, OAuth flows, rate windows and dev mail go. */
  sweep() {
    const t = this.clock();
    this.run("DELETE FROM links WHERE expires_at < ?", t - 24 * 3600 * 1000);
    this.run("DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ? OR (grace_until IS NOT NULL AND grace_until < ?)", t, t - LIMITS.idleMs, t);
    this.run("DELETE FROM rate WHERE window_start < ?", t - LIMITS.rateWindowMs);
    this.run("DELETE FROM outbox WHERE created_at < ?", t - 30 * 60 * 1000);
    this.run("DELETE FROM oauth_states WHERE expires_at < ?", t - 3600 * 1000);
    this.run("DELETE FROM desktop_signins WHERE expires_at < ?", t - 3600 * 1000);
  }

  // ------------------------------------------------------------------ sign-in links
  /** A sign-in link for `email`: its token (to mail, never to show) and when it ends. */
  requestLink({ email, ip = null, next = "/" }) {
    const address = cleanEmail(email);
    this.limit("link:email:" + address, LIMITS.linksPerEmail);
    if (ip) this.limit("link:ip:" + String(ip).slice(0, 64), LIMITS.linksPerIp);
    const secret = token(), t = this.clock();
    this.run("INSERT INTO links(hash, email, next, created_at, expires_at, ip) VALUES(?,?,?,?,?,?)", hash(secret), address, safeNext(next), t, t + LIMITS.linkMs, ip ? String(ip).slice(0, 64) : null);
    return { token: secret, email: address, expiresAt: t + LIMITS.linkMs };
  }
  /**
   * The link is used: the person (made now if new) and a new session. Works once, for 15 minutes.
   * `joined`: the companies the person entered now by their address's domain.
   */
  verifyLink({ token: secret, agent = null, ip = null }) {
    if (ip) this.limit("verify:ip:" + String(ip).slice(0, 64), 60);
    if (!TOKEN.test(String(secret || ""))) throw new DirectoryError("Ese enlace no es válido.", 400, "link");
    return this.tx(() => {
      const link = this.row("SELECT * FROM links WHERE hash=?", hash(secret));
      if (!link) throw new DirectoryError("Ese enlace no es válido.", 400, "link");
      if (link.used_at) throw new DirectoryError("Ese enlace ya se usó. Pide otro.", 410, "used");
      if (link.expires_at < this.clock()) throw new DirectoryError("Ese enlace ha caducado. Pide otro.", 410, "expired");
      this.run("UPDATE links SET used_at=? WHERE hash=?", this.clock(), link.hash);
      // Any other link still open for this address stops working too.
      this.run("UPDATE links SET used_at=? WHERE email=? AND used_at IS NULL", this.clock(), link.email);
      let user = this.row("SELECT * FROM users WHERE email=?", link.email);
      const isNew = !user;
      if (!user) {
        user = { id: randomUUID(), email: link.email, name: this.importedName(link.email) || cleanName(link.email.split("@")[0]) || "Persona", created_at: this.clock() };
        this.run("INSERT INTO users(id, email, name, created_at) VALUES(?,?,?,?)", user.id, user.email, user.name, user.created_at);
        this.run("INSERT INTO identities(provider, subject, user_id, created_at) VALUES('email', ?, ?, ?)", user.email, user.id, user.created_at);
      }
      const joined = this.autoJoin(user.id, user.email);
      const session = this.createSession(user.id, { agent });
      return { user: this.userView(user), session, next: link.next, isNew, joined };
    });
  }

  /**
   * Sign-in with Google, Microsoft or GitHub (cloud/src/oauth.js): the provider's subject and its
   * verified email find or make the person. Accounts are linked by verified email: the first
   * time a provider is used with an address that already has an account, it becomes one more way
   * into that account. An email the provider does not vouch for is refused.
   */
  signInWith({ provider, subject, email, emailVerified = false, name = null, agent = null }) {
    if (!/^[a-z]{2,20}$/.test(provider || "") || provider === "email" || !subject) throw new DirectoryError("Proveedor no válido.");
    const address = cleanEmail(email);
    if (emailVerified !== true) throw new DirectoryError("Tu proveedor no confirma que ese correo sea tuyo. Entra con el enlace por correo.", 403, "unverified");
    return this.tx(() => {
      const known = this.row("SELECT user_id FROM identities WHERE provider=? AND subject=?", provider, String(subject));
      let user = known ? this.row("SELECT * FROM users WHERE id=?", known.user_id) : this.row("SELECT * FROM users WHERE email=?", address);
      const isNew = !user;
      if (!user) {
        user = { id: randomUUID(), email: address, name: cleanName(name) || this.importedName(address) || cleanName(address.split("@")[0]) || "Persona", created_at: this.clock() };
        this.run("INSERT INTO users(id, email, name, created_at) VALUES(?,?,?,?)", user.id, user.email, user.name, user.created_at);
      }
      if (!known) this.run("INSERT INTO identities(provider, subject, user_id, created_at) VALUES(?,?,?,?)", provider, String(subject), user.id, this.clock());
      // Auto-join goes by the account's own address.
      const joined = this.autoJoin(user.id, user.email);
      return { user: this.userView(user), session: this.createSession(user.id, { agent }), isNew, joined };
    });
  }

  // ------------------------------------------------------------------ OAuth flows in flight
  /**
   * A sign-in with a provider starts: the `state` (sent to the provider), the PKCE `verifier`,
   * the OIDC `nonce` and the browser `binding` (into a short cookie). State and binding are kept
   * hashed; the flow lasts 10 minutes and works once.
   */
  startOAuth({ provider, next = "/", ip = null }) {
    if (!OAUTH_PROVIDERS.includes(provider)) throw new DirectoryError("Proveedor no válido.", 404, "provider");
    if (ip) this.limit("oauth:ip:" + String(ip).slice(0, 64), LIMITS.oauthPerIp);
    const state = token(), verifier = token(), nonce = token(), binding = token(), t = this.clock();
    this.run("INSERT INTO oauth_states(hash, provider, verifier, nonce, next, binding, created_at, expires_at, ip) VALUES(?,?,?,?,?,?,?,?,?)",
      hash(state), provider, verifier, nonce, safeNext(next), hash(binding), t, t + LIMITS.oauthMs, ip ? String(ip).slice(0, 64) : null);
    return { state, verifier, nonce, binding, next: safeNext(next), expiresAt: t + LIMITS.oauthMs };
  }
  /** The callback: the flow `state` names, used up now whatever happens next. */
  finishOAuth({ provider, state, binding }) {
    const invalid = () => new DirectoryError("Esa entrada no es válida. Empieza otra vez.", 400, "state");
    if (!TOKEN.test(String(state || ""))) throw invalid();
    const row = this.tx(() => {
      const r = this.row("SELECT * FROM oauth_states WHERE hash=?", hash(state));
      if (r && !r.used_at) this.run("UPDATE oauth_states SET used_at=? WHERE hash=?", this.clock(), r.hash);
      return r;
    });
    if (!row) throw invalid();
    if (row.used_at) throw new DirectoryError("Esa entrada ya se usó. Empieza otra vez.", 410, "state");
    if (row.expires_at < this.clock()) throw new DirectoryError("Esa entrada ha caducado. Empieza otra vez.", 410, "state");
    if (row.provider !== provider) throw invalid();
    if (!TOKEN.test(String(binding || "")) || hash(binding) !== row.binding) throw new DirectoryError("Termina la entrada en el mismo navegador donde la empezaste.", 403, "state");
    return { verifier: row.verifier, nonce: row.nonce, next: row.next };
  }

  // ------------------------------------------------------------------ sessions
  createSession(userId, { agent = null, workspaceId = null } = {}) {
    const secret = token(), csrf = token(), t = this.clock();
    // The person's last workspace, if any, is where a new session opens.
    const last = workspaceId || this.row("SELECT workspace_id FROM sessions WHERE user_id=? AND workspace_id IS NOT NULL ORDER BY last_seen_at DESC LIMIT 1", userId)?.workspace_id || this.row("SELECT workspace_id FROM memberships WHERE user_id=? AND deactivated_at IS NULL ORDER BY created_at LIMIT 1", userId)?.workspace_id || null;
    this.run("INSERT INTO sessions(hash, user_id, csrf, workspace_id, created_at, last_seen_at, rotated_at, expires_at, agent) VALUES(?,?,?,?,?,?,?,?,?)",
      hash(secret), userId, csrf, last, t, t, t, t + LIMITS.sessionMs, agent ? String(agent).slice(0, 200) : null);
    this.run("UPDATE users SET last_seen_at=? WHERE id=?", t, userId);
    return { token: secret, csrf, workspaceId: last && this.roleOf(last, userId) ? last : null, expiresAt: t + LIMITS.sessionMs };
  }
  /**
   * Who holds `token`: {user, session: {csrf, workspaceId, role}, rotated?: {token, expiresAt}},
   * or null. A token older than `rotateMs` is replaced (the new one in `rotated`); the old one
   * keeps working for `graceMs` and then ends.
   */
  session(secret) {
    if (!TOKEN.test(String(secret || ""))) return null;
    const t = this.clock();
    const s = this.row("SELECT * FROM sessions WHERE hash=?", hash(secret));
    if (!s || s.expires_at < t || s.last_seen_at < t - LIMITS.idleMs) return null;
    if (s.replaced_by) {
      if (!s.grace_until || s.grace_until < t) return null;
      const current = this.row("SELECT * FROM sessions WHERE hash=?", s.replaced_by);
      return current ? this.sessionView(current) : null;
    }
    const user = this.row("SELECT * FROM users WHERE id=?", s.user_id);
    if (!user) return null;
    let rotated = null;
    if (t - s.rotated_at >= LIMITS.rotateMs) {
      const fresh = token();
      this.tx(() => {
        this.run("INSERT INTO sessions(hash, user_id, csrf, workspace_id, created_at, last_seen_at, rotated_at, expires_at, agent) VALUES(?,?,?,?,?,?,?,?,?)",
          hash(fresh), s.user_id, s.csrf, s.workspace_id, s.created_at, t, t, s.expires_at, s.agent);
        this.run("UPDATE sessions SET replaced_by=?, grace_until=? WHERE hash=?", hash(fresh), t + LIMITS.graceMs, s.hash);
      });
      rotated = { token: fresh, expiresAt: s.expires_at };
    } else if (t - s.last_seen_at > 60 * 1000) this.run("UPDATE sessions SET last_seen_at=? WHERE hash=?", t, s.hash);
    return { ...this.sessionView({ ...s, last_seen_at: t }, user), ...(rotated ? { rotated } : {}) };
  }
  sessionView(s, user = this.row("SELECT * FROM users WHERE id=?", s.user_id)) {
    if (!user) return null;
    const role = s.workspace_id ? this.roleOf(s.workspace_id, user.id) : null;
    return { user: this.userView(user), session: { csrf: s.csrf, workspaceId: role ? s.workspace_id : null, role, expiresAt: s.expires_at } };
  }
  /** Logs out: this session and whatever replaced it. */
  logout(secret) {
    if (!TOKEN.test(String(secret || ""))) return { ok: true };
    const s = this.row("SELECT * FROM sessions WHERE hash=?", hash(secret));
    if (!s) return { ok: true };
    this.tx(() => {
      let at = s.hash;
      for (let i = 0; at && i < 50; i++) {
        const next = this.row("SELECT replaced_by FROM sessions WHERE hash=?", at)?.replaced_by || null;
        this.run("DELETE FROM sessions WHERE hash=?", at);
        at = next;
      }
      // Older tokens that this one replaced.
      this.run("DELETE FROM sessions WHERE user_id=? AND replaced_by IS NOT NULL AND grace_until < ?", s.user_id, this.clock() + LIMITS.graceMs + 1);
    });
    return { ok: true };
  }
  /** Every session of a person ends (removed or deactivated, or «cerrar todas las sesiones»). */
  revokeSessions(userId) {
    const n = this.row("SELECT count(*) AS n FROM sessions WHERE user_id=?", userId)?.n || 0;
    this.run("DELETE FROM sessions WHERE user_id=?", userId);
    return n;
  }
  /** This session (and the token that replaced it, if any) opens `workspaceId` from now on. */
  selectWorkspace(secret, workspaceId) {
    if (!TOKEN.test(String(secret || ""))) throw new DirectoryError("Inicia sesión.", 401, "session");
    const live = this.session(secret); // may replace the token: read the row after
    const row = live && this.row("SELECT * FROM sessions WHERE hash=?", hash(secret));
    if (!row) throw new DirectoryError("Inicia sesión.", 401, "session");
    const role = this.roleOf(workspaceId, row.user_id);
    if (!role) throw new DirectoryError("No perteneces a ese espacio.", 403, "member");
    this.run("UPDATE sessions SET workspace_id=? WHERE hash=? OR hash=?", workspaceId, row.hash, row.replaced_by || row.hash);
    return { workspaceId, role };
  }

  // ------------------------------------------------------------------ people
  userView(u) { return { id: u.id, email: u.email, name: u.name }; }
  user(id) { const u = this.row("SELECT * FROM users WHERE id=?", id); return u ? this.userView(u) : null; }
  rename(userId, name) {
    const clean = cleanName(name);
    if (!clean) throw new DirectoryError("Escribe tu nombre.");
    this.run("UPDATE users SET name=? WHERE id=?", clean, userId);
    return this.user(userId);
  }
  /** The name an import gave this address (a Slack export), for a person made now. */
  importedName(email) {
    const r = this.row("SELECT name FROM invitations WHERE email=? AND imported=1 AND name IS NOT NULL AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1", email);
    return r ? cleanName(r.name) : "";
  }

  // ------------------------------------------------------------------ workspaces
  /** The role of an active member; null for someone not in it or deactivated. */
  roleOf(workspaceId, userId) {
    return this.row("SELECT role FROM memberships WHERE workspace_id=? AND user_id=? AND deactivated_at IS NULL", workspaceId, userId)?.role || null;
  }
  /** The membership row as it is, deactivated or not. */
  membership(workspaceId, userId) {
    return this.row("SELECT role, deactivated_at FROM memberships WHERE workspace_id=? AND user_id=?", workspaceId, userId);
  }
  workspace(id) {
    const w = this.row("SELECT * FROM workspaces WHERE id=?", id);
    return w ? { id: w.id, name: w.name, createdAt: w.created_at, domains: parseDomains(w.domains) } : null;
  }
  workspacesOf(userId) {
    return this.rows("SELECT w.id, w.name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id=? AND m.deactivated_at IS NULL ORDER BY m.created_at, m.rowid", userId);
  }
  createWorkspace(userId, name) {
    const clean = cleanName(name, LIMITS.workspaceName);
    if (!clean) throw new DirectoryError("Ponle un nombre a la empresa.");
    if (!this.user(userId)) throw new DirectoryError("Inicia sesión.", 401);
    if ((this.row("SELECT count(*) AS n FROM workspaces WHERE created_by=?", userId)?.n || 0) >= LIMITS.workspacesPerPerson) throw new DirectoryError("Has creado demasiados espacios.", 429, "rate");
    const id = randomUUID(), t = this.clock();
    this.tx(() => {
      this.run("INSERT INTO workspaces(id, name, created_by, created_at) VALUES(?,?,?,?)", id, clean, userId, t);
      this.run("INSERT INTO memberships(workspace_id, user_id, role, created_at) VALUES(?,?,?,?)", id, userId, "owner", t);
    });
    return { id, name: clean, role: "owner" };
  }
  renameWorkspace(workspaceId, byUserId, name) {
    this.mustManage(workspaceId, byUserId);
    const clean = cleanName(name, LIMITS.workspaceName);
    if (!clean) throw new DirectoryError("Ponle un nombre a la empresa.");
    this.run("UPDATE workspaces SET name=? WHERE id=?", clean, workspaceId);
    return this.workspace(workspaceId);
  }
  /**
   * The domains whose addresses join this company on their own, as members, when they sign in
   * (exact domain; never a public mail provider). An empty list turns it off.
   */
  setDomains(workspaceId, byUserId, domains) {
    this.mustManage(workspaceId, byUserId);
    if (!Array.isArray(domains)) throw new DirectoryError("Escribe una lista de dominios.", 400, "domain");
    if (domains.length > 200) throw new DirectoryError(`Como mucho ${LIMITS.domains} dominios.`, 400, "domain");
    const clean = [];
    for (const d of domains) {
      const x = String(d ?? "").trim().toLowerCase().replace(/^@/, "");
      if (!x) continue;
      if (!DOMAIN.test(x)) throw new DirectoryError(`«${x.slice(0, 80)}» no es un dominio válido.`, 400, "domain");
      if (PUBLIC_MAIL_DOMAINS.has(x)) throw new DirectoryError(`${x} es un correo público: cualquiera puede tener una dirección ahí.`, 400, "public-domain");
      if (!clean.includes(x)) clean.push(x);
    }
    if (clean.length > LIMITS.domains) throw new DirectoryError(`Como mucho ${LIMITS.domains} dominios.`, 400, "domain");
    this.run("UPDATE workspaces SET domains=? WHERE id=?", clean.length ? JSON.stringify(clean) : null, workspaceId);
    return this.workspace(workspaceId);
  }
  /**
   * After a sign-in: the person joins, as member, every company that lists their address's
   * domain, unless they are (or were deactivated) in it already or an admin took them out (or
   * they left). Inside the sign-in's transaction. → the ids joined.
   */
  autoJoin(userId, email) {
    const domain = String(email || "").split("@")[1] || "";
    if (!domain || PUBLIC_MAIL_DOMAINS.has(domain)) return [];
    const t = this.clock(), joined = [];
    const candidates = this.rows(
      "SELECT id, domains FROM workspaces WHERE domains LIKE ? AND id NOT IN (SELECT workspace_id FROM memberships WHERE user_id=?) AND id NOT IN (SELECT workspace_id FROM departures WHERE user_id=?) ORDER BY created_at",
      `%"${domain}"%`, userId, userId);
    for (const w of candidates) {
      if (!parseDomains(w.domains).includes(domain)) continue;
      this.run("INSERT INTO memberships(workspace_id, user_id, role, created_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id, user_id) DO NOTHING", w.id, userId, "member", t);
      joined.push(w.id);
    }
    return joined;
  }
  /** The directory: who belongs to a workspace, with their role; deactivated people stay listed. */
  members(workspaceId) {
    return this.rows("SELECT u.id, u.email, u.name, m.role, m.created_at AS joinedAt, m.deactivated_at AS deactivatedAt FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id=? ORDER BY m.created_at, m.rowid", workspaceId)
      .map((m) => ({ ...m, deactivated: m.deactivatedAt != null }));
  }
  mustManage(workspaceId, userId) {
    const role = this.roleOf(workspaceId, userId);
    if (!role) throw new DirectoryError("No perteneces a ese espacio.", 403, "member");
    if (!MANAGERS.has(role)) throw new DirectoryError("Solo quien administra la empresa puede hacerlo.", 403, "role");
    return role;
  }
  /**
   * A role changes. Owners name admins and owners; admins move people between member and guest.
   * The last owner always stays one.
   */
  setRole(workspaceId, byUserId, userId, role) {
    if (!ROLES.includes(role)) throw new DirectoryError("Ese papel no existe.");
    const mine = this.mustManage(workspaceId, byUserId);
    const theirs = this.roleOf(workspaceId, userId);
    if (!theirs) throw new DirectoryError("Esa persona no está en la empresa.", 404);
    if (mine !== "owner" && (MANAGERS.has(theirs) || MANAGERS.has(role))) throw new DirectoryError("Solo quien es propietario cambia a quien administra.", 403, "role");
    if (theirs === "owner" && role !== "owner" && this.owners(workspaceId) <= 1) throw new DirectoryError("La empresa necesita al menos una persona propietaria.", 409, "last-owner");
    this.run("UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?", role, workspaceId, userId);
    return { id: userId, role };
  }
  /** Active owners. */
  owners(workspaceId) {
    return this.row("SELECT count(*) AS n FROM memberships WHERE workspace_id=? AND role='owner' AND deactivated_at IS NULL", workspaceId)?.n || 0;
  }
  /**
   * Someone leaves the workspace (taken out, or by themselves): their membership goes and every
   * session they have ends, so nothing they had open keeps working. A departure is kept so
   * auto-join by domain does not bring them back (a new invitation does).
   */
  removeMember(workspaceId, byUserId, userId) {
    const row = this.membership(workspaceId, userId);
    if (!row) throw new DirectoryError("Esa persona no está en la empresa.", 404);
    const theirs = row.role, active = !row.deactivated_at;
    if (byUserId !== userId) {
      const mine = this.mustManage(workspaceId, byUserId);
      if (mine !== "owner" && MANAGERS.has(theirs)) throw new DirectoryError("Solo quien es propietario saca a quien administra.", 403, "role");
    }
    if (active && theirs === "owner" && this.owners(workspaceId) <= 1) throw new DirectoryError("La empresa necesita al menos una persona propietaria.", 409, "last-owner");
    let revoked = 0;
    this.tx(() => {
      this.run("DELETE FROM memberships WHERE workspace_id=? AND user_id=?", workspaceId, userId);
      this.run("INSERT INTO departures(workspace_id, user_id, reason, at) VALUES(?,?,?,?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET reason=excluded.reason, at=excluded.at",
        workspaceId, userId, byUserId === userId ? "left" : "removed", this.clock());
      revoked = this.revokeSessions(userId);
    });
    return { removed: userId, revokedSessions: revoked };
  }
  /** The permission rules of removing someone, for deactivating or reactivating them. */
  mustManagePerson(workspaceId, byUserId, userId) {
    const mine = this.mustManage(workspaceId, byUserId);
    if (byUserId === userId) throw new DirectoryError("No puedes hacerlo contigo.", 400, "self");
    const row = this.membership(workspaceId, userId);
    if (!row) throw new DirectoryError("Esa persona no está en la empresa.", 404);
    if (mine !== "owner" && MANAGERS.has(row.role)) throw new DirectoryError("Solo quien es propietario cambia a quien administra.", 403, "role");
    return row;
  }
  /**
   * Someone is deactivated: they keep their place in the list (their name stays on what they
   * wrote) but cannot open the company, and every session they have ends now.
   */
  deactivateMember(workspaceId, byUserId, userId) {
    const row = this.mustManagePerson(workspaceId, byUserId, userId);
    if (row.deactivated_at) return { id: userId, deactivated: true, revokedSessions: 0 };
    if (row.role === "owner" && this.owners(workspaceId) <= 1) throw new DirectoryError("La empresa necesita al menos una persona propietaria.", 409, "last-owner");
    let revoked = 0;
    this.tx(() => {
      this.run("UPDATE memberships SET deactivated_at=? WHERE workspace_id=? AND user_id=?", this.clock(), workspaceId, userId);
      revoked = this.revokeSessions(userId);
    });
    return { id: userId, deactivated: true, revokedSessions: revoked };
  }
  reactivateMember(workspaceId, byUserId, userId) {
    const row = this.mustManagePerson(workspaceId, byUserId, userId);
    if (row.deactivated_at) this.run("UPDATE memberships SET deactivated_at=NULL WHERE workspace_id=? AND user_id=?", workspaceId, userId);
    return { id: userId, deactivated: false, role: row.role };
  }

  // ------------------------------------------------------------------ invitations
  /** An address's place in a company: null, "member" (active) or "deactivated". */
  standingOf(workspaceId, email) {
    const m = this.row("SELECT m.deactivated_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?", workspaceId, email);
    return m ? (m.deactivated_at ? "deactivated" : "member") : null;
  }
  invite(workspaceId, byUserId, { email, role = "member" }) {
    const mine = this.mustManage(workspaceId, byUserId);
    if (!["admin", "member", "guest"].includes(role)) throw new DirectoryError("Ese papel no existe.");
    if (role === "admin" && mine !== "owner") throw new DirectoryError("Solo quien es propietario invita a administrar.", 403, "role");
    const address = cleanEmail(email);
    const standing = this.standingOf(workspaceId, address);
    if (standing === "deactivated") throw new DirectoryError("Esa persona está desactivada: reactívala.", 409, "deactivated");
    if (standing) throw new DirectoryError("Esa persona ya está en la empresa.", 409, "member");
    this.limit("invite:" + workspaceId, LIMITS.invitesPerDay, "Demasiadas invitaciones por hoy.");
    const secret = token(), id = randomUUID(), t = this.clock();
    this.tx(() => {
      // A new invitation to the same address replaces the one still open.
      this.run("UPDATE invitations SET revoked_at=? WHERE workspace_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL", t, workspaceId, address);
      this.run("INSERT INTO invitations(id, hash, workspace_id, email, role, invited_by, created_at, expires_at) VALUES(?,?,?,?,?,?,?,?)", id, hash(secret), workspaceId, address, role, byUserId, t, t + LIMITS.inviteMs);
    });
    return { token: secret, invitation: { id, email: address, role, expiresAt: t + LIMITS.inviteMs } };
  }
  /**
   * People from an import (a Slack export): one open invitation each, never mailed and with no
   * link (the person finds it in «Invitaciones para ti» once signed in with that address). No
   * daily limit; at most 5000 per call. `existing`: already in the company or already invited.
   */
  importInvitations(workspaceId, byUserId, people) {
    const mine = this.mustManage(workspaceId, byUserId);
    if (!Array.isArray(people)) throw new DirectoryError("Envía una lista de personas.", 400, "people");
    if (people.length > LIMITS.importPerCall) throw new DirectoryError(`Como mucho ${LIMITS.importPerCall} personas cada vez.`, 413, "too-many");
    const t = this.clock(), seen = new Set(), problems = [];
    let created = 0, existing = 0, skipped = 0;
    const skip = (email, reason) => { skipped++; if (problems.length < 50) problems.push({ email, reason }); };
    this.tx(() => {
      for (const p of people) {
        let address;
        try { address = cleanEmail(p?.email); } catch { skip(String(p?.email ?? "").slice(0, 254), "invalid"); continue; }
        if (seen.has(address)) { existing++; continue; }
        seen.add(address);
        const standing = this.standingOf(workspaceId, address);
        if (standing === "deactivated") { skip(address, "deactivated"); continue; }
        if (standing) { existing++; continue; }
        if (this.row("SELECT 1 AS x FROM invitations WHERE workspace_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", workspaceId, address, t)) { existing++; continue; }
        let role = ["admin", "member", "guest"].includes(p?.role) ? p.role : "member";
        if (role === "admin" && mine !== "owner") role = "member";
        this.run("INSERT INTO invitations(id, hash, workspace_id, email, role, invited_by, created_at, expires_at, imported, name) VALUES(?,?,?,?,?,?,?,?,1,?)",
          randomUUID(), hash(token()), workspaceId, address, role, byUserId, t, t + LIMITS.importInviteMs, cleanName(p?.name) || null);
        created++;
      }
    });
    return { created, existing, skipped, problems };
  }
  invitations(workspaceId, byUserId) {
    this.mustManage(workspaceId, byUserId);
    return this.rows("SELECT i.id, i.email, i.role, i.created_at AS createdAt, i.expires_at AS expiresAt, u.name AS invitedBy, i.imported FROM invitations i LEFT JOIN users u ON u.id=i.invited_by WHERE i.workspace_id=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ? ORDER BY i.created_at DESC", workspaceId, this.clock())
      .map((i) => ({ ...i, imported: !!i.imported }));
  }
  revokeInvitation(workspaceId, byUserId, id) {
    this.mustManage(workspaceId, byUserId);
    this.run("UPDATE invitations SET revoked_at=? WHERE id=? AND workspace_id=? AND accepted_at IS NULL", this.clock(), id, workspaceId);
    return { ok: true };
  }
  /** What an invitation link shows before signing in: which company, from whom, for which address. */
  previewInvitation(secret) {
    if (!TOKEN.test(String(secret || ""))) throw new DirectoryError("Esa invitación no es válida.", 404, "invite");
    const i = this.row("SELECT i.*, w.name AS workspace, u.name AS inviter FROM invitations i JOIN workspaces w ON w.id=i.workspace_id LEFT JOIN users u ON u.id=i.invited_by WHERE i.hash=?", hash(secret));
    if (!i || i.revoked_at) throw new DirectoryError("Esa invitación no es válida.", 404, "invite");
    return { workspace: i.workspace, inviter: i.inviter || "Alguien", email: i.email, role: i.role, accepted: !!i.accepted_at, expired: i.expires_at < this.clock() };
  }
  /** The signed-in person takes the invitation: only the address it was sent to can. */
  acceptInvitation(secret, userId) {
    if (!TOKEN.test(String(secret || ""))) throw new DirectoryError("Esa invitación no es válida.", 404, "invite");
    return this.acceptRow(() => this.row("SELECT * FROM invitations WHERE hash=?", hash(secret)), userId);
  }
  /** The same, for an invitation listed in «Invitaciones para ti». */
  acceptInvitationById(id, userId) {
    return this.acceptRow(() => this.row("SELECT * FROM invitations WHERE id=?", String(id || "")), userId);
  }
  acceptRow(find, userId) {
    const user = this.user(userId);
    if (!user) throw new DirectoryError("Inicia sesión.", 401);
    return this.tx(() => {
      const i = find();
      if (!i || i.revoked_at) throw new DirectoryError("Esa invitación no es válida.", 404, "invite");
      if (i.accepted_at) {
        if (i.accepted_by === userId && this.roleOf(i.workspace_id, userId)) return { workspaceId: i.workspace_id, role: this.roleOf(i.workspace_id, userId) };
        throw new DirectoryError("Esa invitación ya se usó.", 410, "used");
      }
      if (i.expires_at < this.clock()) throw new DirectoryError("Esa invitación ha caducado. Pide otra.", 410, "expired");
      if (i.email !== user.email) throw new DirectoryError("Esta invitación es para " + i.email + ". Entra con ese correo para aceptarla.", 403, "email");
      const m = this.membership(i.workspace_id, userId);
      if (m?.deactivated_at) throw new DirectoryError("Tu acceso a esa empresa está desactivado. Habla con quien la administra.", 403, "deactivated");
      const role = m?.role || i.role;
      this.run("INSERT INTO memberships(workspace_id, user_id, role, created_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id, user_id) DO NOTHING", i.workspace_id, userId, i.role, this.clock());
      this.run("UPDATE invitations SET accepted_at=?, accepted_by=? WHERE id=?", this.clock(), userId, i.id);
      this.run("DELETE FROM departures WHERE workspace_id=? AND user_id=?", i.workspace_id, userId);
      return { workspaceId: i.workspace_id, role };
    });
  }
  /** Open invitations to this person's address, in companies they are not in yet. */
  invitationsForEmail(userId) {
    const user = this.user(userId);
    if (!user) throw new DirectoryError("Inicia sesión.", 401);
    return this.rows(
      "SELECT i.id, i.workspace_id AS workspaceId, w.name AS workspace, COALESCE(u.name, 'Alguien') AS inviter, i.role, i.created_at AS createdAt, i.expires_at AS expiresAt FROM invitations i JOIN workspaces w ON w.id=i.workspace_id LEFT JOIN users u ON u.id=i.invited_by WHERE i.email=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ? AND i.workspace_id NOT IN (SELECT workspace_id FROM memberships WHERE user_id=?) ORDER BY i.created_at DESC",
      user.email, this.clock(), userId);
  }

  // ------------------------------------------------------------------ the desktop app signs in (Phase 5)
  /**
   * The desktop asks to sign in: an id (not secret: it goes to the browser), a `poll` token only
   * the app holds and a code both screens show. The person approves it in their browser (signed in
   * there as usual), which hands back a second code to the app (a colmena:// link, or typed).
   * Only an app holding both the poll token and that code gets a session of its own: someone who
   * sends you their request cannot get one, because the hand-back reaches your computer, not theirs.
   */
  startDesktop({ name = null, ip = null } = {}) {
    if (ip) this.limit("desktop:ip:" + String(ip).slice(0, 64), LIMITS.desktopPerIp);
    const id = randomUUID(), poll = token(), code = shortCode(), t = this.clock();
    this.run("INSERT INTO desktop_signins(id, poll_hash, user_code, name, created_at, expires_at, ip) VALUES(?,?,?,?,?,?,?)", id, hash(poll), code, cleanName(name, 60) || "Ordenador", t, t + LIMITS.desktopMs, ip ? String(ip).slice(0, 64) : null);
    return { id, poll, code, expiresAt: t + LIMITS.desktopMs };
  }
  desktopRow(id) {
    const row = /^[0-9a-f-]{36}$/.test(String(id || "")) ? this.row("SELECT * FROM desktop_signins WHERE id=?", id) : null;
    if (!row) throw new DirectoryError("Esa petición no existe. Vuelve a empezar desde Colmena en tu ordenador.", 404, "desktop");
    return row;
  }
  /** What the browser shows before approving: the computer's name and the code it shows. */
  previewDesktop(id) {
    const row = this.desktopRow(id);
    const state = row.used_at ? "used" : row.expires_at < this.clock() ? "expired" : row.approved_at ? "approved" : "pending";
    return { id: row.id, name: row.name, code: row.user_code, state, expiresAt: row.expires_at };
  }
  /** You approve it, signed in: the hand-back code goes to your computer (never stored in the clear). */
  approveDesktop(id, userId, workspaceId = null) {
    return this.tx(() => {
      const row = this.desktopRow(id);
      if (row.used_at || row.approved_at) throw new DirectoryError("Esta petición ya se usó. Vuelve a empezar desde Colmena en tu ordenador.", 410, "used");
      if (row.expires_at < this.clock()) throw new DirectoryError("Esta petición ha caducado. Vuelve a empezar desde Colmena en tu ordenador.", 410, "expired");
      const handback = shortCode();
      const ws = workspaceId && this.roleOf(workspaceId, userId) ? workspaceId : null;
      this.run("UPDATE desktop_signins SET user_id=?, workspace_id=?, approved_at=?, handback_hash=? WHERE id=?", userId, ws, this.clock(), hash(cleanCode(handback)), row.id);
      return { handback, name: row.name };
    });
  }
  /** The app asks: {pending} until approved; with the poll token and the hand-back code, a session. */
  finishDesktop({ id, poll, handback = "", agent = null }) {
    if (!TOKEN.test(String(poll || ""))) throw new DirectoryError("Petición no válida.", 400, "desktop");
    // A wrong code is counted in its own write (a refusal thrown inside the transaction would undo it).
    const out = this.tx(() => {
      const row = this.desktopRow(id);
      if (hash(poll) !== row.poll_hash) throw new DirectoryError("Petición no válida.", 403, "desktop");
      if (row.used_at) throw new DirectoryError("Esta petición ya se usó. Vuelve a empezar.", 410, "used");
      if (row.expires_at < this.clock()) throw new DirectoryError("Esta petición ha caducado. Vuelve a empezar.", 410, "expired");
      if (!row.approved_at) return { pending: true, code: row.user_code };
      const given = cleanCode(handback);
      if (!given) return { pending: true, approved: true, code: row.user_code };
      if (hash(given) !== row.handback_hash) {
        const attempts = row.attempts + 1;
        this.run("UPDATE desktop_signins SET attempts=?, used_at=? WHERE id=?", attempts, attempts >= LIMITS.desktopAttempts ? this.clock() : null, row.id);
        return { wrong: attempts };
      }
      this.run("UPDATE desktop_signins SET used_at=? WHERE id=?", this.clock(), row.id);
      const user = this.row("SELECT * FROM users WHERE id=?", row.user_id);
      if (!user) throw new DirectoryError("Esa cuenta ya no existe.", 410, "account");
      return { user: this.userView(user), session: this.createSession(user.id, { agent, workspaceId: row.workspace_id }) };
    });
    if (out.wrong) throw new DirectoryError(out.wrong >= LIMITS.desktopAttempts ? "Demasiados códigos equivocados. Vuelve a empezar." : "Ese código no es el que te dio el navegador.", 403, "handback");
    return out;
  }

  // ------------------------------------------------------------------ dev mail (no provider yet)
  keepDevMail({ email, kind, url }) {
    this.run("INSERT INTO outbox(id, email, kind, url, created_at) VALUES(?,?,?,?,?)", randomUUID(), cleanEmail(email), kind, url, this.clock());
  }
  devMail(email) {
    return this.rows("SELECT email, kind, url, created_at AS at FROM outbox WHERE email=? ORDER BY created_at DESC LIMIT 5", cleanEmail(email));
  }
}
