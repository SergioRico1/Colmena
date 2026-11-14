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
  invitesPerDay: 50, // per workspace
  workspacesPerPerson: 10,
  name: 80,
  workspaceName: 60,
});
export const ROLES = Object.freeze(["owner", "admin", "member", "guest"]);
const MANAGERS = new Set(["owner", "admin"]);

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
export function cleanEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (e.length > 254 || !EMAIL.test(e)) throw new DirectoryError("Escribe un correo válido.", 400, "email");
  return e;
}
const cleanName = (name, max = LIMITS.name) => String(name || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** Only a path of this site: «/sala/x», never «//elsewhere» or a full URL. */
export const safeNext = (next) => (typeof next === "string" && /^\/(?![/\\])[^\s]{0,300}$/.test(next) ? next : "/");

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
CREATE TABLE IF NOT EXISTS rate (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, email TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, created_at INTEGER NOT NULL);
`;

/**
 * `storage`: a Durable Object's storage ({sql, transactionSync}); `clock`: () => ms.
 */
export class DirectoryCore {
  constructor(storage, { clock = () => Date.now() } = {}) {
    this.storage = storage;
    this.sql = storage.sql;
    this.clock = clock;
    this.sql.exec(SCHEMA);
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
  /** Upkeep: expired links, sessions, rate windows and dev mail go. */
  sweep() {
    const t = this.clock();
    this.run("DELETE FROM links WHERE expires_at < ?", t - 24 * 3600 * 1000);
    this.run("DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ? OR (grace_until IS NOT NULL AND grace_until < ?)", t, t - LIMITS.idleMs, t);
    this.run("DELETE FROM rate WHERE window_start < ?", t - LIMITS.rateWindowMs);
    this.run("DELETE FROM outbox WHERE created_at < ?", t - 30 * 60 * 1000);
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
  /** The link is used: the person (made now if new) and a new session. Works once, for 15 minutes. */
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
        user = { id: randomUUID(), email: link.email, name: cleanName(link.email.split("@")[0]) || "Persona", created_at: this.clock() };
        this.run("INSERT INTO users(id, email, name, created_at) VALUES(?,?,?,?)", user.id, user.email, user.name, user.created_at);
        this.run("INSERT INTO identities(provider, subject, user_id, created_at) VALUES('email', ?, ?, ?)", user.email, user.id, user.created_at);
      }
      const session = this.createSession(user.id, { agent });
      return { user: this.userView(user), session, next: link.next, isNew };
    });
  }

  /**
   * Sign-in by another provider later (Google, Microsoft, GitHub): the provider's verified
   * subject and email find or make the person. Not wired to a route yet; the shape the OAuth
   * callbacks will use.
   */
  signInWith({ provider, subject, email, name = null, agent = null }) {
    if (!/^[a-z]{2,20}$/.test(provider || "") || provider === "email" || !subject) throw new DirectoryError("Proveedor no válido.");
    const address = cleanEmail(email);
    return this.tx(() => {
      const known = this.row("SELECT user_id FROM identities WHERE provider=? AND subject=?", provider, String(subject));
      let user = known ? this.row("SELECT * FROM users WHERE id=?", known.user_id) : this.row("SELECT * FROM users WHERE email=?", address);
      if (!user) {
        user = { id: randomUUID(), email: address, name: cleanName(name) || cleanName(address.split("@")[0]) || "Persona", created_at: this.clock() };
        this.run("INSERT INTO users(id, email, name, created_at) VALUES(?,?,?,?)", user.id, user.email, user.name, user.created_at);
      }
      if (!known) this.run("INSERT INTO identities(provider, subject, user_id, created_at) VALUES(?,?,?,?)", provider, String(subject), user.id, this.clock());
      return { user: this.userView(user), session: this.createSession(user.id, { agent }) };
    });
  }

  // ------------------------------------------------------------------ sessions
  createSession(userId, { agent = null, workspaceId = null } = {}) {
    const secret = token(), csrf = token(), t = this.clock();
    // The person's last workspace, if any, is where a new session opens.
    const last = workspaceId || this.row("SELECT workspace_id FROM sessions WHERE user_id=? AND workspace_id IS NOT NULL ORDER BY last_seen_at DESC LIMIT 1", userId)?.workspace_id || this.row("SELECT workspace_id FROM memberships WHERE user_id=? ORDER BY created_at LIMIT 1", userId)?.workspace_id || null;
    this.run("INSERT INTO sessions(hash, user_id, csrf, workspace_id, created_at, last_seen_at, rotated_at, expires_at, agent) VALUES(?,?,?,?,?,?,?,?,?)",
      hash(secret), userId, csrf, last, t, t, t, t + LIMITS.sessionMs, agent ? String(agent).slice(0, 200) : null);
    this.run("UPDATE users SET last_seen_at=? WHERE id=?", t, userId);
    return { token: secret, csrf, workspaceId: last, expiresAt: t + LIMITS.sessionMs };
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
  /** Every session of a person ends (removed from a workspace, or «cerrar todas las sesiones»). */
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

  // ------------------------------------------------------------------ workspaces
  roleOf(workspaceId, userId) {
    return this.row("SELECT role FROM memberships WHERE workspace_id=? AND user_id=?", workspaceId, userId)?.role || null;
  }
  workspace(id) {
    const w = this.row("SELECT * FROM workspaces WHERE id=?", id);
    return w ? { id: w.id, name: w.name, createdAt: w.created_at } : null;
  }
  workspacesOf(userId) {
    return this.rows("SELECT w.id, w.name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id=? ORDER BY m.created_at, m.rowid", userId);
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
  /** The directory: who belongs to a workspace, with their role. */
  members(workspaceId) {
    return this.rows("SELECT u.id, u.email, u.name, m.role, m.created_at AS joinedAt FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id=? ORDER BY m.created_at, m.rowid", workspaceId);
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
  owners(workspaceId) {
    return this.row("SELECT count(*) AS n FROM memberships WHERE workspace_id=? AND role='owner'", workspaceId)?.n || 0;
  }
  /**
   * Someone leaves the workspace (taken out, or by themselves): their membership goes and every
   * session they have ends, so nothing they had open keeps working.
   */
  removeMember(workspaceId, byUserId, userId) {
    const theirs = this.roleOf(workspaceId, userId);
    if (!theirs) throw new DirectoryError("Esa persona no está en la empresa.", 404);
    if (byUserId !== userId) {
      const mine = this.mustManage(workspaceId, byUserId);
      if (mine !== "owner" && MANAGERS.has(theirs)) throw new DirectoryError("Solo quien es propietario saca a quien administra.", 403, "role");
    }
    if (theirs === "owner" && this.owners(workspaceId) <= 1) throw new DirectoryError("La empresa necesita al menos una persona propietaria.", 409, "last-owner");
    let revoked = 0;
    this.tx(() => {
      this.run("DELETE FROM memberships WHERE workspace_id=? AND user_id=?", workspaceId, userId);
      revoked = this.revokeSessions(userId);
    });
    return { removed: userId, revokedSessions: revoked };
  }

  // ------------------------------------------------------------------ invitations
  invite(workspaceId, byUserId, { email, role = "member" }) {
    const mine = this.mustManage(workspaceId, byUserId);
    if (!["admin", "member", "guest"].includes(role)) throw new DirectoryError("Ese papel no existe.");
    if (role === "admin" && mine !== "owner") throw new DirectoryError("Solo quien es propietario invita a administrar.", 403, "role");
    const address = cleanEmail(email);
    const already = this.row("SELECT 1 AS x FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?", workspaceId, address);
    if (already) throw new DirectoryError("Esa persona ya está en la empresa.", 409, "member");
    this.limit("invite:" + workspaceId, LIMITS.invitesPerDay, "Demasiadas invitaciones por hoy.");
    const secret = token(), id = randomUUID(), t = this.clock();
    this.tx(() => {
      // A new invitation to the same address replaces the one still open.
      this.run("UPDATE invitations SET revoked_at=? WHERE workspace_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL", t, workspaceId, address);
      this.run("INSERT INTO invitations(id, hash, workspace_id, email, role, invited_by, created_at, expires_at) VALUES(?,?,?,?,?,?,?,?)", id, hash(secret), workspaceId, address, role, byUserId, t, t + LIMITS.inviteMs);
    });
    return { token: secret, invitation: { id, email: address, role, expiresAt: t + LIMITS.inviteMs } };
  }
  invitations(workspaceId, byUserId) {
    this.mustManage(workspaceId, byUserId);
    return this.rows("SELECT i.id, i.email, i.role, i.created_at AS createdAt, i.expires_at AS expiresAt, u.name AS invitedBy FROM invitations i LEFT JOIN users u ON u.id=i.invited_by WHERE i.workspace_id=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ? ORDER BY i.created_at DESC", workspaceId, this.clock());
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
    const user = this.user(userId);
    if (!user) throw new DirectoryError("Inicia sesión.", 401);
    return this.tx(() => {
      const i = this.row("SELECT * FROM invitations WHERE hash=?", hash(secret));
      if (!i || i.revoked_at) throw new DirectoryError("Esa invitación no es válida.", 404, "invite");
      if (i.accepted_at) {
        if (i.accepted_by === userId) return { workspaceId: i.workspace_id, role: this.roleOf(i.workspace_id, userId) };
        throw new DirectoryError("Esa invitación ya se usó.", 410, "used");
      }
      if (i.expires_at < this.clock()) throw new DirectoryError("Esa invitación ha caducado. Pide otra.", 410, "expired");
      if (i.email !== user.email) throw new DirectoryError("Esta invitación es para " + i.email + ". Entra con ese correo para aceptarla.", 403, "email");
      const role = this.roleOf(i.workspace_id, userId) || i.role;
      this.run("INSERT INTO memberships(workspace_id, user_id, role, created_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id, user_id) DO NOTHING", i.workspace_id, userId, i.role, this.clock());
      this.run("UPDATE invitations SET accepted_at=?, accepted_by=? WHERE id=?", this.clock(), userId, i.id);
      return { workspaceId: i.workspace_id, role };
    });
  }

  // ------------------------------------------------------------------ dev mail (no provider yet)
  keepDevMail({ email, kind, url }) {
    this.run("INSERT INTO outbox(id, email, kind, url, created_at) VALUES(?,?,?,?,?)", randomUUID(), cleanEmail(email), kind, url, this.clock());
  }
  devMail(email) {
    return this.rows("SELECT email, kind, url, created_at AS at FROM outbox WHERE email=? ORDER BY created_at DESC LIMIT 5", cleanEmail(email));
  }
}
