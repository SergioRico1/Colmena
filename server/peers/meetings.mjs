// Bots of different owners agree a meeting (phase 3 of «Personas», design/V2Personas.dc.html,
// paso sala/pide). It is a small protocol between Colmenas, not a chat between models:
//   organizer → each member   meet.ask   {id, share, title, minutes, from, to, dayStart, dayEnd}
//   member → organizer        meet.busy  {id, calendar, blocks} | {id, declined}
//   member → organizer        meet.vote  {id, slot}            (slot index, -1 = none fits)
//   organizer → everyone      meet.state {id, view}            (slots, votes, status)
// - Each member's Colmena decides with its owner's setting for whoever asks («Cuándo estás
//   libre»: Pregúntame / Siempre / Nunca). Code reads the calendar and sends busy blocks only
//   (start and end, 15-minute steps): never titles, places or people (calendar.mjs).
// - Busy blocks go to the organizer alone; everyone else only sees the proposed slots.
// - A slot is agreed when every member says yes to it; then each Colmena puts it in its own
//   calendar, with no guests (nobody is sent an invitation by mail).
import { randomUUID } from "node:crypto";
import { now } from "../store.mjs";
import { freeSlots } from "./calendar.mjs";

export const MEET_LIMITS = Object.freeze({ maxDays: 14, minMinutes: 15, maxMinutes: 240, asksPerHour: 6, rounds: 4 });
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** «búscanos un hueco», «una hora para vernos», «reunión de 45 minutos»… */
export function isMeetingRequest(text) {
  return /\b(reunion|reunirnos|reunamos|reunimos|vernos|veamos|quedar|quedamos|hueco|huecos|cita|llamada|videollamada|hora para|nos vemos|agendar|agenda una|cuadrar (una|la) hora)\b/.test(fold(text));
}

const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Calendar days, not 24-hour steps: a day can last 23 or 25 hours when the clocks change.
const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
/**
 * What is asked, read from the request and the last messages (newest wins): minutes, the days
 * (from, to) and the part of the day. Without a hint: 45 minutes, the next 7 days, 9 to 18.
 */
export function parseRequest(texts, nowMs = Date.now()) {
  const all = (Array.isArray(texts) ? texts : [texts]).map(fold);
  const find = (fn) => { for (const t of all) { const v = fn(t); if (v != null) return v; } return null; };
  const minutes = find((t) => {
    if (/\bmedia hora\b/.test(t)) return 30;
    if (/\b(una|1) hora y media\b/.test(t)) return 90;
    let m = /\b(\d{2,3})\s*(?:min\b|minutos|')/.exec(t);
    if (m) return Number(m[1]);
    m = /\b(\d)(?:[.,](5))?\s*(?:h\b|horas?\b)/.exec(t);
    if (m) return Number(m[1]) * 60 + (m[2] ? 30 : 0);
    if (/\buna hora\b/.test(t)) return 60;
    return null;
  }) ?? 45;
  const part = find((t) => (/\bpor las? mananas?\b|\bmananas\b|\ba primera hora\b/.test(t) ? "manana" : /\bpor las? tardes?\b|\btardes\b/.test(t) ? "tarde" : null));
  const today = startOfDay(nowMs);
  const window = find((t) => {
    const nextMonday = () => addDays(today, ((8 - new Date(today).getDay()) % 7) || 7);
    if (/\b(semana que viene|proxima semana|la otra semana)\b/.test(t)) { const mon = nextMonday(); return [mon, addDays(mon, 5)]; }
    if (/\besta semana\b/.test(t)) { const d = new Date(today).getDay(); return [nowMs, addDays(today, (6 - d + 7) % 7 || 7)]; }
    if (/\bpasado manana\b/.test(t)) return [addDays(today, 2), addDays(today, 3)];
    if (/(^|[^r] )manana\b(?! por)/.test(t) && !/\bpor las? manana/.test(t) && /\b(manana a|manana por|para manana|manana mismo|^manana|quedar manana|vernos manana|manana\?)/.test(t)) return [addDays(today, 1), addDays(today, 2)];
    if (/\bhoy\b/.test(t)) return [nowMs, addDays(today, 1)];
    return null;
  }) || [nowMs, addDays(today, 8)];
  const minutesOk = Math.min(MEET_LIMITS.maxMinutes, Math.max(MEET_LIMITS.minMinutes, Math.round(minutes / 15) * 15));
  const [dayStart, dayEnd] = part === "manana" ? ["09:00", "13:30"] : part === "tarde" ? ["15:00", "19:00"] : ["09:00", "18:00"];
  return { minutes: minutesOk, from: new Date(window[0]).toISOString(), to: new Date(Math.min(window[1], addDays(window[0], MEET_LIMITS.maxDays))).toISOString(), dayStart, dayEnd, part };
}

const cleanBlocks = (list, from, to) => (Array.isArray(list) ? list : []).slice(0, 400).map((b) => ({ s: Date.parse(b?.s), e: Date.parse(b?.e) }))
  .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > b.s && b.e > Date.parse(from) && b.s < Date.parse(to))
  .map((b) => ({ s: new Date(b.s).toISOString(), e: new Date(b.e).toISOString() }));
