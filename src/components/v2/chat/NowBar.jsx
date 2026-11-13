import { useEffect, useState } from "react";
import { BotMark } from "./Mark.jsx";
import { findBot } from "../../room/common.jsx";
import { useSlowPhase, verbLabel } from "../../room/working.js";
import { useMissionActivity } from "../../../lib/liveStore.js";
import { MAX_LINES, elapsedText, moreText, workingNow } from "../../../lib/nowBar.js";

// «Qué está haciendo ahora», pinned over the composer: while a bot works in this
// conversation and its live row is out of view (you are reading further up), one slim line
// says who, what it is doing — the same words the working line and the narration show —
// for how long, and lets you stop it; a click on the line takes you to the live row. It goes
// when that row is in view or the work ends. With several bots at work (a room): one line
// per bot up to two, then «y 2 más». The step text has its own fixed area, so the timer and
// «Parar» never move under the pointer; a new text slides in (a plain swap with reduced
// motion: styles/base.css). What changes on every frame stays here, low in the tree: the
// bots' activity comes from liveStore and each timer ticks on its own.

/** Whether any element matching `selector` shows inside the scrolling element. */
function useInView(scroller, selector, enabled) {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = scroller?.current;
    if (!enabled || !el) { setInView(true); return undefined; }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      let seen = false;
      for (const node of el.querySelectorAll(selector)) {
        const r = node.getBoundingClientRect();
        if (r.height > 0 && r.bottom > box.top + 8 && r.top < box.bottom - 8) { seen = true; break; }
      }
      setInView(seen);
    };
    const soon = () => { if (!frame) frame = requestAnimationFrame(measure); };
    el.addEventListener("scroll", soon, { passive: true });
    // The live row comes and goes, and the list grows, without a scroll.
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(soon) : null;
    sizes?.observe(el);
    const list = el.firstElementChild;
    if (list) sizes?.observe(list);
    const nodes = typeof MutationObserver === "function" ? new MutationObserver(soon) : null;
    if (list) nodes?.observe(list, { childList: true });
    measure();
    return () => { el.removeEventListener("scroll", soon); sizes?.disconnect(); nodes?.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [scroller, selector, enabled]);
  return inView;
}

/** The timer of one line: it ticks on its own, once a second, and keeps its width. */
function Elapsed({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return <span aria-hidden="true" style={{ flex: "none", minWidth: "44px", textAlign: "right", font: "400 var(--t-meta)/1 'Geist Mono', monospace", fontVariantNumeric: "tabular-nums", color: "#5C606C" }}>{elapsedText(since, now)}</span>;
}

function Line({ item, bot, onShow }) {
  const phase = useSlowPhase(item.verb);
  const text = item.narration || (item.verb ? verbLabel(phase) + (item.detail ? " · " + item.detail : "") : "Pensando");
  return (
    <button type="button" className="rm-focus" onClick={onShow} title="Ir a lo que está haciendo" aria-label={`${bot?.name || "El bot"}: ${text}. Ir a lo que está haciendo`}
      style={{ flex: "1", minWidth: 0, minHeight: "32px", display: "flex", alignItems: "center", gap: "10px", padding: "0 8px 0 0", border: 0, borderRadius: "10px", background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "var(--t-ui)", color: "#12131A" }}>
      <BotMark bot={bot} size={16} state="work" />
      <strong style={{ flex: "none", fontWeight: 600 }}>{bot?.name || "Bot"}</strong>
      {/* Its own area: whatever the text, what comes after it stays where it is. */}
      <span style={{ flex: "1", minWidth: 0, height: "20px", overflow: "hidden", color: "#4A4D57" }}>
        <span key={text} data-now-text="" style={{ display: "block", lineHeight: "20px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", animation: "c-rise 160ms ease-out both" }}>{text}</span>
      </span>
      <Elapsed since={item.since} />
    </button>
  );
}

/**
 * @param {object} p
 * @param {string} p.missionId the conversation
 * @param {boolean} p.active a bot is working here
 * @param {object[]} p.steps the mission's steps (narration, start)
 * @param {object[]} p.bots
 * @param {{current: Element|null}} p.scroller the scrolling list
 * @param {string} [p.selector] what counts as the live row inside it
 * @param {string|null} [p.fallbackBotId] who works when nothing says so yet (a 1:1 chat)
 * @param {() => void} p.onShow go to the live row
 * @param {(() => void)|null} [p.onStop] «Parar»
 * @param {object} [p.style]
 */
export default function NowBar({ missionId, active, steps = [], bots = [], scroller, selector = '[data-kind="now"]', fallbackBotId = null, onShow, onStop = null, style = null }) {
  const activity = useMissionActivity(missionId);
  const inView = useInView(scroller, selector, !!active);
  if (!active || inView) return null;
  const working = workingNow(activity, steps, fallbackBotId);
  if (!working.length) return null;
  const more = moreText(working.length);
  return (
    <div role="group" aria-label="Qué está haciendo ahora" data-now-bar="" style={{ display: "flex", alignItems: "center", gap: "6px", margin: "0 0 10px", padding: "4px 6px 4px 14px", borderRadius: "16px", background: "#FFFFFF", border: "1px solid rgba(18,19,26,.07)", animation: "rise .2s ease-out", ...style }}>
      <div style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column" }}>
        {working.slice(0, MAX_LINES).map((item) => <div key={item.botId} style={{ display: "flex", minWidth: 0 }}><Line item={item} bot={findBot(bots, item.botId)} onShow={onShow} /></div>)}
        {more ? <span style={{ padding: "0 0 4px 26px", fontSize: "var(--t-meta)", color: "#5C606C" }}>{more}</span> : null}
      </div>
      {onStop ? <button type="button" className="rm-focus chat-stop" onClick={onStop} title="Parar (Esc)" style={{ flex: "none", height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", background: "transparent", color: "#5C606C", fontSize: "var(--t-meta)", fontWeight: 500, cursor: "pointer" }}>{"Parar"}</button> : null}
    </div>
  );
}
