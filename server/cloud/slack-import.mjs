// The Slack import of a hosted workspace (docs/CLOUD.md › Phase 2 › Slack import). An admin uploads
// the export ZIP in parts (each a blob: server/cloud/blobs.mjs); the import then runs in the
// background in small steps (Workspace#alarm calls `step` until it is done), so it fits the Durable
// Object's CPU and memory limits and resumes where it stopped after an eviction: its state (phase,
// cursor, counts) is saved after every step, and every message is keyed by (import, channel, ts) so
// a step that is repeated after a crash does not import anything twice.
//
//   scan      read the ZIP's directory and users/channels files; people become ghosts (matched to
//             members by email), unknown people become pending invitations, conversations become
//             channels with their members
//   messages  day file by day file, oldest first: text converted, threads, broadcasts, reactions,
//             edits, pins; files copied when the export holds them, kept as links otherwise
//   done      a summary
import { randomUUID } from "node:crypto";
import { openZip, partsSource } from "./zip.mjs";
import { classifyExport, convertText, normalizeMessage, parseConversations, parseUsers } from "./slack-export.mjs";

export const IMPORT_LIMITS = Object.freeze({ partSize: 64 * 1024 * 1024, maxParts: 200, maxSize: 8 * 1024 * 1024 * 1024 });

const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const decoder = new TextDecoder();

export class SlackImport {
  /** `chat`: the TeamChat; `blobs`: where the parts and copied files go. */
  constructor({ chat, blobs, log = () => {} }) {
    this.chat = chat;
    this.blobs = blobs;
    this.log = log;
  }
  state(id) { return id ? this.chat.kvGet("import:" + id) : null; }
  save(s) { s.updatedAt = this.chat.now(); this.chat.kvSet("import:" + s.id, s); return s; }
  latest() { const id = this.chat.kvGet("import:latest")?.id; return id ? this.state(id) : null; }
  view(s) {
    if (!s) return null;
    const { cursor: _c, plan: _p, pendingInvites: _i, ...rest } = s;
    const total = s.plan?.totalDays || 0;
    return { ...rest, partSize: IMPORT_LIMITS.partSize, progress: s.status === "done" ? 1 : total ? Math.min(0.99, (s.plan.doneDays || 0) / total) : 0 };
  }
  /** The import running or waiting to run, if any. */
  active() { const s = this.latest(); return s && ["queued", "running"].includes(s.status) ? s : null; }
  partKey(id, n) { return "imports/" + id + "/part-" + String(n).padStart(4, "0"); }

