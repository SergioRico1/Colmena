// Bots in channels (docs/CLOUD.md › Phase 3). A person names a bot in a channel or a thread
// (<@bot:nora>); the bot answers in that message's thread. Behind each thread there is one
// conversation of the runtime (a mission with `channelThread`), so a thread keeps its context
// and later replies in it go on with the same bots, named again or not. Several bots named at
// once work as a team: Atlas plans and each one does its part.
//
// - Whose account: the person who wrote (the runtime's launch runs as them: host.mjs).
// - Who sees the work: a public channel's conversation is the company's; a private channel's,
//   a group's or a direct message's has the channel's people as its audience.
// - Guests never start bot work (they can read what bots said).
import { plainText } from "./chat.mjs";
import { now } from "../store.mjs";

const BOT_MENTION = /<@bot:([a-z0-9_-]{1,40})>/g;
const ANSWER_KINDS = new Set(["message"]);

export class ChannelBots {
  constructor({ store, runtime, chat, canUse = () => true, log = () => {} }) {
    Object.assign(this, { store, runtime, chat, canUse, log });
    this.listener = (change) => this.onRecord(change);
    store.listeners.add(this.listener);
  }
  stop() { this.store.listeners.delete(this.listener); }
  /** Bots that may be named: enabled, for the team (not a personal bot). */
  list() {
    return this.store.list("bots").filter((b) => b.enabled !== false && b.audience !== "yo").map((b) => ({ id: b.id, name: b.name || b.id, title: b.role || b.title || "" }));
  }
  named(text) {
    const known = new Set(this.list().map((b) => b.id));
    return [...new Set([...String(text || "").matchAll(BOT_MENTION)].map((m) => m[1]))].filter((id) => known.has(id));
  }
  missionFor(key) {
    return this.store.list("missions").find((m) => m.channelThread?.key === key && m.status !== "cancelled") || null;
  }
  /** After a person's message (TeamChat#onPost): the bots it names, or the thread's bots, get to work. */
  onPost(person, view, row) {
    if (!person?.id || person.role === "guest" || !this.canUse(person)) return null;
    const root = view.threadId || view.id;
    const key = row.id + ":" + root;
    const existing = this.missionFor(key);
    const bots = this.named(view.text);
    if (!bots.length && !existing) return null;
    const names = new Map(this.list().map((b) => ["bot:" + b.id, b.name]));
    const text = plainText(String(view.text).replace(BOT_MENTION, (m, id) => (bots.length === 1 && id === bots[0] ? "" : m)), (id) => names.get(id) || this.chat.member(id)?.name || null, (id) => { const r = this.chat.row(id); return r ? this.chat.meta(r)?.name || null : null; }).trim() || "Hola";
    if (existing) {
      const extra = bots.filter((b) => !existing.botIds.includes(b) && b !== "atlas");
      if (extra.length && existing.mode !== "solo") this.store.patch("missions", existing.id, { botIds: [...existing.botIds, ...extra].slice(0, 4) });
      this.runtime.addMessage(existing.id, text);
      return existing.id;
    }
    const team = bots.filter((b) => b !== "atlas");
    const mode = team.length > 1 || (bots.includes("atlas") && team.length) ? "equipo" : "solo";
    const botIds = mode === "solo" ? [bots[0]] : team.slice(0, 4);
    const audience = row.kind === "public" ? null : this.chat.memberIds(row.id);
    const mission = this.runtime.create({ prompt: text, mode, botIds, conversation: mode === "solo", kind: mode === "solo" ? "chat" : null });
    this.store.patch("missions", mission.id, {
      channelThread: { key, channel: row.id, root, at: now() }, ...(audience ? { audience } : {}),
      createdBy: person.id, askedBy: person.id,
    });
    void Promise.resolve(this.runtime.launch(mission.id)).catch((error) => this.log("bot turn: " + (error?.message || error)));
    return mission.id;
  }
  /** A bot's answer (a message of the conversation behind a thread) goes to that thread. */
  onRecord(change) {
    if (change?.type !== "record" || change.kind !== "messages" || change.op !== "insert") return;
    const m = change.data;
    if (m?.role !== "assistant" || !ANSWER_KINDS.has(m.kind) || !m.botId || !m.text) return;
    const mission = this.store.get("missions", m.missionId);
    const link = mission?.channelThread;
    if (!link) return;
    const bot = this.store.get("bots", m.botId);
    try {
      this.chat.postBot(link.channel, { botId: m.botId, botName: bot?.name || m.botId, text: m.text, thread: link.root });
    } catch (error) {
      this.log("bot answer: " + (error?.message || error));
    }
  }
  /** A line in the thread when a bot's work waits on someone (an approval): who decides, where. */
  notePending(missionId, text) {
    const link = this.store.get("missions", missionId)?.channelThread;
    if (!link) return;
    try { this.chat.postBot(link.channel, { botId: "colmena", botName: "Colmena", text, thread: link.root }); } catch {}
  }
}
