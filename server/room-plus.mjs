// The desktop's «para después» around conversations (the channels of hosted Colmena have the same:
// server/cloud/chat-plus.mjs): messages saved for later, reminders about a message or of your own
// («/recordar»), messages scheduled to be sent («/programar»), and the follow-ups a bot writes
// itself (room_followup). All on this computer, in the store:
//   savedMessages {id, where, messageId, text, author, at}
//   reminders     {id, where, messageId?, text, at, done}
//   scheduled     {id, where, text, at, by: "you"|botId, kind: "send"|"followup", missionId?}
// `where` is {room} (a room with people: its id), {mission} (a private room or a chat) or {share}
// (a chat with a person). The scheduler's tick calls due(): a reminder pops as a notice that
// opens the conversation; a scheduled message is sent as you; a follow-up resumes the bot.
import { randomUUID } from "node:crypto";
import { parseWhen, whenLabel } from "./cloud/when.mjs";

export class PlusError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

const clip = (s, n) => String(s || "").slice(0, n);
const MAX = { saved: 500, reminders: 200, scheduled: 200, text: 4000 };

/** The address a notice opens: the conversation, at the message when there is one. */
export function urlOf(where, messageId = null) {
  const m = messageId ? "?m=" + encodeURIComponent(messageId) : "";
  if (where?.room) return "/sala/" + encodeURIComponent(where.room) + m;
  if (where?.share) return "/con/" + encodeURIComponent(where.share) + m;
  if (where?.mission) return "/sala/" + encodeURIComponent(where.mission) + m;
  return "/chats";
}
function cleanWhere(where) {
  const w = where || {};
  if (typeof w.room === "string" && w.room) return { room: clip(w.room, 80) };
  if (typeof w.share === "string" && w.share) return { share: clip(w.share, 80) };
  if (typeof w.mission === "string" && w.mission) return { mission: clip(w.mission, 80) };
  throw new PlusError("Falta la conversación.");
}
/**
 * «mañana a las 9 llamar a Ana» or a time in ms/ISO → {at, rest}: the time to come and what is
 * left of the words once the time is taken out; or an error that says why.
 */
function whenOf({ when = null, at = null }, now = Date.now(), tz = null) {
  if (at != null) {
    const t = typeof at === "number" ? at : Date.parse(at);
    if (!Number.isFinite(t) || t <= now) throw new PlusError("Esa hora ya ha pasado.");
    if (t > now + 366 * 86400000) throw new PlusError("Como mucho, dentro de un año.");
    return { at: t, rest: null };
  }
  const found = parseWhen(String(when || ""), { now, tz });
  if (!found) throw new PlusError("No entiendo cuándo. Prueba con «en 2 horas», «mañana a las 9» o «el viernes a las 10».");
  return { at: found.at, rest: found.rest || "" };
}
/** The text without its time when both came in one sentence («/recordar mañana a las 9 …»). */
const without = (text, when, rest) => (rest != null && String(text || "").trim() === String(when || "").trim() ? rest : text);

export class RoomPlus {
  /** `send({where, text})` posts as you; `resume({missionId, botId, note})` wakes a bot; `notify(n)` pops a notice. */
  constructor({ store, send = null, resume = null, notify = null, clock = Date.now, tz = () => null }) {
    this.store = store;
    this.send = send;
    this.resume = resume;
    this.notify = notify;
    this.clock = clock;
    this.tz = tz;
  }

  // ---- saved for later
  saved() { return this.store.list("savedMessages").sort((a, b) => String(b.at).localeCompare(String(a.at))); }
  save({ where, messageId, text = "", author = "" }) {
    if (!messageId) throw new PlusError("Falta el mensaje.");
    const w = cleanWhere(where);
    const had = this.store.list("savedMessages").find((s) => s.messageId === messageId);
    if (had) return had;
    if (this.store.list("savedMessages").length >= MAX.saved) throw new PlusError("Tienes demasiados guardados: quita alguno.");
    return this.store.put("savedMessages", { id: randomUUID(), where: w, messageId: clip(messageId, 80), text: clip(text, 600), author: clip(author, 80), url: urlOf(w, messageId), at: new Date(this.clock()).toISOString() });
  }
  unsave(idOrMessage) {
    const s = this.store.get("savedMessages", idOrMessage) || this.store.list("savedMessages").find((x) => x.messageId === idOrMessage);
    if (s) this.store.remove("savedMessages", s.id);
    return { ok: true };
  }

