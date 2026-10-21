import { useCallback, useEffect, useRef, useState } from "react";

// Message navigator for long conversations (OpenClaw chat-position-rail): a slim rail on the
// right edge with a mark per message of yours and per answer that follows it; hovering shows
// the first 140 characters, a click (or Enter) jumps there and highlights it; ↑/↓, Home/End
// move between marks. It only appears when the conversation is several screens long.
const PREVIEW = 140;

/**
 * `scroller`: ref to the scrolling element. `items`: [{id, who, text, mine}] in order.
 * `locate` (a virtual list, where most messages are not in the page): { at(id) → 0..1 or
 * null, jump(id) } places and reaches the marks from the list's own measurements.
 */
export default function PositionRail({ scroller, items, version = 0, locate = null }) {
  const [box, setBox] = useState(null); // {top, left, height}
  const [marks, setMarks] = useState([]); // [{id, at (0..1)}]
  const [active, setActive] = useState(null);
  const [hover, setHover] = useState(null);
  const refs = useRef({});
  const frame = useRef(0);
  const latest = useRef(items);
  latest.current = items;
  const key = items.map((it) => it.id).join(",");

  const measure = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el) return;
      const list = latest.current;
      const long = el.scrollHeight > el.clientHeight * 2.5;
      if (!long || list.length < 6) { setBox(null); return; }
      const r = el.getBoundingClientRect();
      const nextBox = { top: Math.round(r.top + 16), left: Math.round(r.right - 34), height: Math.round(Math.max(80, r.height - 180)) };
      // Only a real change re-renders (this runs on every scroll frame).
      setBox((b) => (b && b.top === nextBox.top && b.left === nextBox.left && b.height === nextBox.height ? b : nextBox));
      const next = [];
      for (const it of list) {
        if (locate) {
          const at = locate.at(it.id);
          if (at !== null && at !== undefined) next.push({ id: it.id, at: Math.min(1, Math.max(0, at)) });
          continue;
        }
        const node = el.querySelector(`[data-message-id="${CSS.escape(it.id)}"]`);
        if (node) next.push({ id: it.id, at: Math.min(1, Math.max(0, (node.offsetTop - el.offsetTop) / el.scrollHeight)) });
      }
      setMarks((prev) => (prev.length === next.length && prev.every((m, i) => m.id === next[i].id && Math.abs(m.at - next[i].at) < 0.001) ? prev : next));
      // The mark of the message at the middle of the screen is the current one.
      const middle = el.scrollTop + el.clientHeight / 2;
      let current = null;
      for (const m of next) {
        if (locate) { if (m.at * el.scrollHeight <= middle) current = m.id; continue; }
        const node = el.querySelector(`[data-message-id="${CSS.escape(m.id)}"]`);
        if (node && node.offsetTop - el.offsetTop <= middle) current = m.id;
      }
      setActive(current || next[0]?.id || null);
    });
  }, [scroller, key, locate]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); el.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); cancelAnimationFrame(frame.current); };
  }, [scroller, measure, version]);

  if (!box || marks.length < 6) return null;
  const jump = (id) => {
    if (locate) return locate.jump(id);
    const node = scroller.current?.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (!node) return;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    node.classList.remove("c-reveal");
    void node.offsetWidth;
    node.classList.add("c-reveal");
    setTimeout(() => node.classList.remove("c-reveal"), 1400);
  };
  const onKey = (e, i) => {
    const to = e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? marks.length - 1 : null;
    if (to !== null) {
      e.preventDefault();
      const m = marks[Math.max(0, Math.min(marks.length - 1, to))];
      refs.current[m.id]?.focus();
      setHover(m.id);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      jump(marks[i].id);
    } else if (e.key === "Escape") {
      setHover(null);
      e.currentTarget.blur();
    }
  };
  const byId = new Map(items.map((it) => [it.id, it]));
  const shown = hover ? byId.get(hover) : null;
  const shownMark = hover ? marks.find((m) => m.id === hover) : null;

  return (
    <nav aria-label="Ir a un mensaje de la conversación" onMouseLeave={() => setHover(null)}
      style={{ position: "fixed", zIndex: 6, top: box.top + "px", left: box.left + "px", width: "16px", height: box.height + "px" }}>
      <span aria-hidden="true" style={{ position: "absolute", left: "7px", top: 0, bottom: 0, width: "2px", background: "#EEF0F4", borderRadius: "1px" }} />
      {marks.map((m, i) => {
        const it = byId.get(m.id);
        const on = m.id === active;
        return (
          <button key={m.id} ref={(el) => { refs.current[m.id] = el; }} type="button" className="rm-focus"
            tabIndex={on ? 0 : -1} aria-current={on ? "true" : undefined}
            aria-label={`${it?.who || "Mensaje"}, ${i + 1} de ${marks.length}`} title=""
            onMouseEnter={() => setHover(m.id)} onFocus={() => setHover(m.id)} onBlur={() => setHover(null)}
            onClick={() => jump(m.id)} onKeyDown={(e) => onKey(e, i)}
            style={{ position: "absolute", left: "1px", top: `calc(${(m.at * 100).toFixed(2)}% - 6px)`, width: "14px", height: "12px", padding: 0, background: "transparent", border: 0, cursor: "pointer", display: "grid", placeItems: "center" }}>
            <span style={{ width: it?.mine ? "10px" : "6px", height: on ? "4px" : "3px", borderRadius: "2px", background: on ? "#12131A" : it?.mine ? "#8C91A0" : "#C9CCD6", transition: "width .12s ease, background .12s ease" }} />
          </button>
        );
      })}
      {shown && shownMark ? (
        <div role="tooltip" className="c-pop" style={{ position: "absolute", right: "22px", top: `calc(${(shownMark.at * 100).toFixed(2)}% - 18px)`, width: "260px", padding: "10px 12px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", boxShadow: "0 12px 28px -16px rgba(18,19,26,.45)", pointerEvents: "none" }}>
          <strong style={{ display: "block", fontSize: "12px", marginBottom: "3px" }}>{shown.who}</strong>
          <span style={{ fontSize: "13px", lineHeight: "1.4", color: "#2B2D36", display: "-webkit-box", WebkitLineClamp: "3", WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {String(shown.text || "").replace(/[#*_`>|[\]()]/g, "").replace(/\s+/g, " ").trim().slice(0, PREVIEW) || "…"}
          </span>
        </div>
      ) : null}
    </nav>
  );
}

/** Marks for a conversation: each of your messages and the first answer after it. */
export function railItems(messages, nameOf) {
  const out = [];
  let afterUser = false;
  for (const m of messages) {
    if (m.optimistic || m.replyTo || !m.text || (m.kind && !["message", "deliverable"].includes(m.kind))) continue;
    if (m.role === "user") { out.push({ id: m.id, who: "Tú", text: m.text, mine: true }); afterUser = true; }
    else if (m.role === "assistant" && afterUser) { out.push({ id: m.id, who: nameOf(m.botId), text: m.text, mine: false }); afterUser = false; }
  }
  return out;
}