const cleanSlots = (list) => (Array.isArray(list) ? list : []).slice(0, 6).filter((x) => Number.isFinite(Date.parse(x?.s)) && Number.isFinite(Date.parse(x?.e))).map((x) => ({ s: new Date(Date.parse(x.s)).toISOString(), e: new Date(Date.parse(x.e)).toISOString(), ...(x.calm ? { calm: true } : {}) }));
const STATUSES = new Set(["asking", "voting", "confirmed", "nofit", "cancelled"]);

/** What everyone may see of a meeting (never anyone's busy blocks). */
export function publicMeeting(m) {
  return {
    id: m.id, shareId: m.shareId, organizer: m.organizer, bot: m.bot || null, title: m.title, minutes: m.minutes, from: m.from, to: m.to,
    dayStart: m.dayStart, dayEnd: m.dayEnd, members: m.members, answers: m.answers || {}, slots: m.slots || [], votes: m.votes || {},
    status: m.status, round: m.round || 1, confirmed: m.confirmed || null,
  };
}

export class Meetings {
  constructor({ peers, store, calendar = null, log = (m) => console.warn("[peers] " + m), clock = () => Date.now() }) {
    this.peers = peers;
    this.store = store;
    this.calendar = calendar;
    this.log = log;
    this.clock = clock;
    this.asks = new Map();
    this.onMeet = ({ from, body }) => { void this.receive(from, body).catch((e) => this.log("Reunión: " + e.message)); };
  }
  start() { this.peers.on("meet", this.onMeet); return this; }
  stop() { this.peers.off("meet", this.onMeet); }
  get me() { return this.peers.address; }
  get(id) { return this.store.get("peerMeetings", id); }
  changed(m) {
    this.peers.emit("live", { type: "meeting", shareId: m.shareId, meeting: this.view(m.id) });
    this.peers.changed();
  }
  name(address) { return address === this.me ? "Tú" : this.peers.person(address).name; }

  /** The card as this person sees it (names, my vote, what my Colmena was asked). */
  view(id) {
    const m = this.get(id);
    if (!m) return null;
    const pub = publicMeeting(m);
    const people = m.members.map((a) => ({ id: a, me: a === this.me, name: this.name(a), initials: a === this.me ? "TÚ" : this.peers.person(a).initials, color: this.peers.person(a).color, answer: (m.answers || {})[a]?.status || "waiting", vote: (m.votes || {})[a] ?? null }));
    return { ...pub, people, mine: m.organizer === this.me, myVote: (m.votes || {})[this.me] ?? null, ask: m.ask || null, created: m.created || null, organizerName: this.name(m.organizer) };
  }

