// «Personas» in the browser: one conversation with people (server/peers/): its messages, what
// arrives live (/api/peers/events), typing and seen marks.
import { useCallback, useEffect, useRef, useState } from "react";
import { get, post } from "./api.js";

export const shareUrl = (id) => "/con/" + id;

/** «las 18:00», «mañana a las 9:00», «el lunes 27». */
export function whenText(iso) {
  const d = new Date(iso), now = new Date();
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return "las " + time;
  if (new Date(now.getTime() + 864e5).toDateString() === d.toDateString()) return "mañana a las " + time;
  return "el " + d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" });
}
/** Someone's status in words: «No molestar · hasta las 18:00», «Fuera hasta el lunes 27». */
export function statusText(away) {
  if (!away) return null;
  if (away.mode === "dnd") return "No molestar" + (away.until ? " · hasta " + whenText(away.until) : "");
  return "Fuera" + (away.until ? " hasta " + whenText(away.until) : "");
}
export const RELAY_LABEL = {
  online: "Conectado al buzón",
  connecting: "Conectando con el buzón…",
  offline: "Sin conexión con el buzón",
  off: "Sin buzón configurado",
};

/** Messages of conversation `id`, kept live. */
export function useShareChat(id) {
  const [data, setData] = useState({ share: null, messages: [], more: false, loading: true, error: null });
  const [typing, setTyping] = useState([]);
  const [thinking, setThinking] = useState([]); // bots answering here («Vera», «Leo (de Marta)»)
  const typingTimer = useRef(null);
  const thinkingTimer = useRef(null);
  // A meeting card shows the meeting as it is now (server/peers/meetings.mjs).
  const updateMeeting = useCallback((meeting) => {
    setData((d) => ({ ...d, messages: d.messages.map((m) => (m.card?.kind === "meeting" && m.card.id === meeting.id ? { ...m, meeting } : m)) }));
  }, []);
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const next = await get(`/peers/shares/${encodeURIComponent(id)}/messages`);
      setData({ ...next, loading: false, error: null });
    } catch (error) {
      setData((d) => ({ ...d, loading: false, error: error.status === 404 ? "missing" : error.message }));
    }
  }, [id]);
  useEffect(() => {
    setData({ share: null, messages: [], more: false, loading: true, error: null });
    setTyping([]);
    setThinking([]);
    void load();
    const source = new EventSource(`/api/peers/events?share=${encodeURIComponent(id)}`);
    source.onmessage = (e) => {
      let event;
      try { event = JSON.parse(e.data); } catch { return; }
      if (event.type === "message" && event.message) {
        setData((d) => {
          const i = d.messages.findIndex((m) => m.id === event.message.id);
          const messages = i >= 0 ? d.messages.map((m, j) => (j === i ? event.message : m)) : [...d.messages, event.message].sort((a, b) => String(a.at).localeCompare(String(b.at)));
          return { ...d, messages };
        });
        if (event.message.from !== "me") setTyping((names) => names.filter((n) => n !== event.message.author?.name));
      }
      if (event.type === "typing") {
        setTyping(event.names || []);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping([]), 8000);
        setThinking(event.thinking || []);
        clearTimeout(thinkingTimer.current);
        thinkingTimer.current = setTimeout(() => setThinking([]), 90000);
      }
      if (event.type === "meeting" && event.meeting) updateMeeting(event.meeting);
      if (event.type === "seen" || event.type === "relay" || event.type === "presence") void load();
    };
    // Statuses («Enviando…» → sent) change without a live event: a light refresh now and then.
    const tick = setInterval(load, 15000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      source.close();
      clearInterval(tick);
      clearTimeout(typingTimer.current);
      clearTimeout(thinkingTimer.current);
      window.removeEventListener("focus", onFocus);
    };
  }, [id, load, updateMeeting]);
  const older = useCallback(async () => {
    const first = data.messages[0];
    if (!first) return;
    const page = await get(`/peers/shares/${encodeURIComponent(id)}/messages?before=${encodeURIComponent(first.id)}`);
    setData((d) => ({ ...d, messages: [...page.messages, ...d.messages], more: page.more }));
  }, [id, data.messages]);
  const send = useCallback(async (text, mentions = []) => {
    const message = await post(`/peers/shares/${encodeURIComponent(id)}/messages`, { text, ...(mentions.length ? { mentions } : {}) });
    setData((d) => (d.messages.some((m) => m.id === message.id) ? d : { ...d, messages: [...d.messages, message] }));
    setTimeout(load, 1200);
    return message;
  }, [id, load]);
  const lastTyping = useRef(0);
  const typingNow = useCallback(() => {
    if (Date.now() - lastTyping.current < 5000) return;
    lastTyping.current = Date.now();
    post(`/peers/shares/${encodeURIComponent(id)}/typing`).catch(() => {});
  }, [id]);
  const react = useCallback(async (messageId, emoji) => {
    const message = await post(`/peers/messages/${encodeURIComponent(messageId)}/reactions`, { emoji });
    setData((d) => ({ ...d, messages: d.messages.map((m) => (m.id === message.id ? message : m)) }));
  }, []);
  const retry = useCallback(async (messageId) => {
    const message = await post(`/peers/messages/${encodeURIComponent(messageId)}/retry`);
    setData((d) => ({ ...d, messages: d.messages.map((m) => (m.id === message.id ? message : m)) }));
  }, []);
  // What you have on screen counts as seen (only while the window is visible).
  const lastSeen = useRef(null);
  const newest = data.messages.filter((m) => m.from !== "me").at(-1)?.id || null;
  useEffect(() => {
    if (!id || data.loading) return;
    const mark = () => {
      if (document.visibilityState !== "visible") return;
      if (lastSeen.current === (newest || "none") && !data.share?.unread) return;
      lastSeen.current = newest || "none";
      post(`/peers/shares/${encodeURIComponent(id)}/seen`).catch(() => {});
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [id, newest, data.loading, data.share?.unread]);
  return { ...data, typing, thinking, load, older, send, typingNow, react, retry, updateMeeting };
}
