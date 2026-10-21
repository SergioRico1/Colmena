import { useCallback, useEffect, useRef, useState } from "react";
import { Ellipsis, SmilePlus } from "lucide-react";
import { post } from "../../lib/api.js";
import { findBot, useDismiss } from "./common.jsx";
import { freshness, popIn } from "../../lib/motion.js";

// Slack / OpenClaw-style reactions. A reaction never starts a bot's turn: the bots see it on
// their next one. Bots react too (👀 while they work on a message, 👍 → ✅ on the plan).

/** The quick palette, in this order (the bots react with these same ones). */
export const QUICK = ["👍", "👀", "✅", "🙌", "❤️", "🎉", "😂", "🙏"];

export function isEmoji(value) {
  const s = String(value || "").trim();
  return s.length > 0 && s.length <= 16 && /^\p{Extended_Pictographic}/u.test(s) && !/[\p{L}\p{N}\s]/u.test(s.replace(/[\u{1F3FB}-\u{1F3FF}‍️]/gu, ""));
}

const names = (list) => (list.length > 1 ? list.slice(0, -1).join(", ") + " y " + list.at(-1) : list[0] || "");

/** The message's reactions: what the server says, or the person's click until it confirms. */
export function useReactions(message) {
  const [local, setLocal] = useState(null);
  const server = message.reactions || [];
  const key = JSON.stringify(server);
  useEffect(() => setLocal(null), [key]);
  const list = local || server;
  const toggle = useCallback(async (emoji) => {
    const mine = list.some((r) => r.emoji === emoji && r.by === "user");
    setLocal(mine ? list.filter((r) => !(r.emoji === emoji && r.by === "user")) : [...list, { emoji, by: "user" }]);
    try {
      const r = await post("/messages/" + message.id + "/reactions", { emoji });
      setLocal(r.reactions);
    } catch {
      setLocal(null);
    }
  }, [list, message.id]);
  return [list, toggle];
}

/** Groups by emoji, in order of the first reaction; the person first among who reacted. */
function grouped(list, bots) {
  const map = new Map();
  for (const r of list) {
    if (!map.has(r.emoji)) map.set(r.emoji, []);
    map.get(r.emoji).push(r.by);
  }
  return [...map].map(([emoji, by]) => {
    const mine = by.includes("user");
    const who = [...(mine ? ["Tú"] : []), ...by.filter((b) => b !== "user").map((b) => findBot(bots, b)?.name || b)];
    return { emoji, count: by.length, mine, who };
  });
}

const chip = (pressed) => ({
  display: "inline-flex", alignItems: "center", gap: "4px", height: "26px", padding: "0 8px",
  background: pressed ? "#E7EEFF" : "#EEF0F4", border: "1px solid " + (pressed ? "#1F4FD1" : "#EEF0F4"),
  borderRadius: "13px", cursor: "pointer", fontSize: "13px", lineHeight: "1", color: pressed ? "#1F4FD1" : "#2A2E38",
});

/** Quick palette (arrow keys move, Escape closes) and «…» for any emoji. */
export function ReactionPicker({ mine = [], onPick, onClose, style }) {
  const [other, setOther] = useState(false);
  const [value, setValue] = useState("");
  const ref = useDismiss(true, onClose);
  const first = useRef(null);
  const input = useRef(null);
  useEffect(() => {
    (other ? input.current : first.current)?.focus();
  }, [other]);
  const move = (e) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const items = [...ref.current.querySelectorAll("[data-pick]")];
    const i = items.indexOf(document.activeElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
    e.preventDefault();
  };
  const pick = (emoji) => {
    onPick(emoji);
    onClose();
  };
  const typed = (text) => {
    setValue(text);
    if (isEmoji(text)) pick(text.trim());
  };
  return (
    <div ref={ref} role="dialog" aria-label="Reaccionar" onKeyDown={move}
      style={{ position: "absolute", zIndex: 30, top: "calc(100% + 6px)", right: "0", padding: "6px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", boxShadow: "0 14px 34px rgba(18,19,26,.16)", ...popIn("top right"), ...style }}>
      {other ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "240px", padding: "4px" }}>
          <input ref={input} value={value} onChange={(e) => typed(e.target.value)} aria-label="Cualquier emoji" placeholder="Escribe o pega un emoji"
            onKeyDown={(e) => { if (e.key === "Backspace" && !value) setOther(false); }}
            style={{ height: "36px", padding: "0 10px", border: "1px solid #DCE0E8", borderRadius: "8px", fontSize: "15px", font: "inherit" }} />
          <span style={{ fontSize: "12px", color: "#555A68" }}>{value && !isEmoji(value) ? "Solo un emoji." : "Pulsa Windows + . para abrir los emojis del sistema."}</span>
        </div>
      ) : (
        <div role="toolbar" aria-label="Reacciones rápidas" style={{ display: "flex", gap: "2px" }}>
          {QUICK.map((emoji, i) => (
            <button key={emoji} ref={i === 0 ? first : null} data-pick type="button" className="rm-focus react-pick" onClick={() => pick(emoji)}
              aria-pressed={mine.includes(emoji) ? "true" : "false"} aria-label={"Reaccionar con " + emoji}
              style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", background: mine.includes(emoji) ? "#E7EEFF" : "transparent", border: "0", borderRadius: "8px", cursor: "pointer", fontSize: "19px" }}>
              {emoji}
            </button>
          ))}
          <button data-pick type="button" className="rm-focus react-pick" onClick={() => setOther(true)} aria-label="Otro emoji" title="Otro emoji"
            style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "8px", cursor: "pointer", color: "#4A4F5C" }}>
            <Ellipsis size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Hover toolbar part (Slack): three one-click reactions and «Reaccionar» for the rest. */