  // ------------------------------------------------------------ organizer
  /** Your bot was asked in a conversation to find a time: ask every member's Colmena. */
  async begin(share, message, bot, recent = []) {
    const want = parseRequest([message.text, ...recent], this.clock());
    const others = share.members.map((x) => x.id).filter((a) => a !== this.me);
    if (!others.length) throw Error("No hay nadie más en esta conversación.");
    const names = others.map((a) => this.peers.person(a).name.split(" ")[0]);
    const title = share.kind === "group" ? "Reunión · " + share.title : "Reunión con " + names.join(" y ");
    const id = randomUUID();
    const m = this.store.put("peerMeetings", {
      id, shareId: share.id, organizer: this.me, bot, title, ...want, members: [this.me, ...others], answers: {}, blocks: {}, votes: {}, slots: [], status: "asking", round: 1, createdAt: now(),
    });
    const post = this.peers.post(share.id, `Busco ${want.minutes} minutos que os vayan bien a todos. Cada Colmena mira solo si su dueño está libre u ocupado.`, { bot, card: { kind: "meeting", id }, replyTo: message.id });
    this.store.patch("peerMeetings", id, { messageId: post.id });
    for (const a of others) this.peers.enqueue(a, { type: "meet.ask", meeting: { id, share: share.id, title, minutes: m.minutes, from: m.from, to: m.to, dayStart: m.dayStart, dayEnd: m.dayEnd, bot: bot?.name || null } });
    void this.peers.flushOutbox();
    await this.ownBusy(id);
    return this.view(id);
  }
  async ownBusy(id) {
    const m = this.get(id);
    let answer = { status: "nocal" }, blocks = [];
    try {
      const got = this.calendar ? await this.calendar.busy(m.from, m.to) : { calendar: false, blocks: [] };
      if (got.calendar) { answer = { status: "shared" }; blocks = cleanBlocks(got.blocks, m.from, m.to); }
    } catch (error) {
      answer = { status: "nocal", error: String(error.message).slice(0, 160) };
    }
    this.store.patch("peerMeetings", id, (cur) => ({ answers: { ...cur.answers, [this.me]: { ...answer, at: now() } }, blocks: { ...cur.blocks, [this.me]: blocks } }));
    this.advance(id);
  }
  /** All answered: propose slots. Everyone voted: agree, or try other slots. */
  advance(id) {
    const m = this.get(id);
    if (!m || m.organizer !== this.me) return;
    if (m.status === "asking" && m.members.every((a) => m.answers?.[a])) {
      const busy = Object.values(m.blocks || {}).flat();
      const slots = freeSlots({ from: m.from, to: m.to, dayStart: m.dayStart, dayEnd: m.dayEnd, minutes: m.minutes, busy, now: this.clock() });
      this.store.patch("peerMeetings", id, { slots, votes: {}, status: slots.length ? "voting" : "nofit" });
      return this.broadcast(id);
    }
    if (m.status === "voting" && m.members.every((a) => (m.votes || {})[a] !== undefined)) {
      const first = m.votes[m.members[0]];
      if (first >= 0 && m.members.every((a) => m.votes[a] === first) && m.slots[first]) {
        this.store.patch("peerMeetings", id, { status: "confirmed", confirmed: m.slots[first] });
        this.broadcast(id);
        return this.putInCalendar(id);
      }
      // No slot for everyone: the next ones that fit (a few rounds at most).
      const tried = [...(m.tried || []), ...m.slots];
      const busy = Object.values(m.blocks || {}).flat();
      const slots = (m.round || 1) < MEET_LIMITS.rounds ? freeSlots({ from: m.from, to: m.to, dayStart: m.dayStart, dayEnd: m.dayEnd, minutes: m.minutes, busy, exclude: tried, now: this.clock() }) : [];
      this.store.patch("peerMeetings", id, { tried, slots, votes: {}, round: (m.round || 1) + 1, status: slots.length ? "voting" : "nofit" });
      return this.broadcast(id);
    }
  }
  broadcast(id) {
    const m = this.get(id);
    for (const a of m.members) if (a !== this.me) this.peers.enqueue(a, { type: "meet.state", meeting: publicMeeting(m) });
    void this.peers.flushOutbox();
    this.changed(m);
  }
  cancel(id) {
    const m = this.get(id);
    if (!m) throw Error("No existe esa reunión.");
    if (m.organizer !== this.me) throw Error("Solo quien la propuso puede cancelarla.");
    this.store.patch("peerMeetings", id, { status: "cancelled" });
    this.broadcast(id);
    return this.view(id);
  }

