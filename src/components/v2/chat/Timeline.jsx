import { messageListProps } from "../../../lib/messageKeys.js";
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "../../Icon.js";
import { flash } from "../../../lib/reveal.js";
import { createFollowScroll } from "../../../lib/followScroll.js";
import { NO_UNSEEN, arrivals, inView, jumpTarget, unseenAfter, unseenLabel } from "../../../lib/unseen.js";
import RowBoundary from "../../RowBoundary.jsx";

// The messages of a conversation as a virtual list (T3 Code MessagesTimeline): only the rows
// on screen (and a few around them) are in the page, so a chat of thousands of messages opens
// and scrolls like a short one. It opens at the end and follows new messages while you are
// there (OpenClaw chat scroll); scrolling up stops following and, near the top, asks for the
// page before (onReachTop). Prepending a page keeps the first row you see exactly where it
// was (anchorTo «end», as T3's timelineScrollAnchoring). Each chat remembers where you left
// it and the real height of every row it measured. Following the end is not the list's job:
// src/lib/followScroll.js decides it from what the reader does (assistant-ui auto-scroll) —
// and a long answer opens at its first line: the row `landKey` names is never pushed out of
// view while the list follows. What arrives while you are not looking at the end is counted
// and marked with a «Nuevos» divider (src/lib/unseen.js). A row that fails to draw becomes a
// muted pill (RowBoundary.jsx) and the rest of the list keeps working.
const AT_END_PX = 24; // within this of the end it keeps following
const TOP_PAD = 36; // the room over the row a jump or a landing leaves at the top
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
 * { toEnd(), locate(id), rail: { at(id), jump(id) } }. `landKey`: the key of the latest
 * answer that arrived while you were here (the one being written, then the finished one),
 * whose start stays in view, and `landTurn` what names that answer across both rows. `unseenOf(row)`: "new" for a row that counts as a new message,
 * "own" for one of yours, null for the rest.
 */
