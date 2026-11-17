// What team messaging adds to Slack's basics (docs/CLOUD.md › Phase 2 › Encargos y más):
//
// - Encargos: a message becomes a job for a person or a bot. The card sits on the message, its
//   state («Pendiente», «Trabajando», «Hecho ✓») is seen by everyone in the channel, and the
//   thread says who asked whom and when it was done. A bot's encargo is its work in that thread
//   (channel-bots.mjs), done when that work completes.
// - Polls: a message with options; people vote (one or several), the author or an admin closes it.
// - Saved for later: your own list of messages, private to you.
// - Scheduled messages: written now, sent by Colmena as you at the time you chose (the alarm).
// - Reminders (/recordar): at that time Colmena writes to you in your own conversation.
//
// Everything is sealed like the rest of the chat; every read and write checks the channel first.
import { randomUUID } from "node:crypto";
import { ChatError, CHAT_LIMITS } from "./chat.mjs";
import { parseWhen, whenLabel } from "./when.mjs";

const fail = (message, status = 400, code = null) => { throw new ChatError(message, status, code); };
const line = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export const PLUS_LIMITS = Object.freeze({ title: 300, pollOptions: 10, pollOption: 120, question: 300, saved: 500, timedPerPerson: 100, yearMs: 366 * 86400000 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_tasks (id TEXT PRIMARY KEY, channel TEXT NOT NULL, seq INTEGER NOT NULL, assignee TEXT NOT NULL, created_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', mission TEXT, at INTEGER NOT NULL, done_at INTEGER, due INTEGER, data BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS chat_tasks_assignee ON chat_tasks(assignee, status);
CREATE INDEX IF NOT EXISTS chat_tasks_creator ON chat_tasks(created_by, status);
CREATE INDEX IF NOT EXISTS chat_tasks_channel ON chat_tasks(channel, status);
CREATE INDEX IF NOT EXISTS chat_tasks_mission ON chat_tasks(mission) WHERE mission IS NOT NULL;
CREATE TABLE IF NOT EXISTS chat_saved (person TEXT NOT NULL, message TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(person, message)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS chat_timed (id TEXT PRIMARY KEY, person TEXT NOT NULL, kind TEXT NOT NULL, due INTEGER NOT NULL, data BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS chat_timed_due ON chat_timed(due);
CREATE INDEX IF NOT EXISTS chat_timed_person ON chat_timed(person, kind, due);
`;
const TASK_STATES = new Set(["open", "working", "done", "failed"]);

export class ChatPlus {
  /** `runAs(person, fn)`: background work (the alarm) as that person (server/identity.mjs). */
  constructor({ chat, runAs = (person, fn) => fn(), log = () => {} }) {
    Object.assign(this, { chat, runAs, log });
    this.bots = null; // ChannelBots, once it exists (host.mjs)
    chat.db.exec(SCHEMA);
    // Messages carry the ids of their encargos; their views come from here (chat.mjs › messageView).
    chat.taskViews = (ids) => this.taskViews(ids);
  }
  q(text) { return this.chat.q(text); }
  now() { return this.chat.now(); }
  tzOf(personId) { return this.chat.profile(personId)?.tz || this.chat.zone() || null; }
  name(id) { return this.chat.member(id)?.name || (String(id).startsWith("bot:") ? this.chat.bots().find((b) => "bot:" + b.id === id)?.name || "El bot" : "Alguien"); }
  /** A message someone may read: its row and its channel's. */
  readable(person, messageId) {
    const row = this.chat.mrow(messageId);
    if (!row || row.deleted) fail("No existe ese mensaje.", 404, "message");
    this.chat.mustRead(person, row.channel);
    return row;
  }
  /** Colmena's own line in a thread (or in the channel). */
  note(channel, rootId, text) {
    try { return this.chat.postBot(channel, { botId: "colmena", botName: "Colmena", text, thread: rootId }); } catch (error) { this.log("note: " + (error?.message || error)); return null; }
  }
  rootOf(row) { return row.thread ? this.chat.mdata(row).threadId : row.id; }
  /** A «para ti» line for one person (badge, «Para ti», a notice on their screens and devices). */
  tell(personId, row, kind, payload) {
    if (!this.chat.member(personId)) return;
    this.q("INSERT OR IGNORE INTO chat_mentions(person, seq, channel, at, kind) VALUES(?,?,?,?,?)").run(personId, row.seq, row.channel, this.now(), kind);
    const online = this.chat.presence().get(personId);
    if (online === "active" || online === "away") this.chat.emit({ type: "chat.notify", channel: row.channel, thread: row.thread ? this.chat.mdata(row).threadId : null, author: null, ...payload }, { people: [personId] });
    if (online !== "active" && this.chat.push) this.chat.defer(this.chat.push(personId, payload));
    // The badge on that channel in their sidebar.
    const cv = this.chat.channelView(this.chat.row(row.channel), { id: personId });
    if (cv.member) this.chat.emit({ type: "chat.read", channel: row.channel, readSeq: cv.readSeq, unread: cv.unread, mentions: cv.mentions }, { people: [personId] });
  }

  // ------------------------------------------------------------------ encargos
  taskRow(id) { return typeof id === "string" ? this.q("SELECT * FROM chat_tasks WHERE id=?").get(id) || null : null; }
  taskView(r) {
    const d = this.chat.open(r.data, "task\u0000" + r.id);
    return { id: r.id, channel: r.channel, assignee: r.assignee, createdBy: r.created_by, status: r.status, title: d.title || "", at: r.at, due: r.due || null, doneAt: r.done_at || null, doneBy: d.doneBy || null };
  }
  taskViews(ids) { return (ids || []).map((id) => this.taskRow(id)).filter(Boolean).map((r) => this.taskView(r)); }
  /**
   * An encargo: on an existing message (`message`), or a new message with `title` as its text
   * (/encargo). `assignee`: a person's id or «bot:<id>». `due`: ms or a «cuándo» in words.
   */
  createTask(person, channelId, { message = null, assignee, title = "", due = null, thread = null } = {}) {
    const me = this.chat.must(person);
    const row = this.chat.mustPost(person, channelId);
    const who = String(assignee || "");
    const bot = who.startsWith("bot:") ? this.chat.bots().find((b) => "bot:" + b.id === who) : null;
    if (who.startsWith("bot:")) {
      if (!bot) fail("Ese bot no está disponible.", 404, "bot");
      if (me.role === "guest") fail("Los invitados no pueden encargar trabajo a los bots.", 403, "guest");
    } else {
      if (!this.chat.member(who)) fail("Elige a quién se lo encargas.", 400, "assignee");
      // They must see the message: in a public channel they join it; elsewhere they must be there.
      if (!this.chat.canRead({ id: who }, row)) fail(this.name(who) + " no está en esta conversación: añádele primero.", 409, "not-member");
      if (row.kind === "public" && !this.chat.membership(row.id, who) && this.chat.member(who)?.role !== "guest") this.chat.addMember(row, who);
    }
    let dueAt = null;
    if (due != null && due !== "") {
      dueAt = typeof due === "number" ? due : parseWhen(String(due), { now: this.now(), tz: this.tzOf(me.id) })?.at ?? null;
      if (!dueAt) fail("No entiendo la fecha. Prueba «mañana», «el viernes» o «el 25/11».", 400, "due");
    }
    let source;
    if (message) {
      source = this.chat.mrow(message);
      if (!source || source.deleted || source.channel !== channelId) fail("No existe ese mensaje.", 404, "message");
    }
    const clean = line(title || (source ? this.plainOf(source) : ""), PLUS_LIMITS.title);
    if (!clean) fail("Escribe qué hay que hacer.");
    const id = randomUUID(), at = this.now();
    if (!source) {
      const sent = this.chat.post(person, channelId, { text: title, thread }, { extra: { tasks: [id] }, quiet: true });
      source = this.chat.mrow(sent.message.id);
    }
    this.q("INSERT INTO chat_tasks(id, channel, seq, assignee, created_by, status, at, due, data) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id, channelId, source.seq, who, me.id, "open", at, dueAt, this.chat.seal({ title: clean }, "task\u0000" + id));
    const root = this.rootOf(source);
    const dueText = dueAt ? " para " + whenLabel(dueAt, { now: at, tz: this.tzOf(me.id) }) : "";
    if (message) {
      this.chat.patchMessage(source.id, (d) => { d.tasks = [...new Set([...(d.tasks || []), id])].slice(-10); });
      this.note(channelId, root, `${me.name} le encargó esto a ${this.name(who)}${dueText}.`);
    } else this.chat.patchMessage(source.id, () => true);
    if (bot) {
      const missionId = this.bots?.assign(person, row, this.chat.messageView(source), bot.id, clean);
      if (missionId) this.q("UPDATE chat_tasks SET status='working', mission=? WHERE id=?").run(missionId, id);
      else this.q("UPDATE chat_tasks SET status='failed' WHERE id=?").run(id);
      this.chat.patchMessage(source.id, () => true);
    } else if (who !== me.id) {
      this.tell(who, source, "task", { title: me.name + " te ha encargado algo", body: clean.slice(0, 140) + dueText, url: "/canal/" + channelId + "?hilo=" + root, tag: "task-" + id });
    }
    return this.taskView(this.taskRow(id));
  }
  /**
   * An encargo a bot gives in its thread (its tool, channel-bots.mjs): a message of the bot with
   * the card. It counts as asked by `by`, the person the bot works for (they may change it).
   * `assignee`: a person's id or «bot:<id>».
   */
  botTask({ channel, thread, botId, botName, by, assignee, title, due = null }) {
    const row = this.chat.row(channel);
    if (!row) fail("Ese canal ya no existe.");
    const asker = this.chat.member(by);
    if (!asker) fail("No sé para quién trabajas.");
    const who = String(assignee || "");
    if (who.startsWith("bot:")) {
      if (!this.chat.bots().some((b) => "bot:" + b.id === who)) fail("Ese bot no está disponible.");
    } else if (!this.chat.member(who) || !this.chat.canRead({ id: who }, row)) fail("Esa persona no está en esta conversación.");
    const clean = line(title, PLUS_LIMITS.title);
    if (!clean) fail("Di qué hay que hacer.");
    let dueAt = null;
    if (due) {
      dueAt = parseWhen(String(due), { now: this.now(), tz: this.tzOf(by) })?.at ?? null;
      if (!dueAt) fail("No entiendo la fecha: usa «mañana», «el viernes», «el 25/11 a las 10».");
    }
    const id = randomUUID(), at = this.now();
    const view = this.chat.postBot(channel, { botId, botName, text: clean, thread, extra: { tasks: [id] } });
    if (!view) fail("No se pudo publicar el encargo.");
    this.q("INSERT INTO chat_tasks(id, channel, seq, assignee, created_by, status, at, due, data) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id, channel, view.seq, who, by, "open", at, dueAt, this.chat.seal({ title: clean }, "task\u0000" + id));
    this.chat.patchMessage(view.id, () => true);
    const source = this.chat.mrow(view.id);
    if (!who.startsWith("bot:") && who !== by) this.tell(who, source, "task", { title: (botName || "Un bot") + " te ha encargado algo", body: clean.slice(0, 140), url: "/canal/" + channel + "?hilo=" + this.rootOf(source), tag: "task-" + id });
    return this.taskView(this.taskRow(id));
  }
  /** A bot's «vuelvo mañana a las 9»: at that time its conversation goes on by itself (fire). */
  followup({ by, missionId, botId, when, note = "" }) {
    if (!this.chat.member(by)) fail("No sé para quién trabajas.");
    const due = this.dueOf(by, null, when);
    if (this.q("SELECT count(*) AS n FROM chat_timed WHERE kind='followup' AND person=?").get(by).n >= PLUS_LIMITS.timedPerPerson) fail("Hay demasiados seguimientos pendientes.");
    const id = randomUUID();
    this.q("INSERT INTO chat_timed(id, person, kind, due, data) VALUES(?,?,?,?,?)").run(id, by, "followup", due, this.chat.seal({ missionId, botId, note: line(note, 500) }, "timed\u0000" + id));
    return { id, at: due, label: whenLabel(due, { now: this.now(), tz: this.tzOf(by) }) };
  }
  plainOf(row) { return this.plainText(this.chat.mdata(row).text); }
  /** A stored text (Slack's format) as plain words: names for mentions, labels for links. */
  plainText(text) { return line(text || "", 2000).replace(/<@([^>]+)>/g, (_, id) => "@" + this.name(id)).replace(/<[^>]*\|([^>]*)>/g, "$1").replace(/<([^>]*)>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"); }
  /** «Hecho» / «Reabrir»: the person it is for, who asked for it, or an admin. */
  setTask(person, id, { status }) {
    const me = this.chat.must(person);
    const r = this.taskRow(id);
    if (!r) fail("No existe ese encargo.", 404, "task");
    const source = this.chat.mrow(this.q("SELECT id FROM chat_messages WHERE seq=?").get(r.seq)?.id);
    this.chat.mustRead(person, r.channel);
    if (![r.assignee, r.created_by].includes(me.id) && !this.chat.isAdmin(person)) fail("Solo quien lo pidió o a quien se lo pidieron puede cambiarlo.", 403, "task");
    if (!["open", "done"].includes(status)) fail("Estado no válido.");
    if (r.status === status) return this.taskView(r);
    this.finish(r, status, me.id, source);
    return this.taskView(this.taskRow(id));
  }
  finish(r, status, by, source = this.chat.mrow(this.q("SELECT id FROM chat_messages WHERE seq=?").get(r.seq)?.id)) {
    if (!TASK_STATES.has(status)) return;
    const d = this.chat.open(r.data, "task\u0000" + r.id);
    const done = status === "done";
    this.q("UPDATE chat_tasks SET status=?, done_at=?, data=? WHERE id=?").run(status, done ? this.now() : null, this.chat.seal({ ...d, doneBy: done ? by : null }, "task\u0000" + r.id), r.id);
    if (!source) return;
    this.chat.patchMessage(source.id, () => true);
    const root = this.rootOf(source);
    const who = by && !String(by).startsWith("bot:") ? this.name(by) : this.name(r.assignee);
    const text = status === "done" ? `${who} marcó como hecho «${d.title}» ✓`
      : status === "failed" ? `${this.name(r.assignee)} no pudo terminar «${d.title}».`
      : `${who} volvió a abrir «${d.title}».`;
    this.note(r.channel, root, text);
    if (status !== "open" && r.created_by !== by) this.tell(r.created_by, source, "task", { title: status === "done" ? "Encargo hecho ✓" : "Encargo sin terminar", body: text.slice(0, 140), url: "/canal/" + r.channel + "?hilo=" + root, tag: "task-" + r.id });
  }
  /** A bot's encargo: its work in the thread ended (channel-bots.mjs). */
  missionEnded(missionId, ok, answeredSince = () => true) {
    for (const r of this.q("SELECT * FROM chat_tasks WHERE mission=? AND status='working'").all(missionId)) {
      if (answeredSince(r.at)) this.finish(r, ok ? "done" : "failed", r.assignee);
    }
  }
  /** Encargos for you («para-mi»), the ones you asked for («pedidos»), or a channel's. Open first. */
  tasks(person, { scope = "para-mi", channel = null, status = null } = {}) {
    const me = this.chat.must(person);
    let rows;
    if (scope === "canal") { this.chat.mustRead(person, String(channel || "")); rows = this.q("SELECT * FROM chat_tasks WHERE channel=? ORDER BY at DESC LIMIT 200").all(channel); }
    else if (scope === "pedidos") rows = this.q("SELECT * FROM chat_tasks WHERE created_by=? ORDER BY at DESC LIMIT 200").all(me.id);
    else rows = this.q("SELECT * FROM chat_tasks WHERE assignee=? ORDER BY at DESC LIMIT 200").all(me.id);
    const items = rows.filter((r) => this.chat.canRead(person, this.chat.row(r.channel)) && (!status || (status === "open" ? r.status !== "done" : r.status === status)))
      .map((r) => {
        const m = this.q("SELECT * FROM chat_messages WHERE seq=?").get(r.seq);
        return { task: this.taskView(r), message: m && !m.deleted ? this.chat.messageView(m) : null };
      })
      .sort((a, b) => (a.task.status === "done") - (b.task.status === "done") || (a.task.due || Infinity) - (b.task.due || Infinity) || b.task.at - a.task.at);
    return { items, ghosts: this.chat.ghostsFor(items.map((i) => i.message).filter(Boolean)) };
  }

  // ------------------------------------------------------------------ polls
  createPoll(person, channelId, { question, options = [], multi = false, thread = null } = {}) {
    const me = this.chat.must(person);
    const poll = this.pollOf(question, options, multi, me.id);
    const sent = this.chat.post(person, channelId, { text: "", thread }, { extra: { poll } });
    this.chat.index(sent.message.seq, poll.question + " " + poll.options.map((o) => o.text).join(" "));
    return sent;
  }
  /** Options as a poll keeps them, or a refusal (2 to 10, no repeats, no empty ones). */
  pollOf(question, options, multi, by) {
    const q = line(question, PLUS_LIMITS.question);
    if (!q) fail("Escribe la pregunta.");
    const opts = [...new Set((Array.isArray(options) ? options : []).map((o) => line(o, PLUS_LIMITS.pollOption)).filter(Boolean))];
    if (opts.length < 2) fail("Una encuesta necesita al menos dos opciones.");
    if (opts.length > PLUS_LIMITS.pollOptions) fail("Como mucho " + PLUS_LIMITS.pollOptions + " opciones.");
    return { question: q, options: opts.map((text, i) => ({ id: "o" + (i + 1), text })), votes: {}, multi: !!multi, by, closed: false };
  }
  /**
   * A bot's poll in its thread (channel-bots.mjs). `closeWhenAll`: it closes by itself once every
   * person of the conversation voted, and the bot hears the result (`onPollClosed`).
   */
  botPoll({ channel, thread, botId, botName, question, options, multi = false, closeWhenAll = true, missionId = null }) {
    const poll = { ...this.pollOf(question, options, multi, "bot:" + botId), closeWhenAll: !!closeWhenAll, missionId };
    const view = this.chat.postBot(channel, { botId, botName, text: "", thread, extra: { poll } });
    if (!view) fail("No se pudo publicar la encuesta.");
    this.chat.index(view.seq, poll.question + " " + poll.options.map((o) => o.text).join(" "));
    return view;
  }
  vote(person, messageId, choice = []) {
    const me = this.chat.must(person);
    const row = this.readable(person, messageId);
    this.chat.mustPost(person, row.channel);
    const ids = [...new Set(Array.isArray(choice) ? choice : [choice])].map(String);
    // People who can vote: the conversation's people, guests too (a poll among everyone there).
    const voters = this.chat.memberIds(row.channel).filter((p) => this.chat.member(p));
    let closedNow = null;
    const view = this.chat.patchMessage(messageId, (d) => {
      if (!d.poll) fail("Ese mensaje no es una encuesta.", 400, "poll");
      if (d.poll.closed) fail("La encuesta está cerrada.", 409, "closed");
      const valid = new Set(d.poll.options.map((o) => o.id));
      const chosen = ids.filter((id) => valid.has(id)).slice(0, d.poll.multi ? valid.size : 1);
      const votes = {};
      for (const o of d.poll.options) votes[o.id] = (d.poll.votes?.[o.id] || []).filter((p) => p !== me.id);
      for (const id of chosen) votes[id].push(me.id);
      d.poll.votes = votes;
      const voted = new Set(Object.values(votes).flat());
      if (d.poll.closeWhenAll && voters.length && voters.every((p) => voted.has(p))) { d.poll.closed = true; closedNow = d.poll; }
    });
    if (closedNow) try { this.onPollClosed?.(view, closedNow); } catch (error) { this.log("poll: " + (error?.message || error)); }
    return view;
  }
  closePoll(person, messageId, closed = true) {
    const me = this.chat.must(person);
    const row = this.readable(person, messageId);
    const d = this.chat.mdata(row);
    if (!d.poll) fail("Ese mensaje no es una encuesta.", 400, "poll");
    if (row.author !== me.id && !this.chat.isAdmin(person)) fail("Solo quien la creó puede cerrarla.", 403, "poll");
    return this.chat.patchMessage(messageId, (x) => { x.poll.closed = !!closed; });
  }
  /** A bot closes its own poll (its tool); the latest open one of its thread when none is named. */
  closeBotPoll({ channel, thread, botId }) {
    const who = "bot:" + botId;
    const root = this.chat.mrow(thread);
    if (!root) fail("Ese hilo ya no existe.");
    const rows = [root, ...this.q("SELECT * FROM chat_messages WHERE thread=? AND deleted=0 ORDER BY seq DESC LIMIT 100").all(root.seq)];
    const mine = rows.find((r) => r.author === who && r.channel === channel && this.chat.mdata(r).poll && !this.chat.mdata(r).poll.closed);
    if (!mine) fail("No tienes ninguna encuesta abierta en este hilo.");
    return this.chat.patchMessage(mine.id, (x) => { x.poll.closed = true; });
  }
  /** A poll's result in words, for the bot that asked. */
  pollResult(poll) {
    const votes = poll.votes || {};
    return poll.options.map((o) => `${o.text}: ${(votes[o.id] || []).length} (${(votes[o.id] || []).map((p) => this.name(p)).join(", ") || "nadie"})`).join("; ");
  }

  // ------------------------------------------------------------------ saved for later
  save(person, messageId, on = true) {
    const me = this.chat.must(person);
    this.readable(person, messageId);
    if (on) {
      if (this.q("SELECT count(*) AS n FROM chat_saved WHERE person=?").get(me.id).n >= PLUS_LIMITS.saved) fail("Tienes demasiados mensajes guardados: quita alguno.", 409, "full");
      this.q("INSERT OR IGNORE INTO chat_saved(person, message, at) VALUES(?,?,?)").run(me.id, messageId, this.now());
    } else this.q("DELETE FROM chat_saved WHERE person=? AND message=?").run(me.id, messageId);
    this.chat.emit({ type: "chat.saved", message: messageId, on: !!on }, { people: [me.id] });
    return { saved: !!on };
  }
  savedIds(personId) { return this.q("SELECT message FROM chat_saved WHERE person=? ORDER BY at DESC").all(personId).map((r) => r.message); }
  saved(person) {
    const me = this.chat.must(person);
    const items = [];
    for (const r of this.q("SELECT * FROM chat_saved WHERE person=? ORDER BY at DESC").all(me.id)) {
      const m = this.chat.mrow(r.message);
      if (!m || m.deleted || !this.chat.canRead(person, this.chat.row(m.channel))) continue;
      items.push({ savedAt: r.at, message: this.chat.messageView(m) });
    }
    return { items, ghosts: this.chat.ghostsFor(items.map((i) => i.message)) };
  }

  // ------------------------------------------------------------------ scheduled messages and reminders
  timedRow(id) { return typeof id === "string" ? this.q("SELECT * FROM chat_timed WHERE id=?").get(id) || null : null; }
  timedView(r) {
    const d = this.chat.open(r.data, "timed\u0000" + r.id);
    return { id: r.id, kind: r.kind, at: r.due, text: d.text || "", channel: d.channel || null, thread: d.thread || null, alsoChannel: !!d.alsoChannel, message: d.message || null };
  }
  /** The time, in ms or in words («mañana a las 9»), still to come and within a year. */
  dueOf(personId, at, when) {
    const now = this.now();
    let due = Number.isFinite(Number(at)) && at !== null && at !== "" ? Number(at) : null;
    if (due == null && when) due = parseWhen(String(when), { now, tz: this.tzOf(personId) })?.at ?? null;
    if (due == null) fail("¿Cuándo? Prueba «mañana a las 9», «en 2 horas» o «el viernes».", 400, "when");
    if (due < now + 30000) fail("Elige un momento que aún no haya pasado.", 400, "when");
    if (due > now + PLUS_LIMITS.yearMs) fail("Como mucho, dentro de un año.", 400, "when");
    return due;
  }
  roomFor(personId, kind) {
    if (this.q("SELECT count(*) AS n FROM chat_timed WHERE person=? AND kind=?").get(personId, kind).n >= PLUS_LIMITS.timedPerPerson) fail("Tienes demasiados pendientes de este tipo.", 409, "full");
  }
  schedule(person, { channel, text = "", thread = null, alsoChannel = false, at = null, when = null } = {}) {
    const me = this.chat.must(person);
    this.chat.mustPost(person, String(channel || ""));
    const clean = this.chat.cleanText(text).trim();
    if (!clean) fail("Escribe el mensaje.");
    if (thread) { const root = this.chat.mrow(thread); if (!root || root.channel !== channel || root.thread) fail("Ese hilo ya no existe.", 404, "thread"); }
    const due = this.dueOf(me.id, at, when);
    this.roomFor(me.id, "send");
    const id = randomUUID();
    this.q("INSERT INTO chat_timed(id, person, kind, due, data) VALUES(?,?,?,?,?)").run(id, me.id, "send", due, this.chat.seal({ channel, text: clean, thread: thread || null, alsoChannel: !!(thread && alsoChannel) }, "timed\u0000" + id));
    this.changed(me.id);
    return { ...this.timedView(this.timedRow(id)), label: whenLabel(due, { now: this.now(), tz: this.tzOf(me.id) }) };
  }
  remind(person, { text = "", at = null, when = null, message = null } = {}) {
    const me = this.chat.must(person);
    let body = line(text, 1000), due;
    let ref = null;
    if (message) {
      const row = this.readable(person, message);
      ref = { channel: row.channel, message: row.id, thread: row.thread ? this.chat.mdata(row).threadId : null };
      if (!body) body = line(this.plainOf(row), 300);
    }
    if (at == null && !when && body) {
      // «/recordar mañana a las 9 llamar a Ana»: the time is in the text.
      const found = parseWhen(body, { now: this.now(), tz: this.tzOf(me.id) });
      if (!found) fail("¿Cuándo? Prueba «/recordar mañana a las 9 llamar a Ana».", 400, "when");
      body = found.rest;
      due = this.dueOf(me.id, found.at, null);
    } else due = this.dueOf(me.id, at, when);
    if (!body) fail("¿Qué te recuerdo?");
    this.roomFor(me.id, "remind");
    const id = randomUUID();
    this.q("INSERT INTO chat_timed(id, person, kind, due, data) VALUES(?,?,?,?,?)").run(id, me.id, "remind", due, this.chat.seal({ text: body, ...(ref || {}) }, "timed\u0000" + id));
    this.changed(me.id);
    return { ...this.timedView(this.timedRow(id)), label: whenLabel(due, { now: this.now(), tz: this.tzOf(me.id) }) };
  }
  timed(person, kind) {
    const me = this.chat.must(person);
    const tz = this.tzOf(me.id), now = this.now();
    return { items: this.q("SELECT * FROM chat_timed WHERE person=? AND kind=? ORDER BY due").all(me.id, kind).map((r) => ({ ...this.timedView(r), label: whenLabel(r.due, { now, tz }) })) };
  }
  mine(person, id) {
    const me = this.chat.must(person);
    const r = this.timedRow(id);
    if (!r || r.person !== me.id) fail("Ya no existe.", 404, "timed");
    return r;
  }
  editTimed(person, id, { text = null, at = null, when = null } = {}) {
    const r = this.mine(person, id);
    const d = this.chat.open(r.data, "timed\u0000" + r.id);
    if (text != null) {
      const clean = r.kind === "send" ? this.chat.cleanText(text).trim() : line(text, 1000);
      if (!clean) fail("Escribe el mensaje.");
      d.text = clean;
    }
    const due = at != null || when ? this.dueOf(r.person, at, when) : r.due;
    this.q("UPDATE chat_timed SET due=?, data=? WHERE id=?").run(due, this.chat.seal(d, "timed\u0000" + r.id), r.id);
    this.changed(r.person);
    return { ...this.timedView(this.timedRow(id)), label: whenLabel(due, { now: this.now(), tz: this.tzOf(r.person) }) };
  }
  cancelTimed(person, id) {
    const r = this.mine(person, id);
    this.q("DELETE FROM chat_timed WHERE id=?").run(r.id);
    this.changed(r.person);
    return { ok: true };
  }
  async sendNow(person, id) {
    const r = this.mine(person, id);
    if (r.kind !== "send") fail("Eso no es un mensaje programado.");
    return this.fire(r);
  }
  changed(personId) { this.chat.emit({ type: "chat.timed" }, { people: [personId] }); }
  /** When the next one is due (the workspace's alarm), or null. */
  nextAt() { return this.q("SELECT min(due) AS at FROM chat_timed").get()?.at ?? null; }
  /** Sends what is due (Workspace#alarm), each as its person. */
  async due(at = this.now()) {
    for (const r of this.q("SELECT * FROM chat_timed WHERE due<=? ORDER BY due LIMIT 50").all(at)) {
      try { await this.fire(r); } catch (error) { this.log("timed: " + (error?.message || error)); }
    }
  }
  async fire(r) {
    this.q("DELETE FROM chat_timed WHERE id=?").run(r.id);
    this.changed(r.person);
    const d = this.chat.open(r.data, "timed\u0000" + r.id);
    const member = this.chat.member(r.person);
    if (!member) return null;
    const person = { id: member.id, name: member.name, email: member.email, role: member.role };
    // A bot's follow-up: its conversation goes on as the person it works for (channel-bots.mjs).
    if (r.kind === "followup") return this.runAs(person, () => this.onFollowup?.(d));
    // Your own conversation only when something has to reach you there.
    const self = () => this.chat.selfDm(member.id);
    if (r.kind === "remind") {
      const view = this.chat.postBot(self().id, { botId: "colmena", botName: "Colmena", text: "⏰ Recordatorio: " + d.text, extra: d.message ? { ref: { channel: d.channel, message: d.message, thread: d.thread || null } } : null });
      return { message: view };
    }
    try {
      return this.runAs(person, () => this.chat.post(person, d.channel, { text: d.text, thread: d.thread || null, alsoChannel: !!d.alsoChannel }));
    } catch (error) {
      // Left the channel, archived, thread gone: the text is not lost, it comes back to you.
      const where = this.chat.row(d.channel) ? this.chat.meta(this.chat.row(d.channel)).name : null;
      this.chat.postBot(self().id, { botId: "colmena", botName: "Colmena", text: `No pude enviar tu mensaje programado${where ? " a #" + where : ""}: ${error?.message || "algo falló"}\n\nEra este:\n${this.plainText(d.text)}`.trim() });
      return null;
    }
  }
}

export { CHAT_LIMITS };