  // ------------------------------------------------------------ everyone
  /** Your answer to the slots: an index, or -1 when none fits. */
  vote(id, slot) {
    const m = this.get(id);
    if (!m || m.status !== "voting") throw Error("Esta reunión ya no está votándose.");
    const k = Number(slot);
    if (!(k === -1 || (Number.isInteger(k) && m.slots[k]))) throw Error("Ese hueco no existe.");
    this.store.patch("peerMeetings", id, (cur) => ({ votes: { ...cur.votes, [this.me]: k } }));
    if (m.organizer === this.me) this.advance(id);
    else {
      this.peers.enqueue(m.organizer, { type: "meet.vote", id, slot: k, round: m.round || 1 });
      void this.peers.flushOutbox();
      this.changed(this.get(id));
    }
    return this.view(id);
  }
  /** Member: let the organizer see when you are free (only that, for this window). */
  async shareFree(id, { always = false } = {}) {
    const m = this.get(id);
    if (!m || m.organizer === this.me) throw Error("No hay ninguna petición de agenda.");
    if (always) this.peers.updateContact(m.organizer, { asks: { libre: "siempre" } });
    let body = { type: "meet.busy", id, calendar: false, blocks: [] };
    try {
      const got = this.calendar ? await this.calendar.busy(m.from, m.to) : { calendar: false, blocks: [] };
      body = { type: "meet.busy", id, calendar: !!got.calendar, blocks: cleanBlocks(got.blocks, m.from, m.to) };
    } catch (error) {
      this.log("No se pudo mirar la agenda: " + error.message);
    }
    this.peers.enqueue(m.organizer, body);
    void this.peers.flushOutbox();
    this.store.patch("peerMeetings", id, { ask: "shared" });
    this.changed(this.get(id));
    return this.view(id);
  }
  decline(id) {
    const m = this.get(id);
    if (!m || m.organizer === this.me) throw Error("No hay ninguna petición de agenda.");
    this.peers.enqueue(m.organizer, { type: "meet.busy", id, declined: true });
    void this.peers.flushOutbox();
    this.store.patch("peerMeetings", id, { ask: "declined" });
    this.changed(this.get(id));
    return this.view(id);
  }
  /** What your Colmena would send for this request: your busy blocks (shown before you say yes). */
  async preview(id) {
    const m = this.get(id);
    if (!m) throw Error("No existe esa reunión.");
    const got = this.calendar ? await this.calendar.busy(m.from, m.to) : { calendar: false, blocks: [] };
    return { calendar: !!got.calendar, blocks: cleanBlocks(got.blocks, m.from, m.to), from: m.from, to: m.to, dayStart: m.dayStart, dayEnd: m.dayEnd };
  }
  async putInCalendar(id) {
    const m = this.get(id);
    if (!m?.confirmed || m.created) return;
    this.store.patch("peerMeetings", id, { created: { status: "creating" } });
    let created = { status: "nocal" };
    try {
      const others = m.members.filter((a) => a !== this.me).map((a) => this.peers.person(a).name);
      const r = this.calendar ? await this.calendar.create({ title: m.title, start: m.confirmed.s, minutes: m.minutes, description: "Acordada en Colmena con " + others.join(", ") + "." }) : { ok: false, calendar: false };
      created = r.ok ? { status: "done" } : r.calendar === false ? { status: "nocal" } : { status: "failed", error: String(r.error || "").slice(0, 160) };
    } catch (error) {
      created = { status: "failed", error: String(error.message).slice(0, 160) };
    }
    this.store.patch("peerMeetings", id, { created: { ...created, at: now() } });
    this.changed(this.get(id));
  }