  create(person, { size, name = "slack.zip" } = {}) {
    this.chat.mustAdmin(person);
    if (this.active()) fail("Ya hay una importación en marcha.", 409);
    const total = Math.floor(Number(size) || 0);
    if (total <= 0 || total > IMPORT_LIMITS.maxSize) fail("El archivo no es válido o es demasiado grande.");
    const parts = Math.ceil(total / IMPORT_LIMITS.partSize);
    if (parts > IMPORT_LIMITS.maxParts) fail("El archivo es demasiado grande.");
    const s = { id: randomUUID(), status: "uploading", name: String(name).slice(0, 120), size: total, parts, received: [], startedBy: { id: person.id, name: person.name || null, email: person.email || null }, createdAt: this.chat.now(), phase: null, counts: {}, errors: [] };
    this.save(s);
    this.chat.kvSet("import:latest", { id: s.id });
    return { id: s.id, partSize: IMPORT_LIMITS.partSize, parts };
  }
  /** One part of the upload: bytes (or a stream of `size` bytes) for part `n` (0-based). */
  async putPart(person, id, n, body, size) {
    this.chat.mustAdmin(person);
    const s = this.state(id);
    if (!s || s.status !== "uploading") fail("Esa importación no espera archivos.", 409);
    const k = Math.floor(Number(n));
    if (!(k >= 0 && k < s.parts)) fail("Parte no válida.");
    const expected = k === s.parts - 1 ? s.size - k * IMPORT_LIMITS.partSize : IMPORT_LIMITS.partSize;
    if (size != null && Number(size) !== expected) fail("La parte no tiene el tamaño esperado.");
    const stored = await this.blobs.put(this.partKey(id, k), body, { size: expected, type: "application/zip" });
    if (stored.size && stored.size !== expected) fail("La parte llegó incompleta.");
    const fresh = this.state(id);
    fresh.received = [...new Set([...(fresh.received || []), k])].sort((a, b) => a - b);
    this.save(fresh);
    return { received: fresh.received.length, parts: fresh.parts };
  }
  start(person, id) {
    this.chat.mustAdmin(person);
    const s = this.state(id);
    if (!s || s.status !== "uploading") fail("Esa importación no se puede empezar.", 409);
    if ((s.received || []).length !== s.parts) fail("Faltan partes del archivo por subir.", 409);
    s.status = "queued";
    s.phase = "scan";
    s.startedAt = this.chat.now();
    this.chat.audit(person, "import.start", { type: "import", id }, { name: s.name, size: s.size });
    return this.view(this.save(s));
  }
  cancel(person, id) {
    this.chat.mustAdmin(person);
    const s = this.state(id);
    if (!s || ["done", "failed", "cancelled"].includes(s.status)) return this.view(s);
    s.status = "cancelled";
    this.chat.audit(person, "import.cancel", { type: "import", id });
    this.removeParts(s).catch(() => {});
    return this.view(this.save(s));
  }
  async source(s) {
    const parts = [];
    for (let k = 0; k < s.parts; k++) {
      const key = this.partKey(s.id, k);
      const head = await this.blobs.head(key);
      if (!head) fail("Falta una parte del archivo.");
      parts.push({ size: head.size, read: (offset, length) => this.blobs.read(key, offset, length) });
    }
    return partsSource(parts);
  }
  async removeParts(s) { for (let k = 0; k < s.parts; k++) await this.blobs.remove(this.partKey(s.id, k)).catch(() => {}); }

  /**
   * One step of the running import. `maxMessages` per step (the DO's CPU budget; a clock does
   * not advance during pure computation in workerd, so the budget is counted, not timed).
   * `invite(people)`: makes pending invitations for people not in the workspace (the directory).
   */
  async step({ maxMessages = 2000, invite = null } = {}) {
    let s = this.active();
    if (!s) return null;
    if (s.status === "queued") { s.status = "running"; this.save(s); }
    try {
      const zip = await openZip(await this.source(s));
      const byName = new Map(zip.entries.map((e) => [e.name, e]));
      if (s.phase === "scan") s = await this.scan(s, zip, byName, invite);
      else if (s.phase === "messages") s = await this.messages(s, zip, byName, maxMessages);
      if (s.phase === "done") {
        s.status = "done";
        s.finishedAt = this.chat.now();
        this.chat.audit(s.startedBy, "import.done", { type: "import", id: s.id }, s.counts);
        await this.removeParts(s);
      }
      return this.view(this.save(s));
    } catch (error) {
      this.log("slack import: " + (error?.stack || error));
      const f = this.state(s.id);
      f.status = "failed";
      f.error = String(error?.message || error).slice(0, 300);
      this.save(f);
      return this.view(f);
    }
  }

  async readJson(zip, entry) {
    if (!entry) return null;
    return JSON.parse(decoder.decode(await zip.readEntry(entry, { maxBytes: 256 * 1024 * 1024 })));
  }
  map(s, kind, key) { return this.chat.q("SELECT value FROM chat_import_map WHERE import=? AND kind=? AND key=?").get(s.id, kind, key)?.value ?? null; }
  setMap(s, kind, key, value) { this.chat.q("INSERT OR REPLACE INTO chat_import_map(import, kind, key, value) VALUES(?,?,?,?)").run(s.id, kind, key, String(value)); }

