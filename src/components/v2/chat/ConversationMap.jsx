import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api.js";

// The map of a conversation (after assistant-ui conversation-map and shadcn's message scroller
// visibility): a slim rail on the right with one mark per message of yours — the whole chat,
// loaded pages or not. The marks on screen are darker and the one you are reading darkest;
// hovering shows what you asked and how it was answered; a click (or Enter) goes there,
// loading the earlier pages first when it is not loaded yet.

const MIN_TURNS = 4;

/** The turns of the chat, fetched again when it changes (`version`). */
function useTurns(missionId, version) {
  const [turns, setTurns] = useState([]);
  useEffect(() => {
    if (!missionId) { setTurns([]); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      api(`/missions/${encodeURIComponent(missionId)}/map`).then((d) => { if (alive) setTurns(Array.isArray(d?.turns) ? d.turns : []); }).catch(() => {});
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [missionId, version]);
  return turns;
}

/**
 * `scroller`: ref to the list's scrolling element; `ownerOf(messageId)`: the turn (your
 * message id) a loaded message belongs to; `onJump(id)`: go to that message of yours.
 */
export default function ConversationMap({ missionId, version, scroller, ownerOf, onJump }) {
  const turns = useTurns(missionId, version);
  const [box, setBox] = useState(null); // { top, left, height }
  const [active, setActive] = useState(null);
  const [visible, setVisible] = useState([]);
  const [hover, setHover] = useState(null);
  const refs = useRef({});
  const owner = useRef(ownerOf);
  owner.current = ownerOf;
  const frame = useRef(0);

  const measure = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const next = { top: Math.round(r.top + 18), left: Math.round(r.right - 30), height: Math.round(Math.max(80, r.height - 140)) };
      setBox((b) => (b && b.top === next.top && b.left === next.left && b.height === next.height ? b : next));
      // Which turns the screen holds, and which one is being read (the middle: where a jump puts it).
      const line = r.top + r.height / 2;
      const onScreen = [];
      let reading = null;
      for (const node of el.querySelectorAll("[data-message-id]")) {
        const b = node.getBoundingClientRect();
        if (b.top >= r.bottom) break;
        const turn = owner.current(node.dataset.messageId);
        if (!turn) continue;
        if (b.top <= line) reading = turn;
        if (b.bottom > r.top && !onScreen.includes(turn)) onScreen.push(turn);
      }
      setActive(reading || onScreen[0] || null);
      setVisible((prev) => (prev.length === onScreen.length && prev.every((x, i) => x === onScreen[i]) ? prev : onScreen));
    });
  }, [scroller]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); el.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); cancelAnimationFrame(frame.current); };
  }, [scroller, measure, turns.length]);

  if (!box || turns.length < MIN_TURNS) return null;
  const every = Math.max(1, Math.ceil(turns.length / Math.max(1, Math.floor(box.height / 7))));
  const dense = every > 1;
  const at = (i) => (turns.length === 1 ? 0.5 : i / (turns.length - 1));
  const go = (id) => { setHover(null); onJump(id); };
  const onKey = (e, i) => {
    const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? turns.length - 1 : null;
    if (to !== null) {
      e.preventDefault();
      const t = turns[Math.max(0, Math.min(turns.length - 1, to))];
      refs.current[t.id]?.focus();
      setHover(t.id);
    } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(turns[i].id); }
    else if (e.key === "Escape") { setHover(null); e.currentTarget.blur(); }
  };
  // The pointer picks the nearest turn, however close the marks are (hundreds of turns).
  const pointAt = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = Math.min(1, Math.max(0, (e.clientY - r.top - 6) / Math.max(1, r.height - 12)));
    const t = turns[Math.round(y * (turns.length - 1))];
    if (t && t.id !== hover) setHover(t.id);
  };
  const shownIndex = hover ? turns.findIndex((t) => t.id === hover) : -1;
  const shown = shownIndex >= 0 ? turns[shownIndex] : null;
  const focusable = active && turns.some((t) => t.id === active) ? active : turns[turns.length - 1].id;
  return (
    <nav aria-label="Mapa de la conversación" onMouseLeave={() => setHover(null)} onMouseMove={pointAt} onClick={() => { if (hover) go(hover); }}
      style={{ position: "fixed", zIndex: 6, top: box.top - 6 + "px", left: box.left + "px", width: "22px", height: box.height + 12 + "px", padding: "6px 0", boxSizing: "border-box", cursor: "pointer" }}>
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        {dense ? <span aria-hidden="true" style={{ position: "absolute", right: "0", top: 0, bottom: 0, width: "2px", borderRadius: "var(--r-xs)", background: "rgba(18,19,26,.07)" }} /> : null}
      {turns.map((t, i) => {
        const on = t.id === active;
        const seen = visible.includes(t.id);
        // Hundreds of turns: every `every`-th mark, plus the ones on screen, read or pointed at.
        const drawn = !dense || i % every === 0 || on || seen || hover === t.id;
        return (
          <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" className="rm-focus"
            tabIndex={t.id === focusable ? 0 : -1} aria-current={on ? "true" : undefined} aria-label={`Tu mensaje ${i + 1} de ${turns.length}: ${t.title}`}
            onMouseEnter={() => setHover(t.id)} onFocus={() => setHover(t.id)} onBlur={() => setHover(null)} onClick={() => go(t.id)} onKeyDown={(e) => onKey(e, i)}
            style={{ position: "absolute", left: 0, top: `calc(${(at(i) * 100).toFixed(3)}% - 5px)`, width: "20px", height: "10px", padding: 0, border: 0, background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "flex-end", pointerEvents: "none" }}>
            <span style={{ visibility: drawn ? "visible" : "hidden", width: on || hover === t.id ? "16px" : seen ? "12px" : "8px", height: on ? "3px" : "2px", borderRadius: "var(--r-xs)", background: on ? "#12131A" : seen ? "#8C91A0" : "#C9CCD6", transition: "width .15s ease, background .15s ease" }} />
          </button>
        );
      })}
      {shown ? (
        <div role="tooltip" style={{ position: "absolute", right: "28px", top: `calc(${(at(shownIndex) * 100).toFixed(3)}% - 22px)`, width: "280px", padding: "12px 14px", borderRadius: "var(--r-lg)", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.06), 0 18px 40px -18px rgba(18,19,26,.4)", pointerEvents: "none", display: "flex", flexDirection: "column", gap: "6px", animation: "fade .15s ease-out" }}>
          <strong style={{ fontSize: "var(--t-meta)", lineHeight: "1.4", color: "#12131A" }}>{shown.title}</strong>
          {shown.preview ? <span style={{ fontSize: "var(--t-meta)", lineHeight: "1.45", color: "#5C606C", display: "-webkit-box", WebkitLineClamp: "4", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{shown.preview}</span> : null}
        </div>
      ) : null}
      </div>
    </nav>
  );
}
