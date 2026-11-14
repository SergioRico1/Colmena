// The browser's copy of team messaging (docs/CLOUD.md › Phase 2): you, the people of the company,
// your channels with their unread counts, presence and who is typing. Loaded once from
// /api/chat/bootstrap and kept current by the live socket's `chat.*` frames (lib/store.jsx hands
// them over as the "colmena:chat" window event). Screens read it with useChat(); the open channel
// listens to message frames with onChatEvent().
import { useSyncExternalStore } from "react";
import { chat } from "./api.js";
import { isCloud, sendLive } from "../lib/cloud.js";

const listeners = new Set();
const eventListeners = new Set();
let state = { ready: false, error: null, me: null, people: new Map(), bots: new Map(), ghosts: new Map(), channels: new Map(), presence: new Map(), typing: new Map(), settings: {}, push: {}, workspace: null };
let loading = null;
let openChannel = null;
let away = false;

const set = (patch) => { state = { ...state, ...patch }; for (const fn of listeners) fn(); };
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const chatState = () => state;
/** The team-messaging state (re-renders on change). */
export function useChat() {
  if (!state.ready && !loading && isCloud()) loadChat();
  return useSyncExternalStore(subscribe, chatState, chatState);
}
/** Message frames (new, changed, deleted, typing) for the screens that show messages. */
export function onChatEvent(fn) { eventListeners.add(fn); return () => eventListeners.delete(fn); }

export function loadChat({ force = false } = {}) {
  if (loading && !force) return loading;
  loading = chat.get("/bootstrap").then((b) => {
    set({
      ready: true, error: null, me: b.me, workspace: b.workspace, settings: b.settings || {}, push: b.push || {},
      people: new Map(b.people.map((p) => [p.id, p])),
      // The company's bots (Phase 3): named in text as <@bot:<id>>, they answer as author "bot:<id>".
      bots: new Map((b.bots || []).map((x) => ["bot:" + x.id, { ...x, id: "bot:" + x.id, botId: x.id, bot: true }])),
      channels: new Map(b.channels.map((c) => [c.id, c])),
      presence: new Map(b.people.filter((p) => p.presence !== "offline").map((p) => [p.id, p.presence])),
    });
    return state;
  }).catch((error) => { set({ error: error.message || "No se pudo cargar." }); loading = null; throw error; });
  return loading;
}

export const upsertChannel = (view) => { if (!view?.id) return; const channels = new Map(state.channels); channels.set(view.id, { ...(channels.get(view.id) || {}), ...view }); set({ channels }); };
export const dropChannel = (id) => { const channels = new Map(state.channels); channels.delete(id); set({ channels }); };
export const mergeGhosts = (ghosts) => {
  const entries = Object.entries(ghosts || {});
  if (!entries.length || entries.every(([id]) => state.ghosts.has(id))) return;
  const next = new Map(state.ghosts);
  for (const [id, g] of entries) next.set(id, g);
  set({ ghosts: next });
};
export const setMyProfile = (profile) => set({ me: { ...state.me, profile }, people: new Map(state.people).set(state.me.id, { ...state.people.get(state.me.id), ...profile }) });

/** Someone's display: a person of the company, or someone from an import (by their original name). */
export function personOf(id, s = state) {
  if (!id) return null;
  const p = s.people.get(id);
  if (p) return p;
  if (String(id).startsWith("bot:")) return s.bots?.get(id) || { id, name: "Bot", bot: true, botId: String(id).slice(4) };
  const g = s.ghosts.get(id);
  if (g?.person && s.people.get(g.person)) return s.people.get(g.person);
  if (g) return { id, name: g.name, title: g.title, ghost: true, bot: g.bot, color: g.color };
  return { id, name: "Alguien", ghost: true };
}
export const nameOf = (id, s = state) => (id === s.me?.id ? s.me.name : personOf(id, s)?.name || "Alguien");
/** How a channel is named: «#nombre», or the people of a direct message. */
export function channelTitle(ch, s = state) {
  if (!ch) return "";
  if (ch.kind === "dm" || ch.kind === "group") {
    const others = (ch.people || []).filter((p) => p !== s.me?.id);
    return others.length ? others.map((p) => nameOf(p, s)).join(", ") : (s.me?.name || "Tú") + " (tú)";
  }
  return ch.name || "canal";
}