  async scan(s, zip, byName, invite) {
    const chat = this.chat;
    const plan = classifyExport(zip.entries.map((e) => e.name));
    if (!plan.users || !plan.channels) fail("Esto no parece una exportación de Slack (faltan users.json o channels.json).");
    const users = parseUsers(await this.readJson(zip, byName.get(plan.users)));
    const conversations = parseConversations({
      channels: await this.readJson(zip, byName.get(plan.channels)),
      groups: plan.groups ? await this.readJson(zip, byName.get(plan.groups)) : null,
      dms: plan.dms ? await this.readJson(zip, byName.get(plan.dms)) : null,
      mpims: plan.mpims ? await this.readJson(zip, byName.get(plan.mpims)) : null,
    });
    const counts = { users: users.length, matched: 0, invited: 0, bots: 0, channels: { public: 0, private: 0, dm: 0, group: 0 }, messages: 0, threads: 0, replies: 0, reactions: 0, edited: 0, pinned: 0, files: { held: 0, linked: 0 }, skipped: 0, format: plan.format };
    const pending = [];
    const memberEmails = new Set(chat.people.list().map((m) => String(m.email || "").toLowerCase()));
    const t = chat.now();
    chat.tx(() => {
      for (const u of users) {
        const g = chat.upsertGhost("slack:" + u.slackId, { email: u.isBot ? null : u.email, name: u.name || u.handle, title: u.title || "", color: u.avatarColor || null, handle: u.handle || null, bot: u.isBot });
        if (u.isBot) counts.bots++;
        else if (g.person) counts.matched++;
        else if (u.email && !u.deleted && !memberEmails.has(u.email)) pending.push({ email: u.email, name: u.name || u.handle || null });
      }
      const personOf = (slackId) => chat.q("SELECT person FROM chat_ghosts WHERE id=?").get("slack:" + slackId)?.person || null;
      for (const c of conversations) {
        const people = [...new Set(c.members.map(personOf).filter((p) => p && chat.member(p)))];
        let row = null;
        if (c.kind === "dm" || c.kind === "group") {
          const key = people.length === c.members.length && people.length >= 2 ? [...people].sort().join("|") : null;
          row = key ? chat.q("SELECT * FROM chat_channels WHERE dm_key=?").get(key) : null;
          row ??= chat.insertChannel({ kind: c.kind, dmKey: key, members: people, extra: { imported: { source: "slack", id: c.slackId } }, at: c.createdAt || t });
        } else {
          const existing = chat.q("SELECT * FROM chat_channels WHERE kind IN ('public','private') AND last_seq=0").all().find((r) => chat.meta(r).name === c.name && r.kind === c.kind);
          if (existing) {
            row = existing;
            for (const p of people) chat.addMember(row, p, { quiet: true });
          } else {
            row = chat.insertChannel({ kind: c.kind, name: chat.uniqueName(c.name || "slack"), topic: (c.topic || "").slice(0, 250), description: (c.purpose || "").slice(0, 1000), createdBy: personOf(c.creator), members: people, extra: { imported: { source: "slack", id: c.slackId } }, at: c.createdAt || t });
          }
          if (c.archived) chat.q("UPDATE chat_channels SET archived=1 WHERE id=?").run(row.id);
        }
        counts.channels[c.kind]++;
        this.setMap(s, "channel", c.slackId, row.id);
        // People who have not joined yet get these channels when they do (TeamChat#syncPeople).
        for (const slackId of c.members) if (!personOf(slackId)) chat.upsertGhost("slack:" + slackId, { ...(chat.ghost("slack:" + slackId) || { name: slackId }), email: chat.q("SELECT email FROM chat_ghosts WHERE id=?").get("slack:" + slackId)?.email || null, channels: [row.id] });
      }
    });
    const convs = conversations.map((c) => ({ slackId: c.slackId, channel: this.map(s, "channel", c.slackId), days: plan.conversations.get(c.folder) || [] })).filter((c) => c.days.length);
    s.plan = { convs, uploads: Object.fromEntries(plan.uploads), totalDays: convs.reduce((n, c) => n + c.days.length, 0), doneDays: 0 };
    s.cursor = { conv: 0, day: 0, index: 0 };
    s.counts = counts;
    if (pending.length && invite) {
      try {
        const made = await invite(pending.slice(0, 5000));
        counts.invited = (made?.created || 0) + (made?.existing || 0);
      } catch (error) { s.errors.push("Invitaciones: " + String(error?.message || error).slice(0, 200)); }
    } else counts.invited = 0;
    counts.pendingPeople = pending.length;
    s.phase = "messages";
    return s;
  }

