// Bots working in rooms with other people (docs/PLAN-equipo-y-salas.md §4.3, docs/PEOPLE.md ›
// «Bots trabajando en salas compartidas», docs/ROOMS-CONTRACT.md › «Bots in shared rooms as built»).
//
// 1. What another person asks one of YOUR bots. Someone in a room names your bot («@Vera …»,
//    picked, so the message says whose bot it is). Your rule for that person decides
//    (Ajustes › Personas › «Encargos a tus bots»: Pregúntame, Siempre, Nunca — `asks.encargos`
//    on their contact, kept per address, teammates included):
//      Nunca      → nothing with tools (bots.mjs may still answer the mention without any);
//      Pregúntame → a card for you («Lucía pide a Vera: "…"»), an ordinary pending approval of
//                   kind «question» with `roomRequest`; the others see «Vera espera el OK de Sergio»;
//      Siempre / approved → a REAL turn of your bot in the room's sala, with tools, but:
//        · the request is never your word (`author`: outside content, no send guard, no notes,
//          no blocks; red lines ask YOU, whoever asked);
//        · that turn — and whoever it hands on to — works under the capabilities you allow for
//          other people's requests (Ajustes › Personas › Encargos: web, carpetas, apps,
//          ordenador), never more than the bot has (`step.capabilities`, Runtime#turnMission).
// 2. What the others see of your bot's work. ONLY: its final answer (server/room.mjs relay), a
//    status (`room.status`: an enumerated state and, when it ends, how many tools and how long —
//    numbers, never words), a hand-off between two bots of yours (`room.handoff`: two bot ids)
//    and the deliverables it made for a request you allowed (server/peers/files.mjs). Names are
//    never sent with a status: whoever reads it puts the name the owner announced for that bot.
// 3. What you see of theirs: the latest status of each (room, owner, bot), which goes stale by
//    itself (a bot that «works» is refreshed by its owner's Colmena; with no news it is dropped,
//    or shown as «Sergio no está» when its owner went offline), and lines in the conversation.
import { createHash, randomUUID } from "node:crypto";
import { now } from "./store.mjs";
import { isAutomated } from "./origin.mjs";
import { ERRAND_LIMITS, ERRAND_TOOLS_DEFAULT } from "./peers/errands.mjs";
import { cleanBot } from "./peers/service.mjs";

/** Every state a status can say. Nothing else travels, and nothing else is accepted. */
export const ROOM_STATES = Object.freeze(["thinking", "working", "waiting", "limited", "done", "declined", "stopped", "failed", "throttled"]);
/** Refreshed by the owner's Colmena while the step runs; stale without news. */
const LIVE = new Set(["thinking", "working"]);
/** Hold until something else is said (the owner decides, the plan renews). */
const HELD = new Set(["waiting", "limited"]);
/** Said once: a line in the conversation, and the status for a short while. */
const ENDED = new Set(["done", "declined", "stopped", "failed", "throttled"]);
// How much other people's requests may make your computer work. Every request that reaches your
// rule is a `roomAsks` record with the moment it came (`t`), so the counts hold across a restart.
//  · perHour 6: one person in one room. A person working with your bot asks a handful of things
//    an hour; more is a loop or abuse.
//  · personHour 12, personDay 40: the same person over ALL rooms (two busy rooms an hour, a long
//    working day), so being in many rooms with you is not worth more.
//  · allHour 30: everybody together. Each request is a model turn on YOUR plan: 30 an hour is one
//    every two minutes, more than a team of 32 needs and far below what would use up a plan.
//  · open 5: cards of one person waiting for your answer at once («Pregúntame»). A sixth says
//    nothing new to you; they are told your bot is not taking more for now.
//  · replies 3: turns a request may start after its own (answers to ask_room), one per question.
// A request in a room somebody else made, where you have never taken part, asks you whatever
// your rule says (RoomWork#takesPart): being put in a room is not agreeing to work in it.
export const ROOM_WORK = Object.freeze({
  perHour: ERRAND_LIMITS.perHour, // requests of one person in one room that reach your bots, per hour
  personHour: 12, personDay: 40, // requests of one person in all rooms, per hour and per day
  allHour: 30, // requests of everybody, per hour
  open: 5, // requests of one person waiting for your OK at the same time
  throttledMs: 3600000, // «no atiende más peticiones por ahora» is said once in this long per person and room
  text: 4000, // characters of a request
  question: 2000, questions: 3, replies: 3, // ask_room: characters, how many per request, and how many answers start a turn
  replyMs: 10 * 60000, // how long an unlinked message of the requester counts as the reply to ask_room
  liveMs: 90000, // «thinking» / «working» without a refresh
  refreshMs: 30000, // how often the owner's Colmena refreshes them
  endedMs: 120000, // how long an ended status stays as the bot's status
  heldMs: 7 * 864e5, // «waiting» / «limited» with no news at all
  awayMs: 12 * 3600000, // «Sergio no está; Vera seguirá cuando vuelva»
  handoffMs: 60000, // the same two bots are said to hand over once in this long
  lines: 400, // lines kept per room
  tools: 100000, ms: 30 * 864e5, // the most a summary may say
});
export const ROOM_REQUEST_TOOL = "room_request";
const BOT_ID = /^[a-z0-9-]{1,40}$/;
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const first = (name) => String(name || "").trim().split(/\s+/)[0] || "Alguien";
const iso = (ms) => new Date(ms).toISOString();

/**
 * A status as it may travel and as it is accepted: {bot, state, at} and, for «done», {tools, ms}.
 * Built field by field from an enumeration and numbers: there is no place for a tool's name, an
 * argument, a path, an address or any other text of the owner's computer.
 */