  // ---- reminders
  reminders() { return this.store.list("reminders").filter((r) => !r.done).sort((a, b) => a.at - b.at); }
  remind({ where, messageId = null, text = "", when = null, at = null }) {
    const w = cleanWhere(where);
    const { at: time, rest } = whenOf({ when, at }, this.clock(), this.tz());
    if (this.reminders().length >= MAX.reminders) throw new PlusError("Tienes demasiados recordatorios pendientes.");
    const r = this.store.put("reminders", { id: randomUUID(), where: w, messageId: messageId ? clip(messageId, 80) : null, text: clip(without(text, when, rest), 600), at: time, done: false, url: urlOf(w, messageId), createdAt: new Date(this.clock()).toISOString() });
    return { ...r, label: whenLabel(time, { now: this.clock(), tz: this.tz() }) };
  }
  cancelReminder(id) { if (this.store.get("reminders", id)) this.store.remove("reminders", id); return { ok: true }; }

  // ---- scheduled messages and bots' follow-ups
  scheduled() { return this.store.list("scheduled").sort((a, b) => a.at - b.at); }
  schedule({ where, text, when = null, at = null }) {
    const w = cleanWhere(where);
    const { at: time, rest } = whenOf({ when, at }, this.clock(), this.tz());
    const body = clip(String(without(text, when, rest) || "").trim(), MAX.text);
    if (!body) throw new PlusError("Escribe el mensaje que quieres programar.");
    if (this.scheduled().length >= MAX.scheduled) throw new PlusError("Tienes demasiados mensajes programados.");
    const s = this.store.put("scheduled", { id: randomUUID(), kind: "send", where: w, text: body, at: time, by: "you", url: urlOf(w), createdAt: new Date(this.clock()).toISOString() });
    return { ...s, label: whenLabel(time, { now: this.clock(), tz: this.tz() }) };
  }
  /** A bot's «vuelvo a mirarlo mañana»: at that time its conversation is resumed with `note`. */
  followup({ missionId, botId, when = null, at = null, note = "" }) {
    if (!missionId || !botId) throw new PlusError("Falta la conversación.");
    const { at: time } = whenOf({ when, at }, this.clock(), this.tz());
    const mine = this.store.list("scheduled").filter((s) => s.kind === "followup" && s.missionId === missionId);
    if (mine.length >= 5) throw new PlusError("Ya tienes 5 seguimientos apuntados en esta conversación.");
    const s = this.store.put("scheduled", { id: randomUUID(), kind: "followup", where: { mission: missionId }, missionId, by: botId, text: clip(note, 600), at: time, url: urlOf({ mission: missionId }), createdAt: new Date(this.clock()).toISOString() });
    return { ...s, label: whenLabel(time, { now: this.clock(), tz: this.tz() }) };
  }
  cancelScheduled(id) { if (this.store.get("scheduled", id)) this.store.remove("scheduled", id); return { ok: true }; }
  async sendNow(id) {
    const s = this.store.get("scheduled", id);
    if (!s) throw new PlusError("Ya no está programado.", 404);
    this.store.remove("scheduled", id);
    await this.fire(s);
    return { ok: true };
  }

  /** The next time something is due (ms), or null. */
  nextAt() {
    const times = [...this.reminders().map((r) => r.at), ...this.scheduled().map((s) => s.at)];
    return times.length ? Math.min(...times) : null;
  }
  /** Fires what is due (the scheduler's tick, every few seconds). */
  async due(time = this.clock()) {
    for (const r of this.reminders().filter((x) => x.at <= time)) {
      this.store.patch("reminders", r.id, { done: true });
      this.notify?.({ kind: "reminder", title: "⏰ Recordatorio", text: r.text || "Lo que te apuntaste", url: r.url });
    }
    for (const s of this.scheduled().filter((x) => x.at <= time)) {
      this.store.remove("scheduled", s.id);
      await this.fire(s).catch(() => this.notify?.({ kind: "failed", title: "No se pudo enviar un mensaje programado", text: clip(s.text, 120), url: s.url }));
    }
  }
  async fire(s) {
    if (s.kind === "followup") return this.resume?.({ missionId: s.missionId, botId: s.by, note: s.text });
    return this.send?.({ where: s.where, text: s.text });
  }
}