  async messages(s, zip, byName, maxMessages) {
    const chat = this.chat;
    let done = 0;
    while (s.cursor.conv < s.plan.convs.length && done < maxMessages) {
      const conv = s.plan.convs[s.cursor.conv];
      if (s.cursor.day >= conv.days.length) {
        // A conversation done: what was imported does not show as unread to anyone.
        const row = chat.row(conv.channel);
        if (row) chat.q("UPDATE chat_members SET read_seq=? WHERE channel=?").run(row.last_seq, row.id);
        s.cursor = { conv: s.cursor.conv + 1, day: 0, index: 0 };
        continue;
      }
      const entry = byName.get(conv.days[s.cursor.day]);
      const raw = entry ? await this.readJson(zip, entry) : [];
      const list = (Array.isArray(raw) ? raw : []).map((r) => ({ raw: r, n: normalizeMessage(r) }));
      const valid = list.filter((x) => x.n).sort((a, b) => a.n.at - b.n.at || String(a.n.ts).localeCompare(String(b.n.ts)));
      if (s.cursor.index === 0) s.counts.skipped += list.length - valid.length;
      const slice = valid.slice(s.cursor.index, s.cursor.index + (maxMessages - done));
      await this.insert(s, zip, byName, conv, slice.map((x) => x.n));
      done += slice.length;
      s.cursor.index += slice.length;
      if (s.cursor.index >= valid.length) { s.cursor = { conv: s.cursor.conv, day: s.cursor.day + 1, index: 0 }; s.plan.doneDays++; }
      this.save(s);
    }
    if (s.cursor.conv >= s.plan.convs.length) s.phase = "done";
    void chat;
    return s;
  }