/** The channel this screen has open: its frames reach it before joining, and it counts as read. */
export function setOpenChannel(id) {
  openChannel = id || null;
  sendLive({ type: "watch", channel: openChannel });
}
export const isOpenChannel = (id) => openChannel === id && document.visibilityState === "visible";

let lastTyping = 0;
/** Tells the channel's people you are typing (at most every 3 s; nothing is stored). */
export function typing(channel, thread = null) {
  const t = Date.now();
  if (t - lastTyping < 3000) return;
  lastTyping = t;
  sendLive({ type: "typing", channel, thread });
}

function onFrame(e) {
  const ev = e.detail;
  if (!ev?.type) return;
  const me = state.me?.id;
  switch (ev.type) {
    case "chat.message": {
      const ch = state.channels.get(ev.channel);
      if (ch && ev.message && (!ev.message.threadId || ev.message.broadcast)) {
        const mine = ev.message.author === me;
        const counts = mine || isOpenChannel(ev.channel) ? {} : {
          unread: Math.min(100, (ch.unread || 0) + 1),
          mentions: (ch.mentions || 0) + (ch.kind === "dm" || ch.kind === "group" || new RegExp("<@" + me + ">|<!channel>|<!everyone>|<!here>").test(ev.message.text) ? 1 : 0),
        };
        upsertChannel({ id: ev.channel, lastSeq: ev.message.seq, lastAt: ev.message.at, ...counts, ...(mine ? { readSeq: ev.message.seq } : {}) });
      }
      // Whoever wrote stops typing.
      clearTyping(ev.channel, ev.message?.author);
      break;
    }
    case "chat.read": upsertChannel({ id: ev.channel, readSeq: ev.readSeq, unread: ev.unread, mentions: ev.mentions }); break;
    case "chat.joined": upsertChannel(ev.channel); break;
    case "chat.left": dropChannel(ev.channel); break;
    case "chat.channel":
      if (ev.view && state.channels.has(ev.channel)) upsertChannel(Object.fromEntries(Object.entries(ev.view).filter(([k]) => !["readSeq", "unread", "mentions", "draft", "notify", "muted", "member"].includes(k))));
      break;
    case "chat.people": set({ people: new Map(ev.people.map((p) => [p.id, p])) }); break;
    case "chat.profile": { const p = state.people.get(ev.person); if (p) set({ people: new Map(state.people).set(ev.person, { ...p, ...ev.profile }) }); break; }
    case "chat.presence": { const presence = new Map(state.presence); if (ev.presence === "offline") presence.delete(ev.person); else presence.set(ev.person, ev.presence); set({ presence }); break; }
    case "chat.typing": {
      const typing = new Map(state.typing);
      const inChannel = new Map(typing.get(ev.channel) || []);
      inChannel.set(ev.person, { until: Date.now() + 6000, thread: ev.thread || null });
      typing.set(ev.channel, inChannel);
      set({ typing });
      setTimeout(() => clearTyping(ev.channel, ev.person, true), 6200);
      break;
    }
    default: break;
  }
  for (const fn of eventListeners) { try { fn(ev); } catch {} }
}
function clearTyping(channel, person, onlyExpired = false) {
  const inChannel = state.typing.get(channel);
  if (!inChannel?.has(person)) return;
  if (onlyExpired && inChannel.get(person).until > Date.now()) return;
  const typing = new Map(state.typing);
  const next = new Map(inChannel);
  next.delete(person);
  typing.set(channel, next);
  set({ typing });
}

// «Ausente» on its own: the tab hidden or no input for 10 minutes.
let idle = null;
function setAway(value) {
  if (away === value) return;
  away = value;
  sendLive({ type: "presence", state: value ? "away" : "active" });
}
function activity() {
  setAway(document.visibilityState !== "visible");
  clearTimeout(idle);
  idle = setTimeout(() => setAway(true), 10 * 60 * 1000);
}

if (typeof window !== "undefined" && isCloud()) {
  window.addEventListener("colmena:chat", onFrame);
  window.addEventListener("colmena:live-open", () => {
    // A new socket (after a reconnect): say again what this screen has open, and catch up.
    if (openChannel) sendLive({ type: "watch", channel: openChannel });
    if (away) sendLive({ type: "presence", state: "away" });
    if (state.ready) loadChat({ force: true }).catch(() => {});
  });
  for (const type of ["pointerdown", "keydown", "visibilitychange"]) window.addEventListener(type, activity, { passive: true });
  activity();
}
