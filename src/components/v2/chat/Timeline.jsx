import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import { flash } from "../../../lib/reveal.js";
import { createFollowScroll } from "../../../lib/followScroll.js";

// The messages of a conversation as a virtual list (T3 Code MessagesTimeline): only the rows
// on screen (and a few around them) are in the page, so a chat of thousands of messages opens
// and scrolls like a short one. It opens at the end and follows new messages while you are
// there (OpenClaw chat scroll); scrolling up stops following and, near the top, asks for the
// page before (onReachTop). Prepending a page keeps the first row you see exactly where it
// was (anchorTo «end», as T3's timelineScrollAnchoring). Each chat remembers where you left
// it and the real height of every row it measured. Following the end is not the list's job:
// src/lib/followScroll.js decides it from what the reader does (assistant-ui auto-scroll).
const AT_END_PX = 24; // within this of the end it keeps following
const places = new Map(); // listKey → { key, offset, atEnd }
const heights = new Map(); // listKey → Map(rowKey → px)

// A row repaints only when its own record changes (the parent builds stable row objects).
const Row = memo(function Row({ row, render }) {
  return render(row);
}, (a, b) => a.row === b.row);

const sameValue = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]));
const sameRow = (a, b) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => sameValue(a[k], b[k]));
};

/**
 * Keeps each row the same object while what it holds is the same (so it does not repaint),
 * and the list itself the same array while no row changed.
 */
export function useStableRows(rows) {
  const last = useRef({ byKey: new Map(), list: [] });
  const byKey = new Map();
  let changed = rows.length !== last.current.list.length;
  const list = rows.map((row, i) => {
    const old = last.current.byKey.get(row.key);
    const keep = old && sameRow(row, old) ? old : row;
    byKey.set(row.key, keep);
    if (keep !== last.current.list[i]) changed = true;
    return keep;
  });
  if (!changed) return last.current.list;
  last.current = { byKey, list };
  return list;
}

/**
 * `rows`: [{ key, ids?: [message ids in the row], … }] oldest first; `renderRow(row)` draws
 * one; `estimate(row)` guesses its height before it is measured. `handle` receives
 * { toEnd(), locate(id), rail: { at(id), jump(id) } }.
 */