  // ------------------------------------------------------------ the wire
  async receive(contact, body) {
    const from = contact.id;
    if (body.type === "meet.ask") return this.onAsk(contact, body.meeting);
    const id = String(body.id || body.meeting?.id || "");
    const m = this.get(id);
    if (!m) return;
    if (body.type === "meet.state") {
      if (from !== m.organizer) return; // only the organizer speaks for the meeting
      const v = body.meeting || {};
      if (!STATUSES.has(v.status)) return;
      const votes = Object.fromEntries(Object.entries(v.votes || {}).filter(([a, k]) => m.members.includes(a) && Number.isInteger(k)));
      const answers = Object.fromEntries(Object.entries(v.answers || {}).filter(([a]) => m.members.includes(a)).map(([a, x]) => [a, { status: ["shared", "declined", "nocal"].includes(x?.status) ? x.status : "waiting" }]));
      this.store.patch("peerMeetings", id, { status: v.status, slots: cleanSlots(v.slots), votes, answers, round: Number(v.round) || 1, confirmed: v.status === "confirmed" ? cleanSlots([v.confirmed])[0] || null : null });
      this.changed(this.get(id));
      if (v.status === "confirmed" && (votes[this.me] ?? -1) >= 0) await this.putInCalendar(id);
      return;
    }
    if (m.organizer !== this.me || !m.members.includes(from)) return;
    if (body.type === "meet.busy") {
      if (m.status !== "asking") return;
      const answer = body.declined ? { status: "declined" } : body.calendar ? { status: "shared" } : { status: "nocal" };
      this.store.patch("peerMeetings", id, (cur) => ({ answers: { ...cur.answers, [from]: { ...answer, at: now() } }, blocks: { ...cur.blocks, [from]: body.declined ? [] : cleanBlocks(body.blocks, m.from, m.to) } }));
      return this.advance(id);
    }
    if (body.type === "meet.vote") {
      const k = Number(body.slot);
      if (m.status !== "voting" || Number(body.round || 1) !== (m.round || 1) || !(k === -1 || (Number.isInteger(k) && m.slots[k]))) return;
      this.store.patch("peerMeetings", id, (cur) => ({ votes: { ...cur.votes, [from]: k } }));
      return this.advance(id);
    }
  }
  onAsk(contact, q) {
    if (!q || typeof q.id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(q.id) || this.get(q.id)) return;
    const share = this.peers.memberShare(q.share, contact.id);
    if (!share) return;
    const from = Date.parse(q.from), to = Date.parse(q.to), minutes = Number(q.minutes);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MEET_LIMITS.maxDays * 86400000 + 3600000) return;
    if (!Number.isInteger(minutes) || minutes < MEET_LIMITS.minMinutes || minutes > MEET_LIMITS.maxMinutes || !HHMM.test(q.dayStart) || !HHMM.test(q.dayEnd)) return;
    // A few requests an hour per person at most.
    const t = this.clock(), list = (this.asks.get(contact.id) || []).filter((x) => t - x < 3600000);
    if (list.length >= MEET_LIMITS.asksPerHour) return;
    this.asks.set(contact.id, [...list, t]);
    const rule = contact.status === "active" ? contact.asks?.libre || "pregunta" : "pregunta";
    this.store.put("peerMeetings", {
      id: q.id, shareId: share.id, organizer: contact.id, bot: q.bot ? { name: String(q.bot).slice(0, 40) } : null, title: String(q.title || "Reunión").slice(0, 120), minutes,
      from: new Date(from).toISOString(), to: new Date(to).toISOString(), dayStart: q.dayStart, dayEnd: q.dayEnd,
      members: share.members.map((x) => x.id), answers: {}, votes: {}, slots: [], status: "asking", round: 1, ask: rule === "nunca" ? "declined" : rule === "siempre" ? "shared" : "pending", createdAt: now(),
    });
    if (rule === "nunca") return this.decline(q.id);
    if (rule === "siempre") return this.shareFree(q.id);
    this.changed(this.get(q.id));
    this.peers.notify({ title: contact.name + " quiere saber cuándo estás libre", text: "Para «" + String(q.title || "una reunión").slice(0, 80) + "». Solo verá libre u ocupado.", shareId: share.id });
  }
}