export default function Timeline({ listKey, rows, renderRow, estimate, hasOlder = false, loadingOlder = false, olderError = null, onReachTop, handle, scrollerRef, contentRef, style, landKey = null, landTurn = null, unseenOf = null }) {
  const scroller = useRef(null);
  const content = useRef(null);
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

  const indexOf = useCallback((id) => rowsRef.current.findIndex((r) => r.key === id || r.ids?.includes(id)), []);
  const rowNode = useCallback((at) => (at < 0 ? null : content.current?.querySelector(`:scope > [data-index="${at}"]`) || null), []);
  // «Ir al final» shows whenever the end is out of view.
  const [atBottom, setAtBottom] = useState(true);
  const land = useRef(null);
  land.current = { key: landKey, turn: landTurn };
  const follow = useMemo(() => createFollowScroll({
    onAtBottomChange: setAtBottom,
    pad: TOP_PAD,
    // The start of the latest answer, once its row is in the page.
    anchor: () => { const node = land.current.key ? rowNode(indexOf(land.current.key)) : null; return node ? { top: node.offsetTop, id: land.current.turn } : null; },
  }), [indexOf, rowNode]);
  // The answer being written became the finished one: it lands on its start again.
  useLayoutEffect(() => { if (landKey) follow.reland(); }, [landKey, follow]);
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

  // A short chat sits at the bottom, by the composer (as before).
  const lift = Math.max(0, viewport - total);
  const liftRef = useRef(lift);
  liftRef.current = lift;

  // «Nuevos»: what arrived while you were not looking at the end (reading further up, or
  // with the window hidden) is counted, and a divider goes before the first of it. What a
  // chat opens with, and the pages before it, are history; your own messages never count.
  const [unseen, setUnseen] = useState(NO_UNSEEN);
  const counted = useMemo(() => (unseenOf ? rows.flatMap((r) => { const kind = unseenOf(r); return kind ? [{ key: r.key, own: kind === "own" }] : []; }) : []), [rows, unseenOf]);
  const before = useRef(null);
  // Before the list follows the new content (its observers run after this).
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = counted;
    if (!prev || (prev.length === counted.length && prev[prev.length - 1]?.key === counted[counted.length - 1]?.key)) return;
    const came = arrivals(prev, counted);
    if (came === null) { setUnseen(NO_UNSEEN); return; }
    if (!came.length) return;
    const el = scroller.current;
    const shown = typeof document === "undefined" || !document.hidden;
    const view = el ? { scrollTop: el.scrollTop, clientHeight: el.clientHeight } : null;
    const marks = came.map((row) => {
      const m = v.current.measurementsCache?.[indexOf(row.key)];
      const onScreen = follow.following || (!!m && !!view && inView({ start: m.start + liftRef.current, size: m.size }, view));
      return { row, seen: shown && onScreen };
    });
    const atEnd = shown && follow.isAtBottom;
    setUnseen((state) => marks.reduce((s, { row, seen }) => unseenAfter(s, [row], { seen, atEnd }), state));
  }, [counted, follow, indexOf]);
  // The divider goes with its row; if that row is gone, so is the mark.
  const markAt = unseen.first ? rows.findIndex((r) => r.key === unseen.first) : -1;
  const read = useCallback(() => setUnseen((s) => (s.count ? NO_UNSEEN : s)), []);

  // React's scroll event comes before the list updates itself: read the element, not the list.
  const onScroll = useCallback(() => {
    remember();
    const el = scroller.current;
    if (!el) return;
    // Read: you are at the end, looking (a hidden window following the end has read nothing).
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= AT_END_PX * 2) { if (typeof document === "undefined" || !document.hidden) read(); }
    else if (paging.current.can && el.scrollTop < el.clientHeight * 1.5) paging.current.reach?.();
  }, [remember, read]);

  const nodeOf = (id) => scroller.current?.querySelector(`[data-message-id="${CSS.escape(id)}"]`) || null;
  const api = useMemo(() => ({
    toEnd() {
      read();
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
      // You asked for that message: the list lets go of the answer's start it was holding.
      if (follow.pinned) follow.hold();
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
        if (follow.pinned) follow.hold();
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
  }), [indexOf, listKey, read, follow]);
  useImperativeHandle(handle, () => api, [api]);

  // The button: to the «Nuevos» divider when the new messages do not fit a screen, else to the end.
  const jump = () => {
    const el = scroller.current;
    const m = markAt >= 0 ? v.current.measurementsCache?.[markAt] : null;
    if (!el || !m || jumpTarget({ dividerTop: m.start + lift, scrollTop: el.scrollTop, clientHeight: el.clientHeight }) !== "divider") { api.toEnd(); return; }
    const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const far = m.start + lift - el.scrollTop > el.clientHeight * 3;
    follow.hold();
    el.scrollTo({ top: Math.max(0, m.start + lift - TOP_PAD), behavior: calm || far ? "auto" : "smooth" });
    // Rows on the way may measure taller than guessed: settle on the divider itself.
    if (calm || far) requestAnimationFrame(() => requestAnimationFrame(() => { const node = rowNode(markAt); if (node) el.scrollTop = Math.max(0, node.offsetTop - TOP_PAD); }));
  };

  return (
    <div style={{ flex: "1", minWidth: 0, minHeight: "0", position: "relative", display: "flex" }}>
    <div ref={(el) => { scroller.current = el; if (typeof scrollerRef === "function") scrollerRef(el); else if (scrollerRef) scrollerRef.current = el; }} onScroll={onScroll} {...messageListProps()}
      style={{ flex: "1", minWidth: 0, minHeight: "0", overflowY: "auto", overscrollBehavior: "contain", overflowAnchor: "none", ...style }}>
      <div ref={(el) => { content.current = el; if (typeof contentRef === "function") contentRef(el); else if (contentRef) contentRef.current = el; }} role="log" aria-live="off" style={{ position: "relative", width: "100%", height: total + lift + "px", visibility: placed ? "visible" : "hidden" }}>
        {loadingOlder || olderError ? (
          <div style={{ position: "absolute", top: lift + 8 + "px", left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 1 }}>
            {olderError
              ? <button type="button" onClick={() => onReachTop?.(true)} style={{ height: "32px", padding: "0 14px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-raised)", boxShadow: "0 0 0 1px var(--c-line)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text)" }}>{"No se cargaron los mensajes anteriores · Reintentar"}</button>
              : <span role="status" style={{ height: "32px", display: "flex", alignItems: "center", gap: "8px", padding: "0 14px", borderRadius: "var(--r-pill)", background: "color-mix(in oklab, var(--c-raised) 90%, transparent)", fontSize: "var(--t-meta)", color: "var(--c-text-3)", animation: "fade .2s ease-out" }}>
                  <span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "var(--r-circle)", border: "2px solid rgb(var(--c-ink-rgb) / .15)", borderTopColor: "var(--c-text)", animation: "spin .8s linear infinite" }} />
                  {"Cargando mensajes anteriores…"}
                </span>}
          </div>
        ) : null}
        {items.map((item) => (
          <div key={item.key} data-index={item.index} data-kind={rows[item.index]?.kind || undefined} ref={virtualizer.measureElement} style={{ position: "absolute", left: 0, width: "100%", top: item.start + lift + "px" }}>
            <div style={{ width: "100%", maxWidth: "868px", margin: "0 auto", padding: "0 24px 18px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "18px" }}>
              {item.index === markAt ? <NewMark /> : null}
              <RowBoundary resetKey={rows[item.index]}><Row row={rows[item.index]} render={renderRow} /></RowBoundary>
            </div>
          </div>
        ))}
      </div>
    </div>
    {placed && !atBottom ? <ToEnd count={unseen.count} onClick={jump} /> : null}
    </div>
  );
}

/** «Nuevos»: a thin line before the first message that arrived while you were not looking. */
function NewMark() {
  const line = { flex: "1", height: "1px", background: "color-mix(in oklab, var(--c-accent) 35%, transparent)" };
  return (
    <div role="separator" aria-label="Mensajes nuevos" data-unseen-mark="" style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-accent-ink)", animation: "fade .2s ease-out" }}>
      <span style={line} />
      {"Nuevos"}
      <span style={line} />
    </div>
  );
}

/** «Ir al final» over the bottom of the list; «3 mensajes nuevos» when they arrived while you read further up. */
function ToEnd({ count, onClick }) {
  const fresh = count > 0;
  return (
    <button type="button" className="rm-focus" onClick={onClick} aria-label={fresh ? `Ir a los mensajes nuevos: ${unseenLabel(count)}` : "Ir al final de la conversación"}
      style={{ position: "absolute", left: "50%", bottom: "14px", transform: "translateX(-50%)", zIndex: 5, display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: fresh ? "0 14px 0 12px" : "0", width: fresh ? "auto" : "36px", justifyContent: "center", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-raised)", color: "var(--c-text)", boxShadow: "0 0 0 1px var(--c-line), var(--c-shadow-pop)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", animation: "rise .2s ease-out" }}>
      <ArrowDown size={16} strokeWidth={2.4} aria-hidden="true" />
      {fresh ? unseenLabel(count) : null}
    </button>
  );
}