export default function Timeline({ listKey, rows, renderRow, estimate, hasOlder = false, loadingOlder = false, olderError = null, onReachTop, onBelow, handle, scrollerRef, contentRef, style }) {
  const scroller = useRef(null);
  const known = useMemo(() => { if (!heights.has(listKey)) heights.set(listKey, new Map()); return heights.get(listKey); }, [listKey]);
  const getItemKey = useCallback((i) => rows[i]?.key ?? i, [rows]);
  const estimateSize = useCallback((i) => known.get(rows[i]?.key) ?? estimate(rows[i]), [rows, known, estimate]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize,
    getItemKey,
    overscan: 6,
    paddingStart: 36,
    paddingEnd: 28,
    anchorTo: "end",
    // Following is followScroll's: the list never pulls the reader to the end on its own.
    followOnAppend: false,
    scrollEndThreshold: -1,
  });
  const v = useRef(virtualizer);
  v.current = virtualizer;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // «Ir al final» shows whenever the end is out of view.
  const [atBottom, setAtBottom] = useState(true);
  const follow = useMemo(() => createFollowScroll({ onAtBottomChange: setAtBottom }), []);
  // Hidden until it has taken its place, so the first paint never jumps.
  const [placed, setPlaced] = useState(false);
  // Opens where you left this chat, or at its latest message.
  useLayoutEffect(() => {
    const el = scroller.current;
    const detach = el ? follow.attach(el) : null;
    const place = places.get(listKey);
    const list = v.current;
    const at = place && !place.atEnd ? rowsRef.current.findIndex((r) => r.key === place.key) : -1;
    const put = () => {
      if (at >= 0) { list.scrollToOffset((list.getOffsetForIndex(at, "start")?.[0] ?? 0) + place.offset); follow.hold(); }
      else follow.scrollToBottom("instant");
    };
    put();
    // The rows measure themselves in the next frames: settle there, then show.
    let f2 = 0;
    const f1 = requestAnimationFrame(() => { put(); f2 = requestAnimationFrame(() => { put(); setPlaced(true); }); });
    return () => { cancelAnimationFrame(f1); cancelAnimationFrame(f2); detach?.(); };
  }, [listKey, follow]);

  // Where you are, and the measured heights, for the next time this chat opens.
  useEffect(() => () => {
    const list = v.current;
    for (const [key, size] of list.itemSizeCache || []) known.set(key, size);
  }, [known]);
  const remember = useCallback(() => {
    const list = v.current;
    const el = scroller.current;
    const offset = el ? el.scrollTop : list.scrollOffset ?? 0;
    const item = list.getVirtualItemForOffset?.(offset);
    places.set(listKey, { key: item?.key ?? null, offset: item ? offset - item.start : 0, atEnd: el ? el.scrollHeight - el.scrollTop - el.clientHeight <= AT_END_PX : list.isAtEnd(AT_END_PX) });
    if (places.size > 100) places.delete(places.keys().next().value);
  }, [listKey]);

  // «Mensajes nuevos ↓»: something new arrived at the end while you read further up.
  const lastKey = rows[rows.length - 1]?.key ?? null;
  const prevLast = useRef(lastKey);
  const below = useRef(false);
  const [freshBelow, setFreshBelow] = useState(false);
  const setBelow = useCallback((value) => { if (below.current !== value) { below.current = value; setFreshBelow(value); onBelow?.(value); } }, [onBelow]);
  useEffect(() => {
    if (prevLast.current !== lastKey && !follow.isAtBottom) setBelow(true);
    prevLast.current = lastKey;
  }, [lastKey, setBelow, follow]);

  const items = virtualizer.getVirtualItems();
  // The page before loads when you scroll near the top (never while the chat is still taking
  // its place at the end), or at once when the loaded messages do not fill the screen.
  const paging = useRef({});
  paging.current = { can: hasOlder && !loadingOlder && !olderError, reach: onReachTop };
  const total = virtualizer.getTotalSize();
  const viewport = virtualizer.scrollRect?.height || 0;
  useEffect(() => {
    if (paging.current.can && rows.length > 1 && viewport && total <= viewport) paging.current.reach?.();
  }, [total, viewport, rows.length, hasOlder, loadingOlder, olderError]);

  // React's scroll event comes before the list updates itself: read the element, not the list.
  const onScroll = useCallback(() => {
    remember();
    const el = scroller.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= AT_END_PX * 2) setBelow(false);
    else if (paging.current.can && el.scrollTop < el.clientHeight * 1.5) paging.current.reach?.();
  }, [remember, setBelow]);

  const indexOf = useCallback((id) => rowsRef.current.findIndex((r) => r.key === id || r.ids?.includes(id)), []);
  const nodeOf = (id) => scroller.current?.querySelector(`[data-message-id="${CSS.escape(id)}"]`) || null;
  const api = useMemo(() => ({
    toEnd() {
      setBelow(false);
      places.delete(listKey);
      const el = scroller.current;
      const far = el && el.scrollHeight - el.scrollTop > el.clientHeight * 3;
      const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      follow.scrollToBottom(far || calm ? "auto" : "smooth");
    },
    // Brings a loaded message into the page; false when it is not loaded.
    locate(id) {
      const at = indexOf(id);
      if (at < 0) return false;
      if (!nodeOf(id)) v.current.scrollToIndex(at, { align: "center" });
      return true;
    },
    rail: {
      at(id) {
        const at = indexOf(id);
        const list = v.current;
        const total = list.getTotalSize();
        const m = at >= 0 ? list.measurementsCache?.[at] : null;
        return m && total ? m.start / total : null;
      },
      jump(id) {
        const at = indexOf(id);
        if (at < 0) return;
        v.current.scrollToIndex(at, { align: "center" });
        // Rows above may measure taller than guessed: settle on the real place, then light it.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const node = nodeOf(id);
          if (!node) return;
          node.scrollIntoView({ block: "center" });
          flash(node);
        }));
      },
    },
  }), [indexOf, listKey, setBelow, follow]);
  useImperativeHandle(handle, () => api, [api]);

  // A short chat sits at the bottom, by the composer (as before).
  const lift = Math.max(0, viewport - total);
  return (
    <div style={{ flex: "1", minWidth: 0, minHeight: "0", position: "relative", display: "flex" }}>
    <div ref={(el) => { scroller.current = el; if (typeof scrollerRef === "function") scrollerRef(el); else if (scrollerRef) scrollerRef.current = el; }} onScroll={onScroll} tabIndex={-1}
      style={{ flex: "1", minWidth: 0, minHeight: "0", overflowY: "auto", overscrollBehavior: "contain", overflowAnchor: "none", outline: "none", ...style }}>
      <div ref={contentRef} role="log" aria-live="off" style={{ position: "relative", width: "100%", height: total + lift + "px", visibility: placed ? "visible" : "hidden" }}>
        {loadingOlder || olderError ? (
          <div style={{ position: "absolute", top: lift + 8 + "px", left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 1 }}>
            {olderError
              ? <button type="button" onClick={() => onReachTop?.(true)} style={{ height: "32px", padding: "0 14px", border: 0, borderRadius: "999px", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.08)", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#12131A" }}>{"No se cargaron los mensajes anteriores · Reintentar"}</button>
              : <span role="status" style={{ height: "32px", display: "flex", alignItems: "center", gap: "8px", padding: "0 14px", borderRadius: "999px", background: "rgba(255,255,255,.9)", fontSize: "13px", color: "#5C606C", animation: "fade .2s ease-out" }}>
                  <span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "50%", border: "2px solid rgba(18,19,26,.15)", borderTopColor: "#12131A", animation: "spin .8s linear infinite" }} />
                  {"Cargando mensajes anteriores…"}
                </span>}
          </div>
        ) : null}
        {items.map((item) => (
          <div key={item.key} data-index={item.index} ref={virtualizer.measureElement} style={{ position: "absolute", left: 0, width: "100%", top: item.start + lift + "px" }}>
            <div style={{ width: "100%", maxWidth: "820px", margin: "0 auto", padding: "0 clamp(20px, 4vw, 44px) 26px", display: "flex", flexDirection: "column", gap: "26px" }}>
              <Row row={rows[item.index]} render={renderRow} />
            </div>
          </div>
        ))}
      </div>
    </div>
    {placed && !atBottom ? <ToEnd fresh={freshBelow} onClick={() => api.toEnd()} /> : null}
    </div>
  );
}

/** «Ir al final» over the bottom of the list; «Mensajes nuevos» when something arrived there. */
function ToEnd({ fresh, onClick }) {
  return (
    <button type="button" className="rm-focus" onClick={onClick} aria-label={fresh ? "Ir a los mensajes nuevos" : "Ir al final de la conversación"}
      style={{ position: "absolute", left: "50%", bottom: "14px", transform: "translateX(-50%)", zIndex: 5, display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: fresh ? "0 14px 0 12px" : "0", width: fresh ? "auto" : "36px", justifyContent: "center", border: 0, borderRadius: "999px", background: "#FFFFFF", color: "#12131A", boxShadow: "0 1px 2px rgba(18,19,26,.08), 0 10px 24px -12px rgba(18,19,26,.45)", cursor: "pointer", fontSize: "13px", fontWeight: 600, animation: "rise .2s ease-out" }}>
      <ArrowDown size={16} strokeWidth={2.4} aria-hidden="true" />
      {fresh ? "Mensajes nuevos" : null}
    </button>
  );
}
