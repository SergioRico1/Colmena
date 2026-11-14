// Team messaging of a hosted workspace (docs/CLOUD.md › Phase 2): channels (public, private,
// direct and group messages), messages with threads, mentions, reactions, pins, files and link
// previews, per-person read state and drafts, a search index, notification decisions, profiles,
// the audit log, retention and the people of a Slack import ("ghosts").
//
// It keeps its own tables in the workspace's SQLite (the store's driver: a Durable Object's SQL
// deployed, node:sqlite or the DO fake in tests) instead of the store's records, because a busy
// channel holds tens of thousands of messages that must be read by pages (indexes on
// channel/seq) without decrypting the rest. Bodies are sealed with the store's own cipher
// (AES-256-GCM, bound to their table and id): what the platform's operators could read are ids,
// sequence numbers, times and flags. The search index is a keyed token index (HMAC of each word's
// prefixes under a per-workspace key), not FTS5: FTS5 works in DO SQLite, but its index would keep
// every word of every message in the clear and undo the encryption above.
//
// Every rule about who sees what lives here and is enforced for every way out: the API (routes in
// chat-routes.mjs), the live feed (`emit` audiences, filtered again per socket by the host) and
// search (only channels the person may read).
import { createHmac, randomBytes, randomUUID } from "node:crypto";

export const CHAT_LIMITS = Object.freeze({
  text: 40000,
  channelName: 80,
  topic: 250,
  description: 1000,
  groupMax: 8, // people in a group DM besides you
  page: 50,
  maxPage: 200,
  filesPerMessage: 10,
  fileMax: 100 * 1024 * 1024,
  reactionsPerMessage: 50,
  keywords: 20,
  statusText: 100,
  title: 80,
  searchPage: 30,
});

