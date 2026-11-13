// A room with people, read as one conversation: `GET /api/rooms/:id/timeline` (both stores
// merged by the server, paged by an opaque cursor) kept live by what changes on this computer
// (/api/events → «colmena:changed») and by what arrives from the people (/api/peers/events).
// Live text never comes through here (src/lib/liveStore.js): only records do.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get, post } from "./api.js";
import { joinItems } from "./roomView.js";

const EMPTY = { items: [], attached: [], steps: [], cursor: null, more: false };
const START = { latest: EMPTY, older: EMPTY, loading: true, error: null };

/**
 * `roomId`: the room; `shareId`: its conversation with people (null: nothing to load, the sala
 * alone reads its mission). Returns the rows (oldest first, thread replies and progress lines of
 * the sala among them), the steps of that span, who is typing or thinking, and what you can do.
 */
export function useRoomTimeline(roomId, shareId, onActivity = null) {
  const activityRef = useRef(onActivity);
  activityRef.current = onActivity;
  const on = !!(roomId && shareId);
  const [data, setData] = useState(START);
  const [typing, setTyping] = useState([]);
  const [thinking, setThinking] = useState([]);
  const path = on ? `/rooms/${encodeURIComponent(roomId)}/timeline` : null;
  const alive = useRef(true);
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const next = await get(path);
      if (!alive.current) return;
      const latest = { items: next.items || [], attached: next.attached || [], steps: next.steps || [], cursor: next.cursor || null, more: !!next.more };
      setData((d) => ({ ...d, latest, loading: false, error: null }));
    } catch (error) {
      if (alive.current) setData((d) => ({ ...d, loading: false, error: error.status === 404 ? "missing" : error.message }));
    }
  }, [path]);
  // Many records change together (a turn ends, a list arrives): one request for all of them.
  const soon = useCallback((ms = 200) => { clearTimeout(timer.current); timer.current = setTimeout(load, ms); }, [load]);

  useEffect(() => {
    alive.current = true;
    setData(START);
    setTyping([]);
    setThinking([]);
    if (!path) return undefined;
    void load();
    const onChanged = () => soon();
    const onFocus = () => soon(0);
    window.addEventListener("colmena:changed", onChanged);
    window.addEventListener("focus", onFocus);
    let typingTimer = null, thinkingTimer = null;
    const source = new EventSource(`/api/peers/events?share=${encodeURIComponent(shareId)}`);
    source.onmessage = (e) => {
      let event;
      try { event = JSON.parse(e.data); } catch { return; }
      if (event.type === "typing") {
        setTyping(event.names || []);
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => setTyping([]), 8000);
        setThinking(event.thinking || []);
        clearTimeout(thinkingTimer);
        thinkingTimer = setTimeout(() => setThinking([]), 90000);
        return;
      }
      // Another owner's bot started, stopped or waits: the room's live states, no page needed.
      if (event.type === "room-activity") { activityRef.current?.(event.activity || []); return; }
      // A line of the conversation («usó 4 herramientas · 12 min», a hand-off): into the page as it is.
      if (event.type === "room-line") {
        if (event.item?.id) setData((d) => (d.loading ? d : { ...d, latest: { ...d.latest, items: joinItems(d.latest.items, [event.item]) } }));
        return;
      }
      if (event.type === "message" && event.message?.from !== "me") setTyping((names) => names.filter((n) => n !== event.message.author?.name));
      // A message, a seen mark, a file that finished, a meeting that moved: the page again.
      soon(event.type === "message" ? 40 : 200);
    };
    // Delivery states («Enviando…» → sent) change without an event: a light refresh now and then.
    const tick = setInterval(load, 15000);
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      clearTimeout(typingTimer);
      clearTimeout(thinkingTimer);
      clearInterval(tick);
      source.close();
      window.removeEventListener("colmena:changed", onChanged);
      window.removeEventListener("focus", onFocus);
    };
  }, [path, shareId, load, soon]);

  // The page before the oldest one loaded.
  const cursor = data.older.items.length || data.older.cursor ? data.older.cursor : data.latest.cursor;
  const more = data.older.items.length ? data.older.more : data.latest.more;
  const older = useCallback(async () => {
    if (!path || !cursor) return;
    const page = await get(`${path}?cursor=${encodeURIComponent(cursor)}`);
    if (!alive.current) return;
    setData((d) => ({ ...d, older: { items: [...(page.items || []), ...d.older.items], attached: [...(page.attached || []), ...d.older.attached], steps: [...(page.steps || []), ...d.older.steps], cursor: page.cursor || null, more: !!page.more } }));
  }, [path, cursor]);

  const lastTyping = useRef(0);
  const typingNow = useCallback(() => {
    if (!shareId || Date.now() - lastTyping.current < 5000) return;
    lastTyping.current = Date.now();
    post(`/peers/shares/${encodeURIComponent(shareId)}/typing`).catch(() => {});
  }, [shareId]);

  const rows = useMemo(() => joinItems(data.older.items, data.older.attached, data.latest.items, data.latest.attached), [data.older, data.latest]);
  const top = useMemo(() => joinItems(data.older.items, data.latest.items), [data.older, data.latest]);
  const steps = useMemo(() => { const at = new Map(); for (const s of [...data.older.steps, ...data.latest.steps]) at.set(s.id, s); return [...at.values()]; }, [data.older, data.latest]);
  return { on, rows, top, steps, more: on && more, older, loading: on && data.loading, error: data.error, typing, thinking, typingNow, reload: load };
}