export function cleanStatus(body, clock = Date.now()) {
  if (!body || typeof body !== "object" || typeof body.bot !== "string" || !BOT_ID.test(body.bot) || !ROOM_STATES.includes(body.state)) return null;
  if (!Number.isSafeInteger(body.at) || body.at <= 0 || body.at > clock + 300000) return null;
  const out = { bot: body.bot, state: body.state, at: body.at };
  if (body.state === "done") {
    const int = (v, max) => (Number.isSafeInteger(v) && v >= 0 ? Math.min(v, max) : 0);
    out.tools = int(body.tools, ROOM_WORK.tools);
    out.ms = int(body.ms, ROOM_WORK.ms);
  }
  return out;
}
/** A hand-off as it travels: two bot ids of the same owner and when. */
export function cleanHandoff(body, clock = Date.now()) {
  if (!body || typeof body.from !== "string" || typeof body.to !== "string" || !BOT_ID.test(body.from) || !BOT_ID.test(body.to) || body.from === body.to) return null;
  if (!Number.isSafeInteger(body.at) || body.at <= 0 || body.at > clock + 300000) return null;
  return { from: body.from, to: body.to, at: body.at };
}
const minutes = (ms) => (ms < 60000 ? "menos de 1 min" : ms < 3600000 ? Math.round(ms / 60000) + " min" : Math.floor(ms / 3600000) + " h " + Math.round((ms % 3600000) / 60000) + " min");
/** The sentence of a status, written HERE from the state and the names this Colmena has. */
export function statusText(state, { bot, owner, you = false, tools = 0, ms = 0 }) {
  const o = first(owner);
  switch (state) {
    case "thinking": return bot + " está pensando";
    case "working": return bot + " está trabajando";
    case "waiting": return you ? bot + " espera tu OK" : bot + " espera el OK de " + o;
    case "limited": return bot + " está en pausa: límite " + (you ? "de tu plan" : "del plan de " + o);
    case "done": return bot + " usó " + (tools === 1 ? "1 herramienta" : tools + " herramientas") + " · " + minutes(ms);
    case "declined": return you ? "Has dicho que ahora no" : o + " ha dicho que ahora no";
    case "stopped": return you ? "Has parado a " + bot : o + " ha parado a " + bot;
    case "failed": return bot + " no ha podido terminarlo";
    case "throttled": return bot + " no atiende más peticiones por ahora";
    case "away": return o + " no está; " + bot + " seguirá cuando vuelva";
    default: return bot;
  }
}