  /** Inserts messages of one conversation (in order), copying held files first. */
  async insert(s, zip, byName, conv, messages) {
    const chat = this.chat;
    const channel = chat.row(conv.channel);
    if (!channel) return;
    const who = (slackId) => {
      if (!slackId) return null;
      const g = chat.q("SELECT person FROM chat_ghosts WHERE id=?").get("slack:" + slackId);
      return g ? g.person || "slack:" + slackId : null;
    };
    // Files the export holds are copied before the rows that point at them.
    const copied = new Map();
    for (const m of messages) for (const f of m.files) {
      const entryName = s.plan.uploads[f.id];
      if (!entryName || this.map(s, "file", f.id)) continue;
      const entry = byName.get(entryName);
      if (!entry) continue;
      const fileId = randomUUID();
      const key = chat.fileKey(channel.id, fileId, f.name);
      await this.blobs.put(key, zip.streamEntry(entry), { size: entry.size, type: f.mimetype || "application/octet-stream" });
      copied.set(f.id, { id: fileId, key, size: entry.size });
    }
    chat.tx(() => {
      let lastTop = null, lastAt = null;
      for (const m of messages) {
        if (this.map(s, "ts", conv.channel + "|" + m.ts)) continue; // already imported (a repeated step)
        const author = who(m.user);
        const text = chat.cleanText(convertText(m.text, {
          user: (id, label) => { const p = who(id); return p ? "<@" + p + ">" : "@" + (label || id); },
          channel: (id, label) => { const c = this.map(s, "channel", id); return c ? "<#" + c + ">" : "#" + (label || "canal"); },
        }).slice(0, 40000));
        let root = null;
        if (m.threadTs) {
          const ref = this.map(s, "root", conv.channel + "|" + m.threadTs);
          if (ref) { const [seq, id] = ref.split("|"); root = { seq: Number(seq), id }; }
        }
        const top = !root || m.broadcast ? 1 : 0;
        const reactions = {};
        for (const r of m.reactions) {
          const ids = r.users.map(who).filter(Boolean);
          if (ids.length) { reactions[r.emoji] = [...new Set([...(reactions[r.emoji] || []), ...ids])]; s.counts.reactions++; }
        }
        const files = [];
        for (const f of m.files) {
          const c = copied.get(f.id);
          if (c) { files.push({ id: c.id, name: f.name, type: f.mimetype || "application/octet-stream", size: c.size, w: null, h: null, key: c.key }); s.counts.files.held++; }
          else if (f.url || f.name) { files.push({ id: null, name: f.name, type: f.mimetype || null, size: f.size, link: f.url && /^https:\/\//.test(f.url) ? f.url : null, external: true }); s.counts.files.linked++; }
        }
        const id = randomUUID();
        const data = { text, files: files.map(({ key: _k, ...f }) => f), reactions, threadId: root ? root.id : null, repliers: [], imported: { source: "slack", ts: m.ts }, botName: m.botName || null };
        const seq = chat.q("INSERT INTO chat_messages(id, channel, thread, top, author, at, edited_at, pinned, has_file, has_link, data) VALUES(?,?,?,?,?,?,?,?,?,?,?) RETURNING seq")
          .get(id, channel.id, root ? root.seq : null, top, author, m.at, m.editedAt, m.pinned ? 1 : 0, files.length ? 1 : 0, /(?:<|\b)https?:\/\//i.test(text) ? 1 : 0, chat.seal(data, "message\u0000" + id)).seq;
        this.setMap(s, "ts", conv.channel + "|" + m.ts, seq);
        if (m.isRoot || !m.threadTs) this.setMap(s, "root", conv.channel + "|" + m.ts, seq + "|" + id);
        for (const f of files) if (f.id) { chat.q("INSERT INTO chat_files(id, channel, seq, uploader, at, size, key, data) VALUES(?,?,?,?,?,?,?,?)").run(f.id, channel.id, seq, author, m.at, f.size || 0, f.key, chat.seal({ name: f.name, type: f.type, w: null, h: null }, "file\u0000" + f.id)); }
        for (const [slackFile, c] of copied) this.setMap(s, "file", slackFile, c.id);
        chat.index(seq, text + " " + files.map((f) => f.name).join(" "));
        if (root) {
          const r = chat.q("SELECT * FROM chat_messages WHERE seq=?").get(root.seq);
          if (r) {
            const rd = chat.mdata(r);
            if (author) rd.repliers = [...(rd.repliers || []).filter((p) => p !== author), author].slice(-20);
            if (!r.replies) s.counts.threads++;
            chat.q("UPDATE chat_messages SET replies=replies+1, last_reply_at=?, data=? WHERE seq=?").run(m.at, chat.seal(rd, "message\u0000" + r.id), r.seq);
          }
          s.counts.replies++;
        }
        if (top) { lastTop = seq; lastAt = m.at; }
        if (m.editedAt) s.counts.edited++;
        if (m.pinned) s.counts.pinned++;
        s.counts.messages++;
      }
      if (lastTop) chat.q("UPDATE chat_channels SET last_seq=max(last_seq, ?), last_at=max(coalesce(last_at,0), ?) WHERE id=?").run(lastTop, lastAt, channel.id);
    });
  }
}