export function ReactTools({ list, toggle }) {
  const [open, setOpen] = useState(false);
  const mine = list.filter((r) => r.by === "user").map((r) => r.emoji);
  return (
    <span style={{ position: "relative", display: "flex", gap: "2px" }}>
      {QUICK.slice(0, 3).map((emoji) => (
        <button key={emoji} type="button" className="rm-focus react-pick" onClick={() => toggle(emoji)} aria-pressed={mine.includes(emoji) ? "true" : "false"}
          aria-label={"Reaccionar con " + emoji} title={"Reaccionar con " + emoji}
          style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", background: mine.includes(emoji) ? "#E7EEFF" : "transparent", border: "0", borderRadius: "8px", cursor: "pointer", fontSize: "16px" }}>
          {emoji}
        </button>
      ))}
      <button type="button" className="rm-focus" onClick={() => setOpen(!open)} aria-label="Reaccionar" title="Reaccionar" aria-expanded={open ? "true" : "false"}
        style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", background: open ? "#EEF0F4" : "transparent", border: "0", borderRadius: "8px", cursor: "pointer", color: "#4A4F5C" }}>
        <SmilePlus size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {open ? <ReactionPicker mine={mine} onPick={toggle} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

/** The row of chips under a message: «👍 2», pressed when it is yours; + to add another. */
export function ReactionRow({ list, toggle, bots, id = "" }) {
  const [open, setOpen] = useState(false);
  const groups = grouped(list, bots);
  const fresh = freshness("react:" + id, groups.map((g) => g.emoji));
  if (!list.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px", position: "relative" }}>
      {groups.map((g) => {
        const label = names(g.who) + (g.who.length === 1 && g.mine ? " has reaccionado con " : g.who.length > 1 ? " han reaccionado con " : " ha reaccionado con ") + g.emoji;
        return (
          <button key={g.emoji} type="button" onClick={() => toggle(g.emoji)} aria-pressed={g.mine ? "true" : "false"}
            aria-label={label + (g.mine ? ". Pulsa para quitar la tuya." : ". Pulsa para sumarte.")} title={label} className={"rm-focus react-chip" + (fresh(g.emoji) ? " c-pop" : "")} style={chip(g.mine)}>
            <span style={{ fontSize: "15px" }} aria-hidden="true">{g.emoji}</span>
            <span key={g.count} className="react-count" style={{ fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>{g.count}</span>
          </button>
        );
      })}
      <span style={{ position: "relative", display: "flex" }}>
        <button type="button" className="rm-focus react-chip" onClick={() => setOpen(!open)} aria-label="Añadir reacción" title="Añadir reacción" aria-expanded={open ? "true" : "false"}
          style={{ ...chip(false), padding: "0 7px", color: "#4A4F5C" }}>
          <SmilePlus size={15} strokeWidth={2} aria-hidden="true" />
        </button>
        {open ? <ReactionPicker mine={list.filter((r) => r.by === "user").map((r) => r.emoji)} onPick={toggle} onClose={() => setOpen(false)} style={{ left: "0", right: "auto" }} /> : null}
      </span>
    </div>
  );
}