export class RoomWork {
  constructor(rooms) {
    this.rooms = rooms;
    this.store = rooms.store;
    this.sent = new Map(); // step id → { state, shareId, botId, missionId }: what the others were last told of it
    this.fresh = new Map(); // status id → when it was last heard (this Colmena's clock)
    this.told = new Map(); // status id → when a live status of yours last went out
    this.taking = new Set(); // shareIds of rooms you are known to take part in (takesPart)
    this.passed = new Map(); // shareId:a:b → when that hand-off was last said
    this.shown = new Map(); // room id → signature of the activity last announced
    this.sharing = new Set(); // deliverables on their way to a room
    this.members = new Map(); // shareId → the roster version whose people were noted (sawMembers)
    this.timer = null;
  }
  get runtime() { return this.rooms.runtime; }
  get peers() { return this.rooms.peers; }
  clock() { return this.rooms.getPeers?.()?.clock?.() ?? Date.now(); }
  log(message) { this.rooms.log(message); }
  start() {
    if (this.runtime && typeof this.runtime.toolsForStep === "function") this.runtime.stepTools = (mission, step, bot) => this.tools(mission, step, bot);
    this.timer = setInterval(() => { try { this.tick(); } catch (error) { this.log(error.message); } }, 10000);
    this.timer.unref?.();
    return this;
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  // ---------------------------------------------------------------- settings
  /** What a turn for another person's request may use: the errand capabilities (Ajustes › Personas). */
  capabilities() { return { ...ERRAND_TOOLS_DEFAULT, ...(this.store.get("settings", "main")?.peerErrandTools || {}) }; }
  /** Your rule for requests of that person to your bots: «pregunta» (default), «siempre» or «nunca». */
  ruleFor(address) {
    const c = this.peers?.contact(address);
    if (!c || ["removed", "blocked"].includes(c.status)) return "nunca";
    const rule = c.asks?.encargos;
    return ["siempre", "nunca"].includes(rule) ? rule : "pregunta";
  }
  setRule(address, rule) {
    const c = this.peers?.contact(address);
    if (c) this.store.patch("peerContacts", address, { asks: { ...(c.asks || {}), encargos: rule } });
  }
  nameOf(address) { return this.peers?.person(address).name || "Alguien"; }
  /**
   * When each person was first in a room, as this Colmena saw it (`roomMembers`): what they can
   * have read of it starts there, and a turn for their request is told nothing older. Someone
   * who went out and came back starts again.
   */
  sawMembers(share) {
    if (share?.kind !== "group" || this.members.get(share.id) === share.version) return;
    this.members.set(share.id, share.version);
    const known = this.store.where("roomMembers", "shareId", share.id);
    const inIt = new Set(share.members.map((m) => m.id));
    for (const r of known) if (!inIt.has(r.address)) this.store.remove("roomMembers", r.id);
    const have = new Set(known.map((r) => r.address));
    // The first time the room is seen, whoever is in it was there from the start.
    const start = known.length ? null : share.createdAt || now();
    for (const m of share.members) if (!have.has(m.id)) this.store.put("roomMembers", { id: share.id + ":" + m.id, shareId: share.id, address: m.id, since: m.addedAt || start || now() });
  }
  since(share, address) {
    this.sawMembers(share);
    return this.store.get("roomMembers", share.id + ":" + address)?.since || now();
  }

  // ---------------------------------------------------------------- 1 · a request arrives
  /**
   * Someone else named your bot in a room. True when this takes it (a card for you, a turn with
   * tools, or the hourly limit); false leaves it to bots.mjs (an answer without tools).
   */
  incoming(share, message, bot) {
    const p = this.peers;
    if (!p || !this.runtime?.addMessage || share?.kind !== "group" || !message || message.bot || message.card || message.from === p.address) return false;
    // A Colmena that knows requests marks the message (`req`); an older one's mention is answered as before.
    if (!message.req || !bot || bot.enabled === false || bot.audience === "yo") return false;
    const room = this.rooms.roomOfShare(share);
    if (!room) return false;
    // The room waits for a roster newer than the one here (Peers#newerRoster): who is in it is
    // not known for sure, so nothing is taken from anyone but its owner and whoever told us.
    if (p.rosterHeld?.(share, message.from)) return true;
    const rule = this.ruleFor(message.from);
    if (rule === "nunca") return false;
    if (this.store.where("roomAsks", "shareId", share.id).some((a) => a.peerId === message.id && a.botId === bot.id)) return true;
    // The limits (ROOM_WORK), whatever the rule: over any of them the request is not taken.
    const t = this.clock();
    if (this.overLimit(share, message.from, t)) {
      this.throttled(share, bot.id, message.from, t);
      return true;
    }
    // «Siempre» reaches the rooms you take part in. In one somebody else made and where you have
    // done nothing yet, the request asks you (as «Pregúntame»).
    const held = rule === "siempre" && !this.takesPart(share);
    const ask = this.store.put("roomAsks", {
      id: randomUUID(), roomId: room.id, shareId: share.id, from: message.from, fromName: this.nameOf(message.from), botId: bot.id, peerId: message.id,
      text: String(message.text || "").slice(0, ROOM_WORK.text), ...(message.thread ? { peerThread: message.thread } : {}), rule: held ? "pregunta" : rule, ...(held ? { held: true } : {}), state: "asked", at: now(), t,
    });
    if (rule === "siempre" && !held) this.begin(ask.id, { attended: false });
    else this.askOwner(ask, room, share, bot);
    return true;
  }
  /**
   * Which limit a new request of `from` in `share` would pass, or null: «room» (that person in
   * that room this hour), «person» (that person in all rooms, this hour or today), «open» (their
   * requests already waiting for you) or «all» (everybody this hour). Read from the requests
   * kept (`roomAsks`), so a restart forgets nothing.
   */
  overLimit(share, from, t = this.clock()) {
    const HOUR = 3600000, DAY = 24 * HOUR;
    const when = (a) => (Number.isFinite(a.t) ? a.t : Date.parse(a.at) || 0);
    const within = (list, ms) => list.filter((a) => t - when(a) < ms).length;
    const theirs = this.store.where("roomAsks", "from", from);
    if (within(theirs.filter((a) => a.shareId === share.id), HOUR) >= ROOM_WORK.perHour) return "room";
    if (within(theirs, HOUR) >= ROOM_WORK.personHour || within(theirs, DAY) >= ROOM_WORK.personDay) return "person";
    if (theirs.filter((a) => a.state === "asked").length >= ROOM_WORK.open) return "open";
    return within(this.store.list("roomAsks"), HOUR) >= ROOM_WORK.allHour ? "all" : null;
  }
  /**
   * Whether you take part in a room: you made it, it is the «general» of a team you joined, you
   * wrote in it yourself, or you already said yes by hand to a request there. Nobody accepts a
   * room in Colmena (its owner puts you in), so this is what stands for it.
   */
  takesPart(share) {
    const p = this.peers;
    if (!p || share.owner === p.address || share.general || this.taking.has(share.id)) return true;
    const yes = this.store.where("roomAsks", "shareId", share.id).some((a) => a.attended)
      || this.store.where("peerMessages", "shareId", share.id).some((m) => m.from === p.address && !m.bot && !m.local && !m.card);
    if (yes) this.taking.add(share.id);
    return yes;
  }
  /** «Pregúntame»: a card that waits for you, and a neutral line for everyone else. */
  askOwner(ask, room, share, bot) {
    const who = first(ask.fromName);
    const title = clip(who + " pide a " + bot.name + ": «" + clip(ask.text, 100) + "»", 140);
    const approvalId = "roomask:" + ask.id;
    this.store.put("approvals", {
      id: approvalId, missionId: room.missionId || null, roomId: room.id, botId: bot.id, stepId: null, callId: null, tool: ROOM_REQUEST_TOOL, kind: "question",
      title, summary: who + " pide a " + bot.name + " en «" + share.title + "»:\n\n" + ask.text, context: bot.name + " · " + share.title, blocks: 1,
      options: [{ id: "go", label: "Adelante", primary: true }, { id: "later", label: "Ahora no" }, { id: "always", label: "Siempre para " + who }, { id: "never", label: "Nunca para " + who }],
      email: null, canAlways: false, status: "pending", createdAt: now(), decidedAt: null, decidedBy: null, resolution: null,
      roomRequest: { id: ask.id, roomId: room.id, shareId: share.id, from: { address: ask.from, name: ask.fromName }, bot: { id: bot.id, name: bot.name }, peerId: ask.peerId },
    });
    this.store.patch("roomAsks", ask.id, { approvalId });
    this.say(share, bot.id, "waiting");
    try {
      this.peers.notifier?.notify({ kind: "needs", title: who + " pide algo a " + bot.name, text: clip(ask.text, 200), url: this.rooms.view(room).href, extra: { roomId: room.id, approvalId, peerShare: share.id } });
    } catch (error) { this.log("No se pudo avisar: " + error.message); }
    this.announce(room);
  }
  /** Your answer to the card (Runtime#answer / dismiss): go on, not now, always or never for that person. */
  decided(a) {
    const ask = this.store.get("roomAsks", a.roomRequest?.id || "");
    this.store.patch("approvals", a.id, { roomHandled: true });
    if (!ask || ask.state !== "asked") return;
    const picked = a.status === "answered" ? a.answer?.optionId : "later";
    if (picked === "always") this.setRule(ask.from, "siempre");
    if (picked === "never") this.setRule(ask.from, "nunca");
    if (picked === "go" || picked === "always") return void this.begin(ask.id, { attended: true });
    this.end(ask.id, "declined");
    const share = this.store.get("peerShares", ask.shareId);
    if (share) this.say(share, ask.botId, "declined");
    const room = this.rooms.ofShare(ask.shareId);
    if (room) this.announce(room);
  }
  /** Decide a request from the room itself (POST /api/rooms/:id/asks/:ask). */
  decide(roomId, askId, decision) {
    const ask = this.store.get("roomAsks", String(askId));
    const fail = (message, status) => Object.assign(Error(message), { status });
    if (!ask || ask.roomId !== roomId) throw fail("No existe esa petición.", 404);
    if (ask.state !== "asked" || !ask.approvalId || this.store.get("approvals", ask.approvalId)?.status !== "pending") throw fail("Esa petición ya está decidida.", 409);
    if (!["go", "later", "always", "never"].includes(decision)) throw fail("Decisión no válida.", 400);
    this.runtime.answer(ask.approvalId, { optionId: decision });
    return this.askView(this.store.get("roomAsks", ask.id));
  }
  end(askId, state, extra = {}) {
    const ask = this.store.get("roomAsks", askId);
    return ask ? this.store.patch("roomAsks", askId, { state, endedAt: now(), ...extra }) : null;
  }
  askView(a) {
    const bot = cleanBot(this.store.get("bots", a.botId));
    return {
      id: a.id, roomId: a.roomId, from: { address: a.from, name: this.peers?.contact(a.from)?.name || a.fromName || "Alguien" }, bot: bot || { id: a.botId, name: a.botId },
      text: a.text, state: a.state, peerId: a.peerId, approvalId: a.state === "asked" ? a.approvalId || null : null, at: a.at,
    };
  }
  /** The requests of other people in a room that wait for you or are being worked on. */
  asksOf(room) {
    if (!room.shareId) return [];
    return this.store.where("roomAsks", "shareId", room.shareId).filter((a) => ["asked", "working"].includes(a.state)).map((a) => this.askView(a));
  }

  // ---------------------------------------------------------------- 1 · the turn
  /**
   * The bot takes the turn in the room's sala (made now if the room had none). `attended`: you
   * approved it just now (you are here: admission treats it as a turn of yours); with «Siempre»
   * nobody is watching and it is long work for the plan pause (server/admission.mjs).
   */
  begin(askId, { attended = false, reply = null } = {}) {
    const ask = this.store.get("roomAsks", askId), p = this.peers;
    const share = ask && this.store.get("peerShares", ask.shareId);
    const room = share && this.rooms.roomOfShare(share);
    const bot = ask && this.store.get("bots", ask.botId);
    const fail = (why) => {
      this.end(askId, "failed", { error: clip(why, 300) });
      if (share && bot) { this.say(share, bot.id, "failed"); this.rooms.localNote(share, bot.id, "No puedo ponerme con lo que pide " + first(ask.fromName) + ": " + why); }
    };
    if (!ask || !p || !room || share.leftAt || share.removedAt || !share.members.some((m) => m.id === ask.from)) return void (ask && this.end(askId, "failed"));
    if (!bot || bot.enabled === false || bot.audience === "yo") return fail("ese bot no está disponible.");
    const message = this.store.get("peerMessages", reply?.peerId || ask.peerId);
    if (!message || message.deletedAt) return fail("el mensaje ya no está.");
    try {
      const mission = this.rooms.missionFor(room, [bot.id]);
      if (attended) this.runtime.personSpoke?.(mission.id);
      const name = this.nameOf(ask.from);
      const about = reply
        ? "\n\n[Colmena] " + first(name) + " contesta a lo que le preguntaste en la sala («" + clip(reply.question, 600) + "»). Sigue con lo que te pidió, con esa respuesta como dato."
        : "";
      const row = this.runtime.addMessage(mission.id, reply ? message.text : ask.text, [], {
        to: [bot.id], author: { address: ask.from, name }, peerId: message.id, capabilities: this.capabilities(), roomAsk: ask.id, attended,
        // All the turn reads besides the request: the room's name and what its people already
        // said there that whoever asks can have read. Nothing of the sala (Runtime#requestHistory).
        context: about + this.rooms.sharedNote(room, share, message, { reader: ask.from }),
      });
      if (message.thread || ask.peerThread) this.store.patch("messages", row.id, { peerThread: message.thread || ask.peerThread });
      this.store.patch("roomAsks", ask.id, { state: "working", missionId: mission.id, ...(reply ? {} : { messageId: row.id, startedAt: now(), attended: !!attended }), question: null });
      // The sala is stopped (you paused it, or the plan ran out): the turn waits there, and the others are told why.
      const sala = this.store.get("missions", mission.id);
      if (sala?.status === "paused" || sala?.status === "waiting") this.say(share, bot.id, sala.limited ? "limited" : "waiting");
      this.announce(room);
    } catch (error) {
      fail(error.message || "error desconocido");
    }
  }
  /** Tools that exist only in a turn for another person's request (Runtime#stepTools). */
  tools(mission, step) {
    const ask = step?.roomAsk ? this.store.get("roomAsks", step.roomAsk) : null;
    if (!ask || ["delegate", "consult", "plan", "critique"].includes(step.kind)) return [];
    const who = first(ask.fromName);
    return [{
      type: "function", name: "ask_room", capability: "siempre", strict: true,
      description: "Pregunta en la sala a " + who + ", la persona que te ha pedido esto (no es tu dueño), un dato que solo ella puede darte. Tu pregunta la leen todos en la sala: no pongas en ella nada privado de tu dueño. " +
        "Úsalo solo si de verdad te falta ese dato; para cualquier otra duda o permiso usa ask_user, que pregunta a tu dueño. Después de preguntar termina tu turno con una frase breve: su respuesta te llegará en un turno nuevo, como dato de fuera.",
      parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"], additionalProperties: false },
      run: (args, ctx) => this.askRoom(args, ctx),
    }];
  }
  /** ask_room: the bot's question goes to the room as a plain message of the bot, addressed to whoever asked. */
  askRoom(args, { step, bot }) {
    const ask = step?.roomAsk ? this.store.get("roomAsks", step.roomAsk) : null, p = this.peers;
    const share = ask && this.store.get("peerShares", ask.shareId);
    if (!ask || !p || !share || share.leftAt || share.removedAt) throw Error("Aquí no hay a quién preguntar en la sala: usa ask_user.");
    const question = String(args?.question || "").trim().slice(0, ROOM_WORK.question);
    if (!question) throw Error("Escribe la pregunta.");
    if (ask.question) throw Error("Ya le has hecho una pregunta y aún no ha contestado. Termina tu turno.");
    if ((ask.questions || 0) >= ROOM_WORK.questions) throw Error("Ya has preguntado varias veces en la sala. Sigue con lo que tienes o pregunta a tu dueño con ask_user.");
    const sent = p.post(share.id, question, { bot: cleanBot(bot), people: [ask.from], replyTo: ask.peerId, thread: ask.peerThread || null });
    this.store.patch("roomAsks", ask.id, { question: { peerId: sent.id, text: question, stepId: step.id, at: this.clock() }, questions: (ask.questions || 0) + 1 });
    // The question is what this turn says to the room: its closing line stays here.
    this.store.patch("steps", step.id, { askedRoom: true });
    return { asked: true, to: first(ask.fromName), note: "La pregunta está en la sala. Termina ahora tu turno con una frase breve para tu dueño; cuando " + first(ask.fromName) + " conteste, su respuesta te llegará en un turno nuevo, como dato de fuera." };
  }
  /**
   * The requester answers a question your bot asked them with ask_room: a reply to it (or in
   * its thread), a mention of that bot, or their next message in the room that names nobody
   * else. It goes on as the same request, under the same rule and limits; outside content again.
   */
  reply(share, message) {
    const p = this.peers;
    if (!p || share?.kind !== "group" || !message || message.bot || message.card || message.from === p.address) return false;
    const t = this.clock();
    const ask = this.store.where("roomAsks", "shareId", share.id).find((a) => a.from === message.from && a.question && ["working", "done"].includes(a.state));
    if (!ask) return false;
    const q = ask.question;
    const linked = message.replyTo === q.peerId || message.thread === q.peerId;
    const named = (message.mentions || []).some((m) => m.owner === p.address && m.bot === ask.botId);
    const plain = !message.mentions?.length && !message.people?.length && !message.thread && t - q.at < ROOM_WORK.replyMs;
    if (!linked && !named && !plain) return false;
    if (this.ruleFor(message.from) === "nunca" || (p.contact(message.from)?.asks?.bots || "mencion") === "nunca") return false;
    // A reply belongs to its request (it is not counted as a new one) and has a cap of its own:
    // one turn per question, a few per request.
    if ((ask.replies || 0) >= ROOM_WORK.replies) {
      this.store.patch("roomAsks", ask.id, { question: null });
      return false;
    }
    this.store.patch("roomAsks", ask.id, { replies: (ask.replies || 0) + 1 });
    this.begin(ask.id, { attended: false, reply: { peerId: message.id, question: q.text } });
    return true;
  }

  // ---------------------------------------------------------------- 2 · what the others are told
  /** Routines and incognito conversations never say anything to a room's people. */
  silent(mission, step) {
    if (!mission || mission.incognito || mission.automationId || mission.watch) return true;
    // The message the turn answers; a teammate that was passed the word answers a bot's message:
    // followed back to what started it (a few rounds at most).
    let asked = step?.ackOn ? this.store.get("messages", step.ackOn) : null;
    for (let i = 0; i < 6 && asked && asked.role === "assistant" && asked.stepId; i++) {
      const before = this.store.get("steps", asked.stepId);
      asked = before?.ackOn && before.ackOn !== asked.id ? this.store.get("messages", before.ackOn) : null;
    }
    return isAutomated(asked);
  }
  /** How many tools a step has used: a number, all that is ever said of them. `whole`: counted over its whole conversation (when it ends). */
  toolCount(step, whole = false) {
    const calls = new Set((step.activity || []).filter((e) => e?.callId).map((e) => e.callId));
    if (whole) try { for (const x of this.runtime.history?.(step) || []) if (x?.type === "function_call" && x.call_id) calls.add(x.call_id); else if (x?.type === "web_search_call") calls.add(x.id || "search-" + calls.size); } catch {}
    return calls.size;
  }
  /** A step of one of your bots moved in a room with people (server/room.mjs stepChanged). */
  stepChanged(room, share, step, bot) {
    const was = this.sent.get(step.id)?.state || null;
    let state = null, extra = {};
    if (step.status === "running") state = this.toolCount(step) > 0 ? "working" : "thinking";
    else if (step.status === "waiting") state = "waiting";
    else if (step.status === "failed") state = "failed";
    else if (step.status === "completed") {
      if (!was) return void this.finished(room, share, step, bot);
      state = "done";
      const tools = step.skipped ? 0 : this.toolCount(step, true);
      extra = { tools, ms: Math.max(0, Math.round((step.seconds || 0) * 1000)) };
    }
    if (!state || state === was) return;
    // «thinking» never follows «working» in the same step (a round without tools after one with).
    if (state === "thinking" && was === "working") return;
    if (!was && (step.passedBy || step.kind === "work")) this.handoff(share, step.passedBy || "atlas", bot.id);
    this.sent.set(step.id, { state, shareId: share.id, botId: bot.id, missionId: step.missionId });
    if (this.sent.size > 500) this.sent.delete(this.sent.keys().next().value);
    this.say(share, bot.id, state, extra);
    if (state === "failed" && step.roomAsk && this.store.get("roomAsks", step.roomAsk)?.state === "working") { this.end(step.roomAsk, "failed"); this.announce(room); }
    if (step.status === "completed") this.finished(room, share, step, bot);
  }
  /** A turn ended: the request it answered is done once nothing of it is left. */
  finished(room, share, step) {
    if (!step.roomAsk) return;
    const ask = this.store.get("roomAsks", step.roomAsk);
    if (!ask || ask.state !== "working") return;
    const open = this.store.where("steps", "missionId", step.missionId).some((s) => s.roomAsk === ask.id && s.id !== step.id && s.status !== "completed");
    if (!open) { this.end(ask.id, "done"); this.announce(room); }
  }
  /** The sala of a room with people stopped, ran out of plan or failed: the bots that were at it say so. */
  missionChanged(m) {
    const share = this.rooms.share(this.rooms.ofMission(m.id));
    if (!share) return;
    for (const [stepId, s] of this.sent) {
      if (s.missionId !== m.id || !(LIVE.has(s.state) || s.state === "waiting")) continue;
      let state = null;
      if (m.status === "paused" && m.limited) state = "limited";
      else if (m.status === "cancelled" || (m.status === "paused" && (m.stopped?.reason === "cancelled" || m.pausedBy))) state = "stopped";
      else if (m.status === "blocked" || (m.status === "paused" && s.state !== "waiting")) state = "failed";
      else if (m.status === "completed" && this.store.get("steps", stepId)?.skipped) state = "stopped";
      if (!state) continue;
      this.sent.set(stepId, { ...s, state });
      this.say(share, s.botId, state);
      const step = this.store.get("steps", stepId);
      if (step?.roomAsk && ["stopped", "failed"].includes(state) && this.store.get("roomAsks", step.roomAsk)?.state === "working") this.end(step.roomAsk, state);
    }
  }
  /** ask_bot and message_bot between two bots of yours in a room with people: «Vera ⇄ Atlas». */
  threadChanged(entry) {
    if (!entry?.missionId || !entry.to || entry.from === "user" || !BOT_ID.test(String(entry.from)) || !BOT_ID.test(String(entry.to))) return;
    const mission = this.store.get("missions", entry.missionId);
    const share = this.rooms.share(this.rooms.ofMission(entry.missionId));
    if (!share || share.leftAt || share.removedAt || this.silent(mission, null)) return;
    this.handoff(share, entry.from, entry.to);
  }
  /**
   * A request over a limit: «Vera no atiende más peticiones por ahora», said once per person,
   * room and hour (`roomThrottled`, kept across a restart), and only to whoever asked. What
   * they send after that in the same hour gets no answer at all.
   */
  throttled(share, botId, from, t = this.clock()) {
    const id = share.id + ":" + from;
    const last = this.store.get("roomThrottled", id);
    if (last && Math.abs(t - last.t) < ROOM_WORK.throttledMs) return;
    this.store.put("roomThrottled", { id, shareId: share.id, from, t });
    this.say(share, botId, "throttled", {}, { only: from });
  }
  /**
   * Tells everyone in the room the state of one of your bots, and keeps it here too. The body is
   * made by cleanStatus: an enumerated state and numbers. Live states go out without being kept
   * anywhere (to whoever is connected); the rest wait at the mailbox until they are read.
   * `only`: it is for one person of the room and nobody else gets it.
   */
  say(share, botId, state, extra = {}, { only = null } = {}) {
    const p = this.peers;
    if (!p || !share || share.leftAt || share.removedAt) return;
    const status = cleanStatus({ bot: botId, state, at: this.clock(), ...extra }, this.clock());
    if (!status) return;
    // A turn that used no tools ends without a summary: the answer is all there is to see.
    const quiet = status.state === "done" && !status.tools;
    this.keep(share, p.address, status, { quiet });
    const body = { type: "room.status", share: share.id, ...status };
    const id = share.id + ":" + p.address + ":" + botId;
    if (LIVE.has(state)) {
      this.told.set(id, this.clock());
      // The first one reaches everybody; refreshes only whoever is connected.
      for (const to of p.others(share)) p.ephemeral(to, body, { always: true });
      return;
    }
    this.told.delete(id);
    let queued = false;
    for (const to of p.others(share)) if ((!only || to === only) && p.enqueue(to, body)) queued = true;
    if (queued) void p.flushOutbox();
  }
  /** Two bots of yours hand work to each other in a room with people: names only, once in a while. */
  handoff(share, from, to) {
    const p = this.peers;
    const line = cleanHandoff({ from, to, at: this.clock() }, this.clock());
    if (!p || !line || !this.store.get("bots", from) || !this.store.get("bots", to)) return;
    const key = share.id + ":" + [from, to].sort().join(":");
    if (this.clock() - (this.passed.get(key) || 0) < ROOM_WORK.handoffMs) return;
    this.passed.set(key, this.clock());
    if (this.passed.size > 500) this.passed.delete(this.passed.keys().next().value);
    this.line(share, { kind: "handoff", owner: p.address, bot: from, to, at: iso(line.at) });
    let queued = false;
    for (const id of p.others(share)) if (p.enqueue(id, { type: "room.handoff", share: share.id, ...line })) queued = true;
    if (queued) void p.flushOutbox();
  }
  /**
   * The deliverables a bot made in a turn for a request you allowed go to the room as files,
   * after its answer (they were made for whoever asked). Nothing else is ever shared by itself.
   */
  async deliver(share, step, bot, answerId = null) {
    const files = this.peers?.files;
    if (!files || !step?.roomAsk || step.skipped) return [];
    const ask = this.store.get("roomAsks", step.roomAsk);
    if (!ask || ask.shareId !== share.id) return [];
    const made = this.store.where("messages", "missionId", step.missionId).filter((m) => m.kind === "deliverable" && m.stepId === step.id && m.artifactId).map((m) => m.artifactId);
    const done = new Set(ask.shared || []), out = [];
    for (const artifactId of [...new Set(made)]) {
      // Claimed at once: a step is written several times as it ends, and each file goes once.
      if (done.has(artifactId) || this.sharing.has(artifactId)) continue;
      this.sharing.add(artifactId);
      try {
        const sent = await files.sendArtifact(share.id, artifactId, "", { bot: cleanBot(bot), replyTo: answerId });
        out.push(sent.message.id);
        done.add(artifactId);
        this.store.patch("roomAsks", ask.id, { shared: [...new Set([...(this.store.get("roomAsks", ask.id)?.shared || []), artifactId])] });
      } catch (error) {
        this.log("Un entregable de " + bot.name + " no pudo compartirse en la sala: " + error.message);
      } finally {
        this.sharing.delete(artifactId);
      }
    }
    return out;
  }
  /** You share a deliverable of yours with the room by hand (POST /api/rooms/:id/share). */
  async shareArtifact(roomId, artifactId, caption = "") {
    const room = this.rooms.must(roomId), p = this.rooms.needPeers();
    const fail = (message, status) => Object.assign(Error(message), { status });
    if (!room.shareId) throw fail("En esta sala solo estás tú: no hay con quién compartirlo.", 409);
    if (!p.files) throw fail("Los archivos no están disponibles.", 503);
    return p.files.sendArtifact(room.shareId, String(artifactId), String(caption || ""));
  }

  // ---------------------------------------------------------------- 3 · what is kept and shown
  /** The latest status of (room, owner, bot); an ended one also leaves a line in the conversation. */
  keep(share, owner, status, { quiet = false } = {}) {
    const id = share.id + ":" + owner + ":" + status.bot;
    const old = this.store.get("roomStatus", id);
    this.fresh.set(id, this.clock());
    if (quiet) {
      if (old) this.store.remove("roomStatus", id);
    } else if (!old || old.state !== status.state || ENDED.has(status.state)) {
      this.store.put("roomStatus", {
        id, shareId: share.id, owner, bot: status.bot, state: status.state, since: iso(Math.min(status.at, this.clock())), at: status.at,
        ...(status.state === "done" ? { tools: status.tools, ms: status.ms } : {}),
      });
    } else if (status.at > (old.at || 0)) {
      // A refresh of the same state: remembered in memory only (nothing to redraw).
      this.fresh.set(id, this.clock());
      return;
    }
    if (ENDED.has(status.state) && !quiet) this.line(share, { kind: "status", owner, bot: status.bot, state: status.state, at: iso(Math.min(status.at, this.clock())), ...(status.state === "done" ? { tools: status.tools, ms: status.ms } : {}) });
    const room = this.rooms.ofShare(share.id);
    if (room) this.announce(room);
  }
  /** A line of the conversation that is not a message: an ended status or a hand-off. */
  line(share, data) {
    const id = "line-" + createHash("sha256").update([share.id, data.kind, data.owner, data.bot, data.state || "", data.to || "", data.at].join("|")).digest("base64url").slice(0, 22);
    if (this.store.get("roomLines", id)) return null;
    const record = this.store.put("roomLines", { id, shareId: share.id, ...data });
    const all = this.store.where("roomLines", "shareId", share.id);
    if (all.length > ROOM_WORK.lines) for (const old of all.sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, all.length - ROOM_WORK.lines)) this.store.remove("roomLines", old.id);
    const p = this.peers;
    if (p) p.emit("live", { type: "room-line", shareId: share.id, roomId: this.rooms.ofShare(share.id)?.id || share.id, item: this.lineView(record) });
    return record;
  }
  /** Someone tells the state of one of their bots in a room you share. */
  onStatus(from, body) {
    const p = this.peers;
    const share = p?.memberShare(body.share, from.id);
    if (!share || share.kind !== "group") return;
    const status = cleanStatus(body, this.clock());
    if (!status) return;
    const id = share.id + ":" + from.id + ":" + status.bot;
    // Older than what is known (a replay, or two that crossed): ignored.
    const last = Math.max(this.store.get("roomStatus", id)?.at || 0, this.heard?.get(id) || 0);
    if (status.at <= last) return;
    (this.heard ??= new Map()).set(id, status.at);
    if (this.heard.size > 2000) this.heard.delete(this.heard.keys().next().value);
    this.keep(share, from.id, status, { quiet: status.state === "done" && !status.tools });
  }
  onHandoff(from, body) {
    const p = this.peers;
    const share = p?.memberShare(body.share, from.id);
    const line = cleanHandoff(body, this.clock());
    if (!share || share.kind !== "group" || !line) return;
    this.line(share, { kind: "handoff", owner: from.id, bot: line.from, to: line.to, at: iso(Math.min(line.at, this.clock())) });
  }
  botFace(owner, botId) {
    const p = this.peers;
    const known = owner === p?.address ? cleanBot(this.store.get("bots", botId)) : (p?.contact(owner)?.bots || []).map(cleanBot).find((b) => b?.id === botId);
    return known || { id: botId, name: "Un bot", role: "", color: "#8C8F99", shape: "circle" };
  }
  ownerFace(owner) {
    const p = this.peers, you = owner === p?.address;
    return { address: owner, name: you ? p.myName() : this.nameOf(owner), you };
  }
  /** What a stored status is worth now: itself, «away» (its owner went offline) or nothing (stale). */
  stateNow(s) {
    const p = this.peers, t = this.clock();
    const mine = s.owner === p?.address;
    const since = Date.parse(s.since) || 0;
    if (ENDED.has(s.state)) return t - since < ROOM_WORK.endedMs ? s.state : null;
    if (HELD.has(s.state)) return t - since < ROOM_WORK.heldMs ? s.state : null;
    if (mine) return this.sentIsLive(s) ? s.state : null;
    const heard = this.fresh.get(s.id) || 0;
    if (t - heard < ROOM_WORK.liveMs) return s.state;
    // No news: its owner's Colmena went off (the bot goes on when it is back), or it just ended unheard.
    return !p?.online(s.owner) && t - Math.max(heard, since) < ROOM_WORK.awayMs ? "away" : null;
  }
  /** A live status of your own bot holds while a step of it is really running in that room. */
  sentIsLive(s) {
    for (const x of this.sent.values()) if (x.shareId === s.shareId && x.botId === s.bot && LIVE.has(x.state)) return true;
    return false;
  }
  /** Who is at work in a room now, yours and other people's: [{owner, bot, state, since, text, tools?, ms?}]. */
  activity(room, rows = null) {
    if (!room?.shareId || !this.peers) return [];
    return (rows || this.store.where("roomStatus", "shareId", room.shareId)).map((s) => {
      const state = this.stateNow(s);
      if (!state) return null;
      const owner = this.ownerFace(s.owner), bot = this.botFace(s.owner, s.bot);
      const numbers = state === "done" ? { tools: s.tools || 0, ms: s.ms || 0 } : {};
      return { owner, bot, state, since: s.since, ...numbers, text: statusText(state, { bot: bot.name, owner: owner.name, you: owner.you, ...numbers }) };
    }).filter(Boolean).sort((a, b) => String(a.since).localeCompare(String(b.since)) || a.bot.id.localeCompare(b.bot.id));
  }
  /** Every room's activity in one read, light, for /api/state: Map(shareId → [{owner, bot, state}]). */
  activityLight() {
    const out = new Map();
    if (!this.peers) return out;
    const byShare = new Map();
    for (const s of this.store.list("roomStatus")) (byShare.get(s.shareId) || byShare.set(s.shareId, []).get(s.shareId)).push(s);
    for (const [shareId, rows] of byShare) {
      const list = this.activity({ shareId }, rows).map((a) => ({ owner: a.owner.address, bot: a.bot.id, state: a.state }));
      if (list.length) out.set(shareId, list);
    }
    return out;
  }
  lineView(l) {
    const owner = this.ownerFace(l.owner), bot = this.botFace(l.owner, l.bot);
    const base = { id: l.id, engine: "line", kind: l.kind, role: "system", at: l.at, author: { kind: "system" }, owner, bot };
    if (l.kind === "handoff") {
      const to = this.botFace(l.owner, l.to);
      return { ...base, to, text: bot.name + " ⇄ " + to.name };
    }
    const numbers = l.state === "done" ? { tools: l.tools || 0, ms: l.ms || 0 } : {};
    return { ...base, state: l.state, ...numbers, text: statusText(l.state, { bot: bot.name, owner: owner.name, you: owner.you, ...numbers }) };
  }
  /** The lines of a room between two moments (`from` inclusive, `until` exclusive; null: open). */
  lines(room, { from = null, until = null } = {}) {
    if (!room?.shareId) return [];
    return this.store.where("roomLines", "shareId", room.shareId)
      .filter((l) => (from === null || String(l.at) >= from) && (until === null || String(l.at) < until))
      .sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id)).map((l) => this.lineView(l));
  }
  /** Tells the screens that a room's activity changed (the room's own stream and /api/state). */
  announce(room) {
    const p = this.peers;
    if (!p || !room?.shareId) return;
    const activity = this.activity(room);
    const signature = JSON.stringify(activity.map((a) => [a.owner.address, a.bot.id, a.state, a.since]));
    const changed = this.shown.get(room.id) !== signature;
    this.shown.set(room.id, signature);
    p.emit("live", { type: "room-activity", shareId: room.shareId, roomId: room.id, activity });
    if (changed) p.changed();
  }
  /**
   * Every few seconds: your bots that are still at work say so again (to whoever is connected),
   * and what went stale here is dropped or turns into «no está».
   */
  tick() {
    const p = this.peers;
    if (!p) return;
    const t = this.clock();
    const rooms = new Set();
    for (const s of this.store.list("roomStatus")) {
      const state = this.stateNow(s);
      const share = this.store.get("peerShares", s.shareId);
      if (!state || !share || share.leftAt || share.removedAt) { this.store.remove("roomStatus", s.id); this.fresh.delete(s.id); rooms.add(s.shareId); continue; }
      rooms.add(s.shareId);
      if (s.owner !== p.address || !LIVE.has(s.state) || t - (this.told.get(s.id) || 0) < ROOM_WORK.refreshMs) continue;
      this.told.set(s.id, t);
      const body = { type: "room.status", share: share.id, ...cleanStatus({ bot: s.bot, state: s.state, at: t }, t) };
      for (const to of p.others(share)) p.ephemeral(to, body);
    }
    for (const shareId of rooms) {
      const room = this.rooms.ofShare(shareId);
      if (!room) continue;
      const signature = JSON.stringify(this.activity(room).map((a) => [a.owner.address, a.bot.id, a.state, a.since]));
      if (this.shown.get(room.id) !== signature) this.announce(room);
    }
  }
  /** What the store tells (server/room.mjs changed): your decision on a card, a hand-off, a sala that stopped. */
  changed({ kind, op, data }) {
    if (op === "remove" || !data) return;
    if (kind === "approvals" && data.roomRequest && data.status !== "pending" && !data.roomHandled) return this.decided(data);
    if (kind === "thread" && op === "insert") return this.threadChanged(data);
    if (kind === "missions" && this.rooms.shared.has(data.id)) return this.missionChanged(data);
  }
}