export class ChatError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (message, status = 400, code = null) => { throw new ChatError(message, status, code); };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_channels (id TEXT PRIMARY KEY, kind TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0, last_at INTEGER, dm_key TEXT UNIQUE, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS chat_members (channel TEXT NOT NULL, person TEXT NOT NULL, joined_at INTEGER NOT NULL, read_seq INTEGER NOT NULL DEFAULT 0, notify TEXT NOT NULL DEFAULT 'default', muted INTEGER NOT NULL DEFAULT 0, draft BLOB, PRIMARY KEY(channel, person)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS chat_members_person ON chat_members(person);
CREATE TABLE IF NOT EXISTS chat_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, channel TEXT NOT NULL, thread INTEGER, top INTEGER NOT NULL, author TEXT, at INTEGER NOT NULL, edited_at INTEGER, deleted INTEGER NOT NULL DEFAULT 0, replies INTEGER NOT NULL DEFAULT 0, last_reply_at INTEGER, pinned INTEGER NOT NULL DEFAULT 0, has_file INTEGER NOT NULL DEFAULT 0, has_link INTEGER NOT NULL DEFAULT 0, data BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS chat_messages_channel ON chat_messages(channel, top, seq);
CREATE INDEX IF NOT EXISTS chat_messages_thread ON chat_messages(thread, seq) WHERE thread IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_messages_at ON chat_messages(at);
CREATE INDEX IF NOT EXISTS chat_messages_pinned ON chat_messages(channel, seq) WHERE pinned=1;
CREATE TABLE IF NOT EXISTS chat_terms (term TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY(term, seq)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS chat_mentions (person TEXT NOT NULL, seq INTEGER NOT NULL, channel TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0, mailed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(person, seq)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS chat_mentions_due ON chat_mentions(mailed, at);
CREATE TABLE IF NOT EXISTS chat_people (person TEXT PRIMARY KEY, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS chat_push (id TEXT PRIMARY KEY, person TEXT NOT NULL, created_at INTEGER NOT NULL, data BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS chat_push_person ON chat_push(person);
CREATE TABLE IF NOT EXISTS chat_files (id TEXT PRIMARY KEY, channel TEXT NOT NULL, seq INTEGER, uploader TEXT, at INTEGER NOT NULL, size INTEGER NOT NULL, key TEXT NOT NULL, data BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS chat_files_seq ON chat_files(seq);
CREATE TABLE IF NOT EXISTS chat_audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT, action TEXT NOT NULL, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS chat_kv (key TEXT PRIMARY KEY, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS chat_ghosts (id TEXT PRIMARY KEY, email TEXT, person TEXT, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS chat_import_map (import TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(import, kind, key)) WITHOUT ROWID;
`;

const SETTINGS_DEFAULTS = Object.freeze({ defaultChannels: [], retentionDays: 0, digestMinutes: 30 });
const MANAGERS = new Set(["owner", "admin"]);
const NOTIFY = new Set(["default", "all", "mentions", "nothing"]);

// ---- text ----------------------------------------------------------------------------------
const STOP = new Set(("de la que el en y a los del se las por un para con no una su al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre " +
  "tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros " +
  "the and to of in is it you that he was for on are as with his they at be this have from or one had by but not what all were we when your can said there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more go see no way could my than first been call who its now find long down did get come made may part " +
  "http https www com es org net").split(" "));
/** The words of a stored message text: markup out, accents and case folded, each once. */
export function words(text) {
  const plain = String(text || "")
    .replace(/<[@#!][^>]*>/g, " ")
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]*)>/g, " $1 $2 ")
    .replace(/&(?:lt|gt|amp);/g, " ")
    .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return [...new Set(plain.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && w.length <= 40))];
}
/** The index terms of a text: 3- and 5-letter prefixes of each word (2-letter words whole). */
function termsOf(text) {
  const out = new Set();
  for (const w of words(text)) {
    if (STOP.has(w)) continue;
    if (w.length < 3) out.add("w:" + w);
    else {
      out.add("p3:" + w.slice(0, 3));
      if (w.length >= 5) out.add("p5:" + w.slice(0, 5));
    }
  }
  return out;
}
/** The term a query word looks up (the rest is checked on the decrypted text). */
function queryTerm(word) {
  if (word.length < 3) return "w:" + word;
  return word.length >= 5 ? "p5:" + word.slice(0, 5) : "p3:" + word.slice(0, 3);
}
const MENTION = /<@([A-Za-z0-9:_.-]{1,80})>/g;
/** People named in a text (`<@id>`), and whether it calls the channel (`<!channel>`) or who is here (`<!here>`). */
export function mentionsIn(text) {
  const s = String(text || "");
  return { people: [...new Set([...s.matchAll(MENTION)].map((m) => m[1]))], channel: /<!(?:channel|everyone)>/.test(s), here: /<!here>/.test(s) };
}
/** The text for a notification or a mail: markup turned into names, no escapes. */
export function plainText(text, nameOf = () => null, channelName = () => null) {
  return String(text || "")
    .replace(/<@([^>]+)>/g, (_, id) => "@" + (nameOf(id) || "alguien"))
    .replace(/<#([^>|]+)(?:\|([^>]*))?>/g, (_, id, label) => "#" + (channelName(id) || label || "canal"))
    .replace(/<!channel>|<!everyone>/g, "@canal").replace(/<!here>/g, "@aquí")
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]*)>/g, "$2").replace(/<((?:https?|mailto):[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
const cleanLine = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** A channel name as people type it → as it is kept: lower case, dashes, letters (accents too), digits, _ and -. */
export function channelName(raw) {
  const name = String(raw || "").trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]+/gu, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, CHAT_LIMITS.channelName);
  return name;
}
const EMOJI_OK = /^[^\s<>&"']{1,32}$/u;
const clock = () => Date.now();
const dayStart = (s) => { const t = Date.parse(s + "T00:00:00Z"); return Number.isFinite(t) ? t : null; };

/** Local "HH:MM" and weekday (0 Sunday) of `ms` in an IANA time zone (UTC when unknown). */
export function localTime(ms, tz) {
  let parts;
  try { parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(ms)); }
  catch { parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(ms)); }
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { hm: get("hour").padStart(2, "0") + ":" + get("minute"), day };
}
/** «No molestar» now: until a time, or inside a daily schedule (in the person's time zone). */
export function doNotDisturb(profile, ms) {
  const dnd = profile?.dnd;
  if (!dnd) return false;
  if (dnd.until && dnd.until > ms) return true;
  const s = dnd.schedule;
  if (!s?.on || !/^\d\d:\d\d$/.test(s.from || "") || !/^\d\d:\d\d$/.test(s.to || "")) return false;
  const { hm, day } = localTime(ms, profile.tz);
  if (Array.isArray(s.days) && s.days.length && !s.days.includes(day)) {
    // Overnight windows started yesterday still count.
    if (!(s.from > s.to && hm < s.to && s.days.includes((day + 6) % 7))) return false;
    return true;
  }
  return s.from <= s.to ? hm >= s.from && hm < s.to : hm >= s.from || hm < s.to;
}

export class TeamChat {
  /**
   * `store`: the workspace's store (its driver and cipher are used); `people`: {list() → members
   * [{id, name, email, role, deactivated}], get(id)}; `emit(event, {people, channel})`: live frames
   * for those people (and whoever watches `channel`); `presence()` → Map(id → "active"|"away");
   * `blobs`: server/cloud/blobs.mjs; `push(personId, payload)`: a Web Push to their devices;
   * `previews(url)` → a link preview; `defer(promise)`: background work after a response.
   */
  constructor({ store, people, emit = () => {}, presence = () => new Map(), blobs = null, push = null, previews = null, defer = (p) => p?.catch?.(() => {}), clock: now = clock, log = () => {} }) {
    this.store = store;
    this.db = store.db;
    this.cipher = store.cipher;
    this.people = people;
    this.emit = emit;
    this.presence = presence;
    this.blobs = blobs;
    this.push = push;
    this.previews = previews;
    this.defer = defer;
    this.now = now;
    this.log = log;
    this.db.exec(SCHEMA);
    this.termKey = this.kvGet("term-key")?.key ? Buffer.from(this.kvGet("term-key").key, "base64") : null;
    if (!this.termKey) {
      this.termKey = randomBytes(32);
      this.kvSet("term-key", { key: this.termKey.toString("base64") });
    }
    this.termCache = new Map();
    if (!this.q("SELECT 1 AS x FROM chat_channels WHERE kind IN ('public','private') LIMIT 1").get()) this.seedGeneral();
  }

  // ------------------------------------------------------------------ storage helpers
  q(text) { return this.store.sql(text); }
  seal(value, aad) {
    const text = JSON.stringify(value);
    return this.cipher ? this.cipher.encrypt(text, "chat\u0000" + aad) : Buffer.from(text, "utf8");
  }
  open(blob, aad) {
    if (blob == null) return null;
    const b = Buffer.from(blob instanceof ArrayBuffer ? new Uint8Array(blob) : blob);
    return JSON.parse(this.cipher ? this.cipher.decrypt(b, "chat\u0000" + aad) : b.toString("utf8"));
  }
  tx(fn) { return this.store.tx(fn); }
  kvGet(key) { const r = this.q("SELECT data FROM chat_kv WHERE key=?").get(key); return r ? this.open(r.data, "kv\u0000" + key) : null; }
  kvSet(key, value) { this.q("INSERT INTO chat_kv(key, data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(key, this.seal(value, "kv\u0000" + key)); }
  kvDelete(key) { this.q("DELETE FROM chat_kv WHERE key=?").run(key); }
  hashTerm(term) {
    let h = this.termCache.get(term);
    if (!h) {
      h = createHmac("sha256", this.termKey).update(term).digest("base64url").slice(0, 16);
      if (this.termCache.size > 50000) this.termCache.clear();
      this.termCache.set(term, h);
    }
    return h;
  }
  index(seq, text) {
    const put = this.q("INSERT OR IGNORE INTO chat_terms(term, seq) VALUES(?,?)");
    for (const t of termsOf(text)) put.run(this.hashTerm(t), seq);
  }
  unindex(seq, text) {
    const del = this.q("DELETE FROM chat_terms WHERE term=? AND seq=?");
    for (const t of termsOf(text)) del.run(this.hashTerm(t), seq);
  }

  // ------------------------------------------------------------------ settings, people
  settings() { return { ...SETTINGS_DEFAULTS, ...(this.kvGet("settings") || {}) }; }
  member(id) { const m = id ? this.people.get(id) : null; return m && !m.deactivated ? m : null; }
  isAdmin(person) { return MANAGERS.has(this.member(person?.id)?.role); }
  must(person) {
    const m = this.member(person?.id);
    if (!m) fail("Ya no perteneces a este espacio.", 403, "member");
    return m;
  }
  mustAdmin(person) {
    const m = this.must(person);
    if (!MANAGERS.has(m.role)) fail("Solo quien administra la empresa puede hacerlo.", 403, "role");
    return m;
  }
  profile(id) {
    const r = this.q("SELECT data FROM chat_people WHERE person=?").get(id);
    return r ? this.open(r.data, "people\u0000" + id) : {};
  }
  setProfile(id, profile) { this.q("INSERT INTO chat_people(person, data) VALUES(?,?) ON CONFLICT(person) DO UPDATE SET data=excluded.data").run(id, this.seal(profile, "people\u0000" + id)); }
  /** What everyone in the workspace sees of a person's profile (keywords and devices stay theirs). */
  publicProfile(id, p = this.profile(id), at = this.now()) {
    const status = p.statusText || p.statusEmoji ? (p.statusUntil && p.statusUntil < at ? null : { text: p.statusText || "", emoji: p.statusEmoji || "", until: p.statusUntil || null }) : null;
    return { title: p.title || "", tz: p.tz || null, status, away: !!p.away, dnd: doNotDisturb(p, at), dndUntil: p.dnd?.until && p.dnd.until > at ? p.dnd.until : null };
  }
  /** Changes to your own profile: title, time zone, status, «ausente», «no molestar», keywords, mail digest. */
  updateMe(person, patch = {}) {
    this.must(person);
    const p = this.profile(person.id);
    if ("title" in patch) p.title = cleanLine(patch.title, CHAT_LIMITS.title);
    if ("tz" in patch) {
      const tz = patch.tz ? String(patch.tz).slice(0, 64) : null;
      if (tz) { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { fail("Zona horaria no válida."); } }
      p.tz = tz;
    }
    if ("statusText" in patch) p.statusText = cleanLine(patch.statusText, CHAT_LIMITS.statusText);
    if ("statusEmoji" in patch) { const e = String(patch.statusEmoji || ""); if (e && !EMOJI_OK.test(e)) fail("Emoji no válido."); p.statusEmoji = e; }
    if ("statusUntil" in patch) p.statusUntil = Number.isFinite(patch.statusUntil) ? patch.statusUntil : null;
    if ("away" in patch) p.away = !!patch.away;
    if ("dnd" in patch) {
      const d = patch.dnd || {};
      const hm = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || "")) ? v : null);
      const s = d.schedule || null;
      p.dnd = {
        until: Number.isFinite(d.until) && d.until > this.now() ? Math.min(d.until, this.now() + 400 * 86400000) : null,
        schedule: s ? { on: !!s.on, from: hm(s.from) || "22:00", to: hm(s.to) || "08:00", days: Array.isArray(s.days) ? [...new Set(s.days.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))] : [] } : (p.dnd?.schedule || null),
      };
    }
    if ("keywords" in patch) p.keywords = [...new Set((Array.isArray(patch.keywords) ? patch.keywords : []).map((k) => cleanLine(k, 40).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()).filter((k) => k.length >= 2))].slice(0, CHAT_LIMITS.keywords);
    if ("digest" in patch) p.digest = patch.digest !== false;
    this.setProfile(person.id, p);
    this.emit({ type: "chat.profile", person: person.id, profile: this.publicProfile(person.id, p) }, { people: "all" });
    return this.myProfile(person.id, p);
  }
  myProfile(id, p = this.profile(id)) { return { ...this.publicProfile(id, p), keywords: p.keywords || [], digest: p.digest !== false, dnd: p.dnd || null, dndNow: doNotDisturb(p, this.now()), statusText: p.statusText || "", statusEmoji: p.statusEmoji || "", statusUntil: p.statusUntil || null }; }
  /** «Personas»: everyone in the workspace (deactivated people flagged), with profiles and presence. */
  directory() {
    const online = this.presence();
    const at = this.now();
    return this.people.list().map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, deactivated: !!m.deactivated, ...this.publicProfile(m.id, undefined, at), presence: m.deactivated ? "offline" : online.get(m.id) || "offline" }));
  }

  // ------------------------------------------------------------------ channels
  row(id) { return typeof id === "string" ? this.q("SELECT * FROM chat_channels WHERE id=?").get(id) || null : null; }
  meta(row) { return this.open(row.data, "channel\u0000" + row.id); }
  membership(channel, person) { return this.q("SELECT * FROM chat_members WHERE channel=? AND person=?").get(channel, person) || null; }
  memberIds(channel) { return this.q("SELECT person FROM chat_members WHERE channel=?").all(channel).map((r) => r.person); }
  /** Who may read a channel: members; and, for a public one, anyone in the workspace who is not a guest. */
  canRead(person, row) {
    const m = this.member(person?.id);
    if (!m || !row) return false;
    if (row.kind === "public" && m.role !== "guest") return true;
    return !!this.membership(row.id, m.id);
  }
  mustRead(person, id) {
    const row = this.row(id);
    if (!row || !this.canRead(person, row)) fail("No existe ese canal.", 404, "channel");
    return row;
  }
  /** Posting: readable, not archived, and a member (a non-guest posting in a public channel joins it). */
  mustPost(person, id) {
    const row = this.mustRead(person, id);
    if (row.archived) fail("Este canal está archivado: ya no admite mensajes.", 409, "archived");
    if (!this.membership(id, person.id)) this.addMember(row, person.id);
    return row;
  }
  /** Changing a channel: its members (public/private), or an admin of the workspace for any channel. */
  mustManageChannel(person, row) {
    const m = this.must(person);
    if (MANAGERS.has(m.role)) return m;
    if (row.kind === "dm" || row.kind === "group") fail("Las conversaciones directas no se pueden cambiar.", 403, "dm");
    if (m.role === "guest" || !this.membership(row.id, m.id)) fail("No puedes cambiar este canal.", 403, "channel");
    return m;
  }
  /** A channel someone may change: an admin any (even a private one they cannot read), others the ones they read. */
  manageable(person, id) {
    if (this.isAdmin(person)) {
      const row = this.row(id);
      if (!row) fail("No existe ese canal.", 404, "channel");
      return row;
    }
    return this.mustRead(person, id);
  }
  nameTaken(name, except = null) {
    for (const r of this.q("SELECT id, data FROM chat_channels WHERE kind IN ('public','private')").all())
      if (r.id !== except && this.open(r.data, "channel\u0000" + r.id).name === name) return true;
    return false;
  }
  uniqueName(base) {
    let name = channelName(base) || "canal";
    if (!this.nameTaken(name)) return name;
    for (let i = 2; i < 1000; i++) { const n = (name.slice(0, CHAT_LIMITS.channelName - 4) + "-" + i); if (!this.nameTaken(n)) return n; }
    return name + "-" + randomUUID().slice(0, 6);
  }
  seedGeneral() {
    const id = randomUUID(), t = this.now();
    this.tx(() => {
      this.q("INSERT INTO chat_channels(id, kind, created_at, data) VALUES(?,?,?,?)").run(id, "public", t, this.seal({ name: "general", topic: "", description: "El canal de toda la empresa.", createdBy: null, createdAt: t }, "channel\u0000" + id));
      const s = this.settings();
      this.kvSet("settings", { ...s, defaultChannels: [...new Set([...(s.defaultChannels || []), id])] });
    });
  }
  insertChannel({ kind, name = null, topic = "", description = "", createdBy = null, members = [], dmKey = null, extra = {}, at = this.now(), readAll = true }) {
    const id = randomUUID();
    this.q("INSERT INTO chat_channels(id, kind, created_at, dm_key, data) VALUES(?,?,?,?,?)").run(id, kind, at, dmKey, this.seal({ name, topic, description, createdBy, createdAt: at, ...extra }, "channel\u0000" + id));
    const put = this.q("INSERT OR IGNORE INTO chat_members(channel, person, joined_at, read_seq) VALUES(?,?,?,0)");
    for (const p of new Set(members)) put.run(id, p, at);
    void readAll;
    return this.row(id);
  }
  addMember(row, personId, { at = this.now(), quiet = false } = {}) {
    if (this.membership(row.id, personId)) return false;
    this.q("INSERT INTO chat_members(channel, person, joined_at, read_seq) VALUES(?,?,?,?)").run(row.id, personId, at, row.last_seq || 0);
    if (!quiet) {
      this.emit({ type: "chat.channel", channel: row.id, change: "joined", person: personId }, { people: this.memberIds(row.id), channel: row.id });
      this.emit({ type: "chat.joined", channel: this.channelView(this.row(row.id), { id: personId }) }, { people: [personId] });
    }
    return true;
  }
  /** One channel as a person sees it (their read state, unread and mention counts, draft). */
  channelView(row, person, mem = person ? this.membership(row.id, person.id) : null) {
    const meta = this.meta(row);
    const view = {
      id: row.id, kind: row.kind, name: meta.name || null, topic: meta.topic || "", description: meta.description || "", archived: !!row.archived,
      createdBy: meta.createdBy || null, createdAt: row.created_at, lastSeq: row.last_seq, lastAt: row.last_at || null,
      isDefault: (this.settings().defaultChannels || []).includes(row.id), imported: meta.imported ? { source: "slack" } : null,
      member: !!mem, people: row.kind === "dm" || row.kind === "group" ? this.memberIds(row.id) : undefined,
      memberCount: this.q("SELECT count(*) AS n FROM chat_members WHERE channel=?").get(row.id)?.n || 0,
    };
    if (mem) {
      Object.assign(view, {
        readSeq: mem.read_seq, notify: mem.notify, muted: !!mem.muted,
        draft: mem.draft ? this.open(mem.draft, "draft\u0000" + row.id + "\u0000" + mem.person)?.text || "" : "",
        unread: this.q("SELECT count(*) AS n FROM (SELECT 1 FROM chat_messages WHERE channel=? AND top=1 AND seq>? AND deleted=0 AND (author IS NULL OR author<>?) LIMIT 100)").get(row.id, mem.read_seq, mem.person)?.n || 0,
        mentions: this.q("SELECT count(*) AS n FROM chat_mentions WHERE person=? AND channel=? AND seen=0").get(mem.person, row.id)?.n || 0,
      });
    }
    return view;
  }
  /** The channels in a person's sidebar: the ones they are in. */
  myChannels(person) {
    this.must(person);
    return this.q("SELECT c.* FROM chat_members m JOIN chat_channels c ON c.id=m.channel WHERE m.person=?").all(person.id)
      .map((row) => this.channelView(row, person));
  }
  /** «Explorar canales»: every public channel (not for guests), joined or not. */
  browse(person) {
    const m = this.must(person);
    if (m.role === "guest") return [];
    return this.q("SELECT * FROM chat_channels WHERE kind='public' ORDER BY archived, created_at").all().map((row) => this.channelView(row, person));
  }
  channel(person, id) {
    const row = this.mustRead(person, id);
    const view = this.channelView(row, person);
    view.memberIds = this.memberIds(id);
    view.canManage = (() => { try { this.mustManageChannel(person, row); return true; } catch { return false; } })();
    return view;
  }
  createChannel(person, { name, kind = "public", topic = "", description = "", members = [] } = {}) {
    const me = this.must(person);
    if (me.role === "guest") fail("Como invitado no puedes crear canales.", 403, "guest");
    if (!["public", "private"].includes(kind)) fail("Tipo de canal no válido.");
    const clean = channelName(name);
    if (!clean) fail("Ponle un nombre al canal.");
    if (this.nameTaken(clean)) fail("Ya hay un canal con ese nombre.", 409, "name");
    const people = [me.id, ...(Array.isArray(members) ? members : []).filter((id) => this.member(id))];
    const row = this.tx(() => this.insertChannel({ kind, name: clean, topic: cleanLine(topic, CHAT_LIMITS.topic), description: cleanLine(description, CHAT_LIMITS.description), createdBy: me.id, members: people }));
    const view = this.channelView(row, person);
    for (const id of new Set(people)) this.emit({ type: "chat.joined", channel: this.channelView(row, { id }) }, { people: [id] });
    return view;
  }
  updateChannel(person, id, patch = {}) {
    const row = this.manageable(person, id);
    const me = this.mustManageChannel(person, row);
    const meta = this.meta(row);
    const before = { name: meta.name, archived: !!row.archived };
    if (row.kind === "dm" || row.kind === "group") fail("Las conversaciones directas no se pueden cambiar.", 403, "dm");
    if ("name" in patch) {
      const clean = channelName(patch.name);
      if (!clean) fail("Ponle un nombre al canal.");
      if (clean !== meta.name && this.nameTaken(clean, id)) fail("Ya hay un canal con ese nombre.", 409, "name");
      meta.name = clean;
    }
    if ("topic" in patch) meta.topic = cleanLine(patch.topic, CHAT_LIMITS.topic);
    if ("description" in patch) meta.description = cleanLine(patch.description, CHAT_LIMITS.description);
    let archived = row.archived;
    if ("archived" in patch) archived = patch.archived ? 1 : 0;
    this.tx(() => {
      this.q("UPDATE chat_channels SET data=?, archived=? WHERE id=?").run(this.seal(meta, "channel\u0000" + id), archived, id);
      if ("isDefault" in patch) {
        if (!MANAGERS.has(me.role)) fail("Solo quien administra elige los canales por defecto.", 403, "role");
        if (row.kind !== "public" && patch.isDefault) fail("Solo un canal público puede ser por defecto.");
        const s = this.settings();
        const set = new Set(s.defaultChannels || []);
        if (patch.isDefault) set.add(id); else set.delete(id);
        this.kvSet("settings", { ...s, defaultChannels: [...set] });
      }
    });
    if (MANAGERS.has(me.role)) {
      if (before.archived !== !!archived) this.audit(person, archived ? "channel.archive" : "channel.unarchive", { type: "channel", id, name: meta.name });
      if (before.name !== meta.name) this.audit(person, "channel.rename", { type: "channel", id, name: meta.name }, { from: before.name });
      if ("isDefault" in patch) this.audit(person, "channel.default", { type: "channel", id, name: meta.name }, { on: !!patch.isDefault });
    }
    const view = this.channelView(this.row(id), null);
    this.emit({ type: "chat.channel", channel: id, change: "updated", view }, { people: row.kind === "public" ? "all" : this.memberIds(id), channel: id });
    return this.canRead(person, this.row(id)) ? this.channel(person, id) : this.channelView(this.row(id), person);
  }
  join(person, id) {
    const me = this.must(person);
    const row = this.row(id);
    if (!row || row.kind !== "public" || me.role === "guest") fail("No existe ese canal.", 404, "channel");
    if (row.archived) fail("Este canal está archivado.", 409, "archived");
    this.addMember(row, me.id);
    return this.channel(person, id);
  }
  leave(person, id) {
    const row = this.mustRead(person, id);
    if (row.kind === "dm") fail("No puedes salir de una conversación directa.", 400, "dm");
    this.removeMembership(row, person.id);
    return { ok: true };
  }
  removeMembership(row, personId) {
    const before = this.memberIds(row.id);
    this.q("DELETE FROM chat_members WHERE channel=? AND person=?").run(row.id, personId);
    this.q("DELETE FROM chat_mentions WHERE person=? AND channel=?").run(personId, row.id);
    this.emit({ type: "chat.left", channel: row.id }, { people: [personId] });
    this.emit({ type: "chat.channel", channel: row.id, change: "left", person: personId }, { people: before.filter((p) => p !== personId), channel: row.id });
  }
  addMembers(person, id, people = []) {
    const row = this.manageable(person, id);
    const me = this.mustManageChannel(person, row);
    if (row.kind === "dm") fail("Crea un grupo para hablar con más personas.", 400, "dm");
    if (row.kind === "group" && this.memberIds(id).length + people.length > CHAT_LIMITS.groupMax + 1) fail("Un grupo admite hasta " + (CHAT_LIMITS.groupMax + 1) + " personas.");
    const added = [];
    for (const pid of new Set(people)) if (this.member(pid) && this.addMember(row, pid)) added.push(pid);
    if (MANAGERS.has(me.role) && !this.membership(id, me.id) && added.length) this.audit(person, "channel.members", { type: "channel", id, name: this.meta(row).name }, { added });
    return { added, channel: this.canRead(person, this.row(id)) ? this.channel(person, id) : this.channelView(this.row(id), person) };
  }
  removeMember(person, id, personId) {
    const row = this.manageable(person, id);
    const me = this.mustManageChannel(person, row);
    if (row.kind === "dm" || row.kind === "group") fail("Las conversaciones directas no se pueden cambiar.", 403, "dm");
    if (personId === me.id) return this.leave(person, id);
    if (!MANAGERS.has(me.role) && this.meta(row).createdBy !== me.id) fail("Solo quien creó el canal o quien administra puede quitar a alguien.", 403, "channel");
    if (!this.membership(id, personId)) return { ok: true };
    this.removeMembership(row, personId);
    if (MANAGERS.has(me.role)) this.audit(person, "channel.members", { type: "channel", id, name: this.meta(row).name }, { removed: [personId] });
    return { ok: true };
  }
  /** A direct message with one person, or a group with up to 8: the same conversation each time. */
  openDm(person, ids = []) {
    const me = this.must(person);
    const others = [...new Set(ids)].filter((x) => x !== me.id);
    if (!others.length) fail("Elige a alguien.");
    if (others.length > CHAT_LIMITS.groupMax) fail("Un grupo admite hasta " + (CHAT_LIMITS.groupMax + 1) + " personas.");
    for (const id of others) if (!this.member(id)) fail("Esa persona no está en este espacio.", 404, "person");
    const all = [me.id, ...others].sort();
    const key = all.join("|");
    let row = this.q("SELECT * FROM chat_channels WHERE dm_key=?").get(key);
    if (!row) {
      row = this.tx(() => this.insertChannel({ kind: others.length === 1 ? "dm" : "group", dmKey: key, createdBy: me.id, members: all }));
      for (const id of all) this.emit({ type: "chat.joined", channel: this.channelView(row, { id }) }, { people: [id] });
    } else if (!this.membership(row.id, me.id)) {
      this.addMember(row, me.id);
    }
    return this.channelView(row, person);
  }

  // ------------------------------------------------------------------ messages
  mrow(id) { return typeof id === "string" ? this.q("SELECT * FROM chat_messages WHERE id=?").get(id) || null : null; }
  mdata(row) { return this.open(row.data, "message\u0000" + row.id); }
  /** A message for the screens. */
  messageView(row, data = this.mdata(row)) {
    const reactions = Object.entries(data.reactions || {}).filter(([, ids]) => ids.length).map(([emoji, ids]) => ({ emoji, people: ids.slice(0, 50), count: ids.length }));
    return {
      id: row.id, seq: row.seq, channel: row.channel, author: row.author, at: row.at, editedAt: row.edited_at || null,
      deleted: !!row.deleted, text: row.deleted ? "" : data.text || "", files: row.deleted ? [] : data.files || [],
      reactions: row.deleted ? [] : reactions, pinned: !!row.pinned, preview: row.deleted ? null : data.preview || null,
      threadId: row.thread ? data.threadId || null : null, broadcast: !!(row.thread && row.top),
      replies: row.replies, lastReplyAt: row.last_reply_at || null, replyPeople: (data.repliers || []).slice(-4),
      botName: data.botName || null, imported: !!data.imported,
    };
  }
  /** Ghost authors and mentions a page refers to (people of an import who have not joined). */
  ghostsFor(views) {
    const ids = new Set();
    for (const v of views) {
      if (v.author?.startsWith("slack:")) ids.add(v.author);
      for (const m of String(v.text).matchAll(MENTION)) if (m[1].startsWith("slack:")) ids.add(m[1]);
      for (const r of v.reactions) for (const p of r.people) if (p.startsWith("slack:")) ids.add(p);
      for (const p of v.replyPeople || []) if (p.startsWith("slack:")) ids.add(p);
    }
    const out = {};
    for (const id of ids) { const g = this.ghost(id); if (g) out[id] = g; }
    return out;
  }
  ghost(id) {
    const r = this.q("SELECT * FROM chat_ghosts WHERE id=?").get(id);
    if (!r) return null;
    const d = this.open(r.data, "ghost\u0000" + id);
    return { id, name: d.name || "Alguien", title: d.title || "", color: d.color || null, person: r.person || null, bot: !!d.bot };
  }
  page(rows) {
    const messages = rows.map((r) => this.messageView(r));
    return { messages, ghosts: this.ghostsFor(messages) };
  }
  /**
   * A page of a channel's timeline (top-level messages and thread replies also sent to it), oldest
   * first: before a seq, after a seq, or around one (the first unread, a search hit).
   */
  history(person, id, { before = null, after = null, around = null, limit = CHAT_LIMITS.page } = {}) {
    const row = this.mustRead(person, id);
    const n = Math.max(1, Math.min(CHAT_LIMITS.maxPage, Math.floor(Number(limit)) || CHAT_LIMITS.page));
    const base = "SELECT * FROM chat_messages WHERE channel=? AND top=1 AND (deleted=0 OR replies>0)";
    const older = (seq, k) => this.q(base + " AND seq<? ORDER BY seq DESC LIMIT ?").all(id, seq, k).reverse();
    const newer = (seq, k) => this.q(base + " AND seq>? ORDER BY seq ASC LIMIT ?").all(id, seq, k);
    let rows, hasBefore, hasAfter;
    if (around != null) {
      const at = Number(around);
      const half = Math.floor(n / 2);
      const a = older(at + 1, half + 1), b = newer(at, n - half + 1);
      hasBefore = a.length > half; hasAfter = b.length > n - half;
      rows = [...a.slice(hasBefore ? 1 : 0), ...b.slice(0, n - half)];
    } else if (after != null) {
      const b = newer(Number(after), n + 1);
      hasAfter = b.length > n; rows = b.slice(0, n); hasBefore = true;
    } else {
      const a = older(before != null ? Number(before) : Number.MAX_SAFE_INTEGER, n + 1);
      hasBefore = a.length > n; rows = a.slice(hasBefore ? 1 : 0); hasAfter = before != null;
    }
    const mem = this.membership(id, person.id);
    return { ...this.page(rows), hasBefore, hasAfter, readSeq: mem?.read_seq ?? null, lastSeq: row.last_seq };
  }
  /** Where a message sits in a channel's timeline (a reply: its thread's first message), to open a page around it. */
  seqOf(person, channelId, messageId) {
    this.mustRead(person, channelId);
    const row = this.mrow(messageId);
    if (!row || row.channel !== channelId) fail("No existe ese mensaje.", 404, "message");
    return row.thread && !row.top ? row.thread : row.seq;
  }
  /** A thread: its first message and every reply, in order. Opening it clears its mentions of you. */
  thread(person, messageId) {
    const root = this.mrow(messageId);
    if (!root) fail("No existe ese mensaje.", 404, "message");
    this.mustRead(person, root.channel);
    if (root.thread) return this.thread(person, this.mdata(root).threadId);
    const replies = this.q("SELECT * FROM chat_messages WHERE thread=? AND deleted=0 ORDER BY seq").all(root.seq);
    this.q("UPDATE chat_mentions SET seen=1 WHERE person=? AND seq IN (SELECT seq FROM chat_messages WHERE thread=?)").run(person.id, root.seq);
    const page = this.page([root, ...replies]);
    return { root: page.messages[0], replies: page.messages.slice(1), ghosts: page.ghosts };
  }
  pins(person, id) {
    this.mustRead(person, id);
    return this.page(this.q("SELECT * FROM chat_messages WHERE channel=? AND pinned=1 AND deleted=0 ORDER BY seq DESC LIMIT 100").all(id));
  }
  /** Mentions a stored text may carry: only real people of the workspace (and ghosts); anything else becomes plain text. */
  cleanText(text) {
    let s = String(text ?? "").replace(/\r\n?/g, "\n");
    if (s.length > CHAT_LIMITS.text) fail("El mensaje es demasiado largo.", 413, "long");
    s = s.replace(MENTION, (m, id) => (this.member(id) || (id.startsWith("slack:") && this.ghost(id)) ? m : "@" + id));
    s = s.replace(/<#([^>|]+)(?:\|[^>]*)?>/g, (m, id) => (this.row(id) ? "<#" + id + ">" : "#" + id));
    s = s.replace(/<!(?!channel>|here>|everyone>)[^>]*>/g, "");
    return s;
  }
  /**
   * A message from a person: in the channel, or as a reply in a thread (`thread`: the first
   * message's id) that may also go to the channel (`alsoChannel`). Files must be ones they
   * uploaded to this channel and not yet sent.
   */
  post(person, id, { text = "", thread = null, alsoChannel = false, files = [], clientId = null } = {}) {
    const me = this.must(person);
    const row = this.mustPost(person, id);
    const clean = this.cleanText(text).trim();
    const fileIds = [...new Set(Array.isArray(files) ? files : [])].slice(0, CHAT_LIMITS.filesPerMessage);
    if (!clean && !fileIds.length) fail("Escribe algo.");
    let root = null;
    if (thread) {
      root = this.mrow(thread);
      if (!root || root.channel !== id || root.thread || (root.deleted && !root.replies)) fail("Ese hilo ya no existe.", 404, "thread");
    }
    const attached = fileIds.map((fid) => {
      const f = this.q("SELECT * FROM chat_files WHERE id=?").get(fid);
      if (!f || f.channel !== id || f.uploader !== me.id || f.seq != null) fail("Ese archivo no está listo para enviarse.", 400, "file");
      return { id: f.id, size: f.size, ...this.open(f.data, "file\u0000" + f.id) };
    });
    const at = this.now();
    const msgId = randomUUID();
    const top = !root || alsoChannel ? 1 : 0;
    const data = { text: clean, files: attached, reactions: {}, threadId: root ? root.id : null, repliers: [], clientId: clientId ? String(clientId).slice(0, 64) : null };
    const view = this.tx(() => {
      const seq = this.q("INSERT INTO chat_messages(id, channel, thread, top, author, at, has_file, has_link, data) VALUES(?,?,?,?,?,?,?,?,?) RETURNING seq")
        .get(msgId, id, root ? root.seq : null, top, me.id, at, attached.length ? 1 : 0, /(?:<|\b)https?:\/\//i.test(clean) ? 1 : 0, this.seal(data, "message\u0000" + msgId)).seq;
      if (top) this.q("UPDATE chat_channels SET last_seq=?, last_at=? WHERE id=?").run(seq, at, id);
      for (const f of attached) this.q("UPDATE chat_files SET seq=? WHERE id=?").run(seq, f.id);
      this.index(seq, clean + " " + attached.map((f) => f.name).join(" "));
      // Your own message counts as read.
      this.q("UPDATE chat_members SET read_seq=max(read_seq, ?), draft=NULL WHERE channel=? AND person=?").run(top ? seq : 0, id, me.id);
      if (root) {
        const rd = this.mdata(root);
        rd.repliers = [...(rd.repliers || []).filter((p) => p !== me.id), me.id].slice(-20);
        this.q("UPDATE chat_messages SET replies=replies+1, last_reply_at=?, data=? WHERE seq=?").run(at, this.seal(rd, "message\u0000" + root.id), root.seq);
      }
      return this.messageView(this.mrow(msgId));
    });
    const members = this.memberIds(id);
    this.emit({ type: "chat.message", channel: id, message: view, clientId: data.clientId }, { people: members, channel: id });
    if (root) this.emit({ type: "chat.update", channel: id, message: this.messageView(this.mrow(root.id)) }, { people: members, channel: id });
    const notInChannel = this.notify(me, row, view, root);
    this.preview(view);
    return { message: view, notInChannel };
  }
  edit(person, messageId, text) {
    const me = this.must(person);
    const row = this.mrow(messageId);
    if (!row || row.deleted) fail("No existe ese mensaje.", 404, "message");
    this.mustRead(person, row.channel);
    if (row.author !== me.id) fail("Solo puedes editar tus mensajes.", 403, "author");
    if (this.row(row.channel).archived) fail("Este canal está archivado.", 409, "archived");
    const clean = this.cleanText(text).trim();
    const data = this.mdata(row);
    if (!clean && !(data.files || []).length) fail("Escribe algo, o borra el mensaje.");
    const old = data.text;
    data.text = clean;
    data.preview = null;
    this.tx(() => {
      this.unindex(row.seq, old + " " + (data.files || []).map((f) => f.name).join(" "));
      this.index(row.seq, clean + " " + (data.files || []).map((f) => f.name).join(" "));
      this.q("UPDATE chat_messages SET data=?, edited_at=?, has_link=? WHERE seq=?").run(this.seal(data, "message\u0000" + row.id), this.now(), /(?:<|\b)https?:\/\//i.test(clean) ? 1 : 0, row.seq);
    });
    const view = this.messageView(this.mrow(messageId));
    this.emit({ type: "chat.update", channel: row.channel, message: view }, { people: this.memberIds(row.channel), channel: row.channel });
    // New people named in an edit hear of it like in a new message.
    const before = new Set(mentionsIn(old).people);
    if (mentionsIn(clean).people.some((p) => !before.has(p))) this.notify(me, this.row(row.channel), view, row.thread ? this.q("SELECT * FROM chat_messages WHERE seq=?").get(row.thread) : null, { only: (p) => !before.has(p) });
    this.preview(view);
    return view;
  }
  /** Deleting: the author, or an admin. A first message with replies stays as «Mensaje eliminado». */
  remove(person, messageId) {
    const me = this.must(person);
    const row = this.mrow(messageId);
    if (!row || row.deleted) fail("No existe ese mensaje.", 404, "message");
    this.mustRead(person, row.channel);
    const admin = MANAGERS.has(me.role);
    if (row.author !== me.id && !admin) fail("Solo puedes borrar tus mensajes.", 403, "author");
    const data = this.mdata(row);
    const keys = this.tx(() => this.purge(row, data));
    for (const k of keys) this.defer(this.blobs?.remove(k));
    if (row.author !== me.id) this.audit(person, "message.delete", { type: "message", id: row.id, channel: row.channel }, { author: row.author });
    return { ok: true };
  }
  /** Removes a message's content, index entries, mentions and files (in a transaction); returns blob keys to delete. */
  purge(row, data = this.mdata(row), { quiet = false } = {}) {
    this.unindex(row.seq, (data.text || "") + " " + (data.files || []).map((f) => f.name).join(" "));
    this.q("DELETE FROM chat_mentions WHERE seq=?").run(row.seq);
    const keys = this.q("SELECT key FROM chat_files WHERE seq=?").all(row.seq).map((f) => f.key);
    this.q("DELETE FROM chat_files WHERE seq=?").run(row.seq);
    const blank = { text: "", files: [], reactions: {}, threadId: data.threadId || null, repliers: data.repliers || [] };
    this.q("UPDATE chat_messages SET deleted=1, pinned=0, has_file=0, has_link=0, data=? WHERE seq=?").run(this.seal(blank, "message\u0000" + row.id), row.seq);
    if (row.thread) {
      const root = this.q("SELECT * FROM chat_messages WHERE seq=?").get(row.thread);
      if (root) this.q("UPDATE chat_messages SET replies=max(0, replies-1) WHERE seq=?").run(root.seq);
    }
    if (!quiet) {
      const members = this.memberIds(row.channel);
      this.emit({ type: "chat.delete", channel: row.channel, id: row.id, seq: row.seq, threadId: data.threadId || null }, { people: members, channel: row.channel });
      if (row.thread) { const root = this.q("SELECT * FROM chat_messages WHERE seq=?").get(row.thread); if (root) this.emit({ type: "chat.update", channel: row.channel, message: this.messageView(root) }, { people: members, channel: row.channel }); }
    }
    return keys;
  }
  react(person, messageId, emoji, on = true) {
    const me = this.must(person);
    const row = this.mrow(messageId);
    if (!row || row.deleted) fail("No existe ese mensaje.", 404, "message");
    const ch = this.mustRead(person, row.channel);
    if (ch.archived) fail("Este canal está archivado.", 409, "archived");
    const e = String(emoji || "");
    if (!EMOJI_OK.test(e)) fail("Reacción no válida.");
    const data = this.mdata(row);
    const r = data.reactions || (data.reactions = {});
    if (on && !r[e] && Object.keys(r).length >= CHAT_LIMITS.reactionsPerMessage) fail("Demasiadas reacciones distintas.");
    const list = new Set(r[e] || []);
    if (on) list.add(me.id); else list.delete(me.id);
    if (list.size) r[e] = [...list]; else delete r[e];
    this.q("UPDATE chat_messages SET data=? WHERE seq=?").run(this.seal(data, "message\u0000" + row.id), row.seq);
    const view = this.messageView(this.mrow(messageId), data);
    this.emit({ type: "chat.update", channel: row.channel, message: view }, { people: this.memberIds(row.channel), channel: row.channel });
    return view;
  }
  pin(person, messageId, on = true) {
    this.must(person);
    const row = this.mrow(messageId);
    if (!row || row.deleted) fail("No existe ese mensaje.", 404, "message");
    const ch = this.mustRead(person, row.channel);
    if (ch.archived) fail("Este canal está archivado.", 409, "archived");
    if (!this.membership(row.channel, person.id)) fail("Únete al canal para fijar mensajes.", 403, "member");
    this.q("UPDATE chat_messages SET pinned=? WHERE seq=?").run(on ? 1 : 0, row.seq);
    const view = this.messageView(this.mrow(messageId));
    this.emit({ type: "chat.update", channel: row.channel, message: view }, { people: this.memberIds(row.channel), channel: row.channel });
    return view;
  }
  /** Fetches the first link's preview after the message is out (server/cloud/link-preview.mjs). */
  preview(view) {
    if (!this.previews || view.deleted) return;
    const url = linkOf(view.text);
    if (!url) return;
    this.defer((async () => {
      const preview = await this.previews(url);
      if (!preview) return;
      const row = this.mrow(view.id);
      if (!row || row.deleted) return;
      const data = this.mdata(row);
      if (linkOf(data.text) !== url) return;
      data.preview = preview;
      this.q("UPDATE chat_messages SET data=? WHERE seq=?").run(this.seal(data, "message\u0000" + row.id), row.seq);
      this.emit({ type: "chat.update", channel: row.channel, message: this.messageView(this.mrow(view.id), data) }, { people: this.memberIds(row.channel), channel: row.channel });
    })());
  }

  // ------------------------------------------------------------------ read state, drafts, preferences
  /** «Marcar como leído» (seq omitted: everything), or unread from a message on (seq = the one before it). */
  markRead(person, id, seq = null) {
    this.mustRead(person, id);
    const mem = this.membership(id, person.id);
    if (!mem) return { readSeq: null };
    const row = this.row(id);
    const target = seq == null ? row.last_seq : Math.max(0, Math.min(row.last_seq, Math.floor(Number(seq)) || 0));
    this.tx(() => {
      this.q("UPDATE chat_members SET read_seq=? WHERE channel=? AND person=?").run(target, id, person.id);
      this.q("UPDATE chat_mentions SET seen=CASE WHEN seq<=? THEN 1 ELSE 0 END WHERE person=? AND channel=?").run(target, person.id, id);
    });
    const view = this.channelView(this.row(id), person);
    this.emit({ type: "chat.read", channel: id, readSeq: target, unread: view.unread, mentions: view.mentions }, { people: [person.id] });
    return { readSeq: target, unread: view.unread, mentions: view.mentions };
  }
  setDraft(person, id, text) {
    this.mustRead(person, id);
    if (!this.membership(id, person.id)) return { ok: true };
    const t = String(text || "").slice(0, CHAT_LIMITS.text);
    this.q("UPDATE chat_members SET draft=? WHERE channel=? AND person=?").run(t ? this.seal({ text: t }, "draft\u0000" + id + "\u0000" + person.id) : null, id, person.id);
    return { ok: true };
  }
  setPrefs(person, id, { notify, muted } = {}) {
    this.mustRead(person, id);
    if (!this.membership(id, person.id)) fail("Únete al canal para elegir sus avisos.", 403, "member");
    if (notify !== undefined && !NOTIFY.has(notify)) fail("Opción de avisos no válida.");
    if (notify !== undefined) this.q("UPDATE chat_members SET notify=? WHERE channel=? AND person=?").run(notify, id, person.id);
    if (muted !== undefined) this.q("UPDATE chat_members SET muted=? WHERE channel=? AND person=?").run(muted ? 1 : 0, id, person.id);
    return this.channelView(this.row(id), person);
  }

  // ------------------------------------------------------------------ notifications
  /**
   * Who hears of a new message, and how: a mention row (the «Menciones» list, badges, the mail
   * digest) for direct messages, people named, @canal / @aquí, keywords and thread participants;
   * a push to their devices when their preferences allow it, they are not in «no molestar» and
   * they are not active right now. Returns the people named who are not in the channel.
   */
  notify(author, row, view, root, { only = null } = {}) {
    const members = this.q("SELECT person, notify, muted FROM chat_members WHERE channel=?").all(row.id);
    const inChannel = new Map(members.map((m) => [m.person, m]));
    const named = mentionsIn(view.text);
    const notInChannel = named.people.filter((p) => this.member(p) && !inChannel.has(p) && p !== author.id);
    if (view.imported) return notInChannel;
    const online = this.presence();
    const direct = row.kind === "dm" || row.kind === "group";
    const participants = new Set(root ? [root.author, ...(this.mdata(root).repliers || [])] : []);
    const words = new Set(wordsOf(view.text));
    const at = this.now();
    const meta = this.meta(row);
    const nameOf = (id) => this.member(id)?.name || this.ghost(id)?.name || null;
    const pushes = [];
    const mention = this.q("INSERT OR IGNORE INTO chat_mentions(person, seq, channel, at, kind) VALUES(?,?,?,?,?)");
    this.tx(() => {
      for (const m of members) {
        const pid = m.person;
        if (pid === author.id || !this.member(pid) || (only && !only(pid))) continue;
        const profile = this.profile(pid);
        let kind = null;
        if (direct) kind = "dm";
        else if (named.people.includes(pid)) kind = "mention";
        else if (named.channel) kind = "channel";
        else if (named.here && online.get(pid) === "active") kind = "here";
        else if (root && participants.has(pid)) kind = "thread";
        else if ((profile.keywords || []).some((k) => [...words].some((w) => w === k || w.startsWith(k)))) kind = "keyword";
        const level = m.notify === "default" ? (direct ? "all" : "mentions") : m.notify;
        const strong = kind === "dm" || kind === "mention";
        // What counts as «para ti» (badge, «Menciones», the mail digest).
        if (kind && (strong || level !== "nothing")) mention.run(pid, view.seq, row.id, at, kind);
        let wants = false;
        if (level === "nothing") wants = false;
        else if (m.muted) wants = kind === "mention";
        else if (level === "all") wants = true;
        else wants = !!kind;
        if (!wants || doNotDisturb(profile, at) || online.get(pid) === "active") continue;
        pushes.push(pid);
      }
    });
    if (this.push && pushes.length) {
      const where = direct ? (row.kind === "dm" ? nameOf(author.id) || "Mensaje directo" : "Grupo") : "#" + (meta.name || "canal");
      const body = plainText(view.text, nameOf, (cid) => (this.row(cid) ? this.meta(this.row(cid)).name : null)).replace(/\s+/g, " ").trim().slice(0, 140) || (view.files.length ? "Ha enviado un archivo" : "");
      const payload = { title: direct && row.kind === "dm" ? where : (author.name || "Alguien") + " en " + where, body: direct && row.kind === "dm" ? body : body, url: "/canal/" + row.id + (view.threadId ? "?hilo=" + view.threadId : "?m=" + view.id), tag: "chat-" + row.id };
      for (const pid of pushes) this.defer(this.push(pid, payload));
    }
    return notInChannel;
  }
  /** «Menciones y reacciones»: what was for you lately (newest first). */
  mentions(person, { before = null, limit = 30 } = {}) {
    this.must(person);
    const rows = this.q("SELECT n.kind, n.seen, m.* FROM chat_mentions n JOIN chat_messages m ON m.seq=n.seq WHERE n.person=? AND m.deleted=0" + (before ? " AND n.seq<?" : "") + " ORDER BY n.seq DESC LIMIT ?")
      .all(...(before ? [person.id, Number(before), Math.min(100, limit)] : [person.id, Math.min(100, limit)]));
    const items = rows.filter((r) => this.canRead(person, this.row(r.channel))).map((r) => ({ kind: r.kind, seen: !!r.seen, message: this.messageView(r) }));
    return { items, ghosts: this.ghostsFor(items.map((i) => i.message)) };
  }
  /**
   * The mail digest (Workspace#alarm): for each person with mentions older than `digestMinutes`
   * still unseen and not yet mailed, the list; marks them mailed. Respects «no molestar» (waits)
   * and the person's choice to receive it.
   */
  digestDue(ms = this.now()) {
    const minutes = Math.max(5, this.settings().digestMinutes || 30);
    const cutoff = ms - minutes * 60000;
    const rows = this.q("SELECT n.person, n.seq, n.channel, n.kind FROM chat_mentions n WHERE n.mailed=0 AND n.seen=0 AND n.at<=? ORDER BY n.person, n.seq LIMIT 2000").all(cutoff);
    const byPerson = new Map();
    for (const r of rows) { if (!byPerson.has(r.person)) byPerson.set(r.person, []); byPerson.get(r.person).push(r); }
    const out = [];
    const mark = this.q("UPDATE chat_mentions SET mailed=1 WHERE person=? AND seq=?");
    for (const [pid, list] of byPerson) {
      const m = this.member(pid);
      const profile = this.profile(pid);
      if (!m) { for (const r of list) mark.run(pid, r.seq); continue; }
      if (doNotDisturb(profile, ms)) continue;
      const items = [];
      for (const r of list) {
        const msg = this.q("SELECT * FROM chat_messages WHERE seq=?").get(r.seq);
        const ch = this.row(r.channel);
        mark.run(pid, r.seq);
        if (!msg || msg.deleted || !ch || !this.canRead({ id: pid }, ch)) continue;
        const nameOf = (id) => this.member(id)?.name || this.ghost(id)?.name || null;
        const meta = this.meta(ch);
        items.push({ channel: ch.kind === "dm" ? "Mensaje directo" : ch.kind === "group" ? "Grupo" : "#" + meta.name, author: nameOf(msg.author) || "Alguien", text: plainText(this.mdata(msg).text, nameOf).slice(0, 300), url: "/canal/" + ch.id + "?m=" + msg.id, at: msg.at });
      }
      if (items.length && profile.digest !== false && m.email) out.push({ person: pid, email: m.email, name: m.name, items });
    }
    return out;
  }
  /** When the next digest could be due (ms), or null. */
  nextDigestAt() {
    const r = this.q("SELECT min(at) AS at FROM chat_mentions WHERE mailed=0 AND seen=0").get();
    return r?.at ? r.at + Math.max(5, this.settings().digestMinutes || 30) * 60000 : null;
  }
  // Web Push subscriptions (server/cloud/webpush.mjs sends; this keeps them per person).
  addPush(person, subscription, { agent = null } = {}) {
    this.must(person);
    const id = createHmac("sha256", this.termKey).update("push\u0000" + subscription.endpoint).digest("hex").slice(0, 32);
    this.q("INSERT INTO chat_push(id, person, created_at, data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET person=excluded.person, data=excluded.data")
      .run(id, person.id, this.now(), this.seal({ ...subscription, agent: agent ? String(agent).slice(0, 120) : null }, "push\u0000" + id));
    // At most 10 devices per person: the oldest go.
    const extra = this.q("SELECT id FROM chat_push WHERE person=? ORDER BY created_at DESC LIMIT -1 OFFSET 10").all(person.id);
    for (const e of extra) this.q("DELETE FROM chat_push WHERE id=?").run(e.id);
    return { id };
  }
  removePush(person, endpoint) {
    const id = createHmac("sha256", this.termKey).update("push\u0000" + String(endpoint || "")).digest("hex").slice(0, 32);
    this.q("DELETE FROM chat_push WHERE id=? AND person=?").run(id, person.id);
    return { ok: true };
  }
  pushTargets(personId) { return this.q("SELECT id, data FROM chat_push WHERE person=?").all(personId).map((r) => ({ id: r.id, ...this.open(r.data, "push\u0000" + r.id) })); }
  dropPush(id) { this.q("DELETE FROM chat_push WHERE id=?").run(id); }

  // ------------------------------------------------------------------ files
  /** A file just uploaded (bytes already in `blobs` at `key`), waiting to be sent in a message. */
  registerFile(person, channelId, { key, name, type, size, width = null, height = null, id = randomUUID() }) {
    this.must(person);
    this.mustPost(person, channelId);
    const clean = cleanLine(name, 200).replace(/[\\/]/g, "_") || "archivo";
    const meta = { name: clean, type: String(type || "application/octet-stream").slice(0, 100), w: Number.isFinite(width) ? width : null, h: Number.isFinite(height) ? height : null };
    this.q("INSERT INTO chat_files(id, channel, seq, uploader, at, size, key, data) VALUES(?,?,NULL,?,?,?,?,?)").run(id, channelId, person.id, this.now(), size, key, this.seal(meta, "file\u0000" + id));
    return { id, size, ...meta };
  }
  fileKey(channelId, id, name) { return "chat/" + channelId + "/" + id + "/" + encodeURIComponent(String(name || "archivo").slice(0, 120)); }
  /** A file someone may download: its blob key, name and type (the channel must be readable to them). */
  fileFor(person, id) {
    const f = typeof id === "string" ? this.q("SELECT * FROM chat_files WHERE id=?").get(id) : null;
    if (!f) fail("No existe ese archivo.", 404, "file");
    const row = this.row(f.channel);
    if (!row || !this.canRead(person, row)) fail("No existe ese archivo.", 404, "file");
    if (f.seq == null && f.uploader !== person.id) fail("No existe ese archivo.", 404, "file");
    return { id: f.id, key: f.key, size: f.size, ...this.open(f.data, "file\u0000" + f.id) };
  }
  /** Uploaded files never sent after a day go (their blob keys returned). */
  sweepFiles(ms = this.now()) {
    const rows = this.q("SELECT id, key FROM chat_files WHERE seq IS NULL AND at<? LIMIT 200").all(ms - 86400000);
    for (const r of rows) this.q("DELETE FROM chat_files WHERE id=?").run(r.id);
    return rows.map((r) => r.key);
  }

  // ------------------------------------------------------------------ search
  /**
   * Full-text search for one person, over what they may read only: their channels and DMs, and
   * the public channels (not for guests). Filters: from:@persona, in:#canal (or in:@persona for a
   * DM), has:file, has:link, has:pin, before:/after:/on: YYYY-MM-DD, during: YYYY-MM or YYYY.
   */
  search(person, query, { before = null, limit = CHAT_LIMITS.searchPage } = {}) {
    const me = this.must(person);
    const parsed = parseQuery(String(query || "").slice(0, 300));
    const readable = new Map();
    for (const r of this.q("SELECT c.id, c.kind, c.data FROM chat_members m JOIN chat_channels c ON c.id=m.channel WHERE m.person=?").all(me.id)) readable.set(r.id, r);
    if (me.role !== "guest") for (const r of this.q("SELECT id, kind, data FROM chat_channels WHERE kind='public'").all()) readable.set(r.id, r);
    let channels = [...readable.keys()];
    const filters = [];
    const args = [];
    const unknown = [];
    if (parsed.in.length) {
      const wanted = new Set();
      for (const target of parsed.in) {
        if (target.startsWith("@")) {
          const p = this.findPerson(target.slice(1));
          const dm = p && this.q("SELECT id FROM chat_channels WHERE dm_key=?").get([me.id, p.id].sort().join("|"));
          if (dm && readable.has(dm.id)) wanted.add(dm.id); else unknown.push("in:" + target);
        } else {
          const name = channelName(target);
          const hit = [...readable.values()].find((r) => (r.kind === "public" || r.kind === "private") && (r.id === target || this.open(r.data, "channel\u0000" + r.id).name === name));
          if (hit) wanted.add(hit.id); else unknown.push("in:" + target);
        }
      }
      channels = channels.filter((c) => wanted.has(c));
    }
    if (parsed.from.length) {
      const authors = [];
      for (const target of parsed.from) {
        const p = this.findPerson(target.replace(/^@/, ""));
        if (p) { authors.push(p.id); for (const g of this.q("SELECT id FROM chat_ghosts WHERE person=?").all(p.id)) authors.push(g.id); }
        else {
          const g = this.findGhost(target.replace(/^@/, ""));
          if (g) authors.push(g.id); else unknown.push("from:" + target);
        }
      }
      filters.push("author IN (SELECT value FROM json_each(?))");
      args.push(JSON.stringify(authors));
    }
    if (parsed.has.has("file")) filters.push("has_file=1");
    if (parsed.has.has("link")) filters.push("has_link=1");
    if (parsed.has.has("pin")) filters.push("pinned=1");
    if (parsed.after != null) { filters.push("at>=?"); args.push(parsed.after); }
    if (parsed.before != null) { filters.push("at<?"); args.push(parsed.before); }
    if (before != null) { filters.push("seq<?"); args.push(Number(before)); }
    const terms = [...new Set(parsed.words.filter((w) => !STOP.has(w)).map(queryTerm))];
    for (const t of terms) { filters.push("seq IN (SELECT seq FROM chat_terms WHERE term=?)"); args.push(this.hashTerm(t)); }
    if (!channels.length || (!terms.length && !parsed.words.length && !filters.length)) return { results: [], next: null, unknown, query: parsed };
    const candidates = this.q(`SELECT * FROM chat_messages WHERE deleted=0 AND channel IN (SELECT value FROM json_each(?))${filters.map((f) => " AND " + f).join("")} ORDER BY seq DESC LIMIT 200`)
      .all(JSON.stringify(channels), ...args);
    const wanted = parsed.words.filter((w) => !STOP.has(w) || parsed.words.length === 1);
    const results = [];
    let last = null;
    for (const row of candidates) {
      last = row.seq;
      const data = this.mdata(row);
      const have = words((data.text || "") + " " + (data.files || []).map((f) => f.name).join(" "));
      if (!wanted.every((w) => have.some((h) => h.startsWith(w)))) continue;
      const view = this.messageView(row, data);
      const ch = readable.get(row.channel);
      results.push({ message: view, channel: { id: row.channel, kind: ch.kind, name: this.open(ch.data, "channel\u0000" + ch.id).name || null } });
      if (results.length >= limit) break;
    }
    const more = candidates.length === 200 || results.length >= limit;
    return { results, ghosts: this.ghostsFor(results.map((r) => r.message)), next: more ? (results.length >= limit ? results.at(-1).message.seq : last) : null, unknown, query: parsed };
  }
  findPerson(text) {
    const t = String(text || "").toLowerCase().replace(/^<@|>$/g, "");
    const list = this.people.list();
    return list.find((m) => m.id === t) || list.find((m) => (m.email || "").toLowerCase() === t) ||
      list.find((m) => (m.name || "").toLowerCase().replace(/\s+/g, "") === t.replace(/\s+/g, "")) ||
      list.find((m) => (m.name || "").toLowerCase().startsWith(t) || (m.email || "").toLowerCase().startsWith(t)) || null;
  }
  findGhost(text) {
    const t = String(text || "").toLowerCase();
    for (const r of this.q("SELECT id, data FROM chat_ghosts").all()) {
      const d = this.open(r.data, "ghost\u0000" + r.id);
      if (r.id === t || (d.name || "").toLowerCase().startsWith(t) || (d.handle || "").toLowerCase() === t) return { id: r.id, ...d };
    }
    return null;
  }

  // ------------------------------------------------------------------ workspace admin
  audit(actor, action, target = null, details = null) {
    this.q("INSERT INTO chat_audit(at, actor, action, data) VALUES(?,?,?,?)").run(this.now(), actor?.id || null, String(action).slice(0, 60), this.seal({ actor: actor ? { id: actor.id || null, name: actor.name || null, email: actor.email || null } : null, target, details }, "audit"));
  }
  auditLog(person, { before = null, limit = 50 } = {}) {
    this.mustAdmin(person);
    const rows = this.q("SELECT * FROM chat_audit" + (before ? " WHERE seq<?" : "") + " ORDER BY seq DESC LIMIT ?").all(...(before ? [Number(before), Math.min(200, limit)] : [Math.min(200, limit)]));
    return { entries: rows.map((r) => ({ seq: r.seq, at: r.at, action: r.action, ...this.open(r.data, "audit") })), next: rows.length === Math.min(200, limit) ? rows.at(-1).seq : null };
  }
  adminOverview(person) {
    this.mustAdmin(person);
    const channels = this.q("SELECT * FROM chat_channels WHERE kind IN ('public','private') ORDER BY archived, created_at").all().map((row) => {
      const v = this.channelView(row, null);
      return { id: v.id, kind: v.kind, name: v.name, topic: v.topic, archived: v.archived, isDefault: v.isDefault, memberCount: v.memberCount, lastAt: v.lastAt, imported: v.imported };
    });
    const counts = this.q("SELECT count(*) AS messages, sum(has_file) AS files FROM chat_messages WHERE deleted=0").get();
    return { settings: this.settings(), channels, counts: { messages: counts?.messages || 0, files: counts?.files || 0 } };
  }
  setSettings(person, patch = {}) {
    this.mustAdmin(person);
    const s = this.settings();
    const next = { ...s };
    if ("retentionDays" in patch) {
      const d = Math.floor(Number(patch.retentionDays) || 0);
      if (d !== 0 && (d < 1 || d > 3650)) fail("La retención va de 1 a 3650 días (0: para siempre).");
      next.retentionDays = d;
    }
    if ("digestMinutes" in patch) {
      const m = Math.floor(Number(patch.digestMinutes) || 0);
      if (m < 5 || m > 1440) fail("El resumen por correo va de 5 a 1440 minutos.");
      next.digestMinutes = m;
    }
    if ("defaultChannels" in patch) next.defaultChannels = (Array.isArray(patch.defaultChannels) ? patch.defaultChannels : []).filter((id) => this.row(id)?.kind === "public");
    this.kvSet("settings", next);
    this.audit(person, "settings", { type: "workspace" }, { before: s, after: next });
    return next;
  }
  /**
   * Retention (Workspace#alarm): messages older than `retentionDays` go, at most `max` per call,
   * oldest first, with their index entries, mentions and files. Returns {removed, keys, more}.
   */
  retention(ms = this.now(), max = 500) {
    const days = this.settings().retentionDays || 0;
    if (!days) return { removed: 0, keys: [], more: false };
    const cutoff = ms - days * 86400000;
    const rows = this.q("SELECT * FROM chat_messages WHERE at<? AND (deleted=0 OR data IS NOT NULL) ORDER BY at LIMIT ?").all(cutoff, max);
    const keys = [];
    this.tx(() => {
      for (const row of rows) {
        if (!row.deleted) keys.push(...this.purge(row, this.mdata(row), { quiet: true }));
        this.q("DELETE FROM chat_messages WHERE seq=?").run(row.seq);
      }
    });
    if (rows.length) this.audit(null, "retention.purge", { type: "workspace" }, { removed: rows.length, before: new Date(cutoff).toISOString() });
    return { removed: rows.length, keys, more: rows.length === max };
  }

  // ------------------------------------------------------------------ people coming and going
  /**
   * After the directory's list changes (host.syncMembers): newcomers join the default channels
   * (not guests) and pick up the channels of the import person with their email; people who left
   * lose their channel memberships (their messages and names stay).
   */
  syncPeople(list) {
    const known = new Set(this.kvGet("known-people")?.ids || []);
    const active = list.filter((m) => !m.deactivated);
    const defaults = (this.settings().defaultChannels || []).map((id) => this.row(id)).filter((r) => r && r.kind === "public" && !r.archived);
    const t = this.now();
    this.tx(() => {
      for (const m of active) {
        if (known.has(m.id)) continue;
        if (m.role !== "guest") for (const row of defaults) this.addMember(row, m.id, { at: t, quiet: true });
        if (m.email) {
          for (const g of this.q("SELECT id, data FROM chat_ghosts WHERE email=? AND person IS NULL").all(String(m.email).toLowerCase())) {
            this.q("UPDATE chat_ghosts SET person=? WHERE id=?").run(m.id, g.id);
            const d = this.open(g.data, "ghost\u0000" + g.id);
            for (const cid of d.channels || []) {
              const row = this.row(cid);
              if (row && (m.role !== "guest" || row.kind !== "public" || true)) this.addMember(row, m.id, { at: t, quiet: true });
            }
          }
        }
      }
      const present = new Set(active.map((m) => m.id));
      for (const r of this.q("SELECT DISTINCT person FROM chat_members").all()) if (!present.has(r.person) && !list.some((m) => m.id === r.person && m.deactivated)) this.q("DELETE FROM chat_members WHERE person=?").run(r.person);
      this.kvSet("known-people", { ids: [...new Set([...known, ...active.map((m) => m.id)])] });
    });
  }
  /** Ghosts: people of an import, shown by their original name until (and after) they join. */
  upsertGhost(id, { email = null, name, title = "", color = null, handle = null, bot = false, channels = [] }) {
    const existing = this.q("SELECT * FROM chat_ghosts WHERE id=?").get(id);
    const before = existing ? this.open(existing.data, "ghost\u0000" + id) : {};
    const data = { name: cleanLine(name, 80) || "Alguien", title: cleanLine(title, 80), color, handle, bot: !!bot, channels: [...new Set([...(before.channels || []), ...channels])] };
    const linked = existing?.person || (email && this.people.list().find((m) => (m.email || "").toLowerCase() === String(email).toLowerCase() && !m.deactivated)?.id) || null;
    this.q("INSERT INTO chat_ghosts(id, email, person, data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, person=excluded.person, data=excluded.data")
      .run(id, email ? String(email).toLowerCase() : null, linked, this.seal(data, "ghost\u0000" + id));
    return { id, person: linked, ...data };
  }

  // ------------------------------------------------------------------ export
  /**
   * The workspace's messaging as ZIP entries (server/cloud/zip.mjs › zipStream): workspace and
   * people, channels with members, every channel's messages in files of 5,000, the audit log and
   * the files themselves. Admins only; recorded in the audit log.
   */
  async *exportEntries(person, { workspace = {}, files = true } = {}) {
    this.mustAdmin(person);
    this.audit(person, "export", { type: "workspace" }, { files });
    const enc = (v) => JSON.stringify(v, null, 1);
    yield { name: "workspace.json", data: enc({ id: workspace.id || null, name: workspace.name || null, exportedAt: new Date(this.now()).toISOString(), settings: this.settings(), format: "colmena-export-1" }) };
    yield { name: "people.json", data: enc({ members: this.directory(), ghosts: this.q("SELECT id FROM chat_ghosts").all().map((g) => this.ghost(g.id)) }), deflate: true };
    const channels = this.q("SELECT * FROM chat_channels ORDER BY created_at").all();
    yield { name: "channels.json", data: enc(channels.map((row) => ({ ...this.channelView(row, null), members: this.memberIds(row.id) }))), deflate: true };
    for (const row of channels) {
      const folder = "channels/" + (row.kind === "dm" || row.kind === "group" ? row.kind + "-" + row.id : (this.meta(row).name || "canal") + "-" + row.id.slice(0, 8));
      let after = 0, part = 1;
      for (;;) {
        const rows = this.q("SELECT * FROM chat_messages WHERE channel=? AND seq>? ORDER BY seq LIMIT 5000").all(row.id, after);
        if (!rows.length) break;
        after = rows.at(-1).seq;
        yield { name: `${folder}/messages-${String(part++).padStart(4, "0")}.json`, data: enc(rows.filter((r) => !r.deleted).map((r) => this.messageView(r))), deflate: true };
        if (rows.length < 5000) break;
      }
    }
    yield { name: "audit.json", data: enc(this.q("SELECT * FROM chat_audit ORDER BY seq").all().map((r) => ({ seq: r.seq, at: r.at, action: r.action, ...this.open(r.data, "audit") }))), deflate: true };
    if (files && this.blobs) {
      for (const f of this.q("SELECT * FROM chat_files WHERE seq IS NOT NULL ORDER BY at").all()) {
        const meta = this.open(f.data, "file\u0000" + f.id);
        const blobs = this.blobs;
        yield { name: "files/" + f.id + "-" + String(meta.name || "archivo").replace(/[\\/:*?"<>|]/g, "_"), data: async () => (await blobs.get(f.key))?.body || new Uint8Array(0) };
      }
    }
  }
}

const wordsOf = (text) => words(text);
/** The link a preview is made for. */
function linkOf(text) {
  const s = String(text || "");
  const marked = /<(https?:\/\/[^|>\s]+)(?:\|[^>]*)?>/i.exec(s)?.[1];
  if (marked) return marked.replace(/&amp;/g, "&");
  const bare = /(?:^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/i.exec(s.replace(/<[^>]*>/g, " "))?.[1];
  return bare ? bare.replace(/&amp;/g, "&") : null;
}

/** A search query: words and the filters (from:, in:, has:, before:, after:, on:, during:). */
export function parseQuery(q) {
  const out = { words: [], from: [], in: [], has: new Set(), before: null, after: null };
  for (const raw of q.match(/(?:[a-z]+:)?(?:"[^"]*"|<[^>]*>|\S+)/gi) || []) {
    const m = /^(from|de|in|en|has|tiene|before|antes|after|despues|después|on|el|during|durante):(.+)$/i.exec(raw);
    if (!m) { out.words.push(...words(raw.replace(/^"|"$/g, ""))); continue; }
    const key = { de: "from", en: "in", tiene: "has", antes: "before", despues: "after", después: "after", el: "on", durante: "during" }[m[1].toLowerCase()] || m[1].toLowerCase();
    const v = m[2].replace(/^"|"$/g, "");
    if (key === "from") out.from.push(v.replace(/^<@|>$/g, ""));
    else if (key === "in") out.in.push(v.replace(/^#/, "").replace(/^<#|>$/g, ""));
    else if (key === "has") { const h = { archivo: "file", file: "file", enlace: "link", link: "link", pin: "pin", fijado: "pin" }[v.toLowerCase()]; if (h) out.has.add(h); }
    else if (key === "before") out.before = dayStart(v) ?? out.before;
    else if (key === "after") { const d = dayStart(v); if (d != null) out.after = d + 86400000; }
    else if (key === "on") { const d = dayStart(v); if (d != null) { out.after = d; out.before = d + 86400000; } }
    else if (key === "during") {
      if (/^\d{4}-\d{2}$/.test(v)) { const d = dayStart(v + "-01"); if (d != null) { out.after = d; const e = new Date(d); e.setUTCMonth(e.getUTCMonth() + 1); out.before = e.getTime(); } }
      else if (/^\d{4}$/.test(v)) { out.after = dayStart(v + "-01-01"); out.before = dayStart(Number(v) + 1 + "-01-01"); }
    }
  }
  return { ...out, has: out.has };
}
