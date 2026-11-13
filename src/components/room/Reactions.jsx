import { useCallback, useEffect, useRef, useState } from "react";
import { Ellipsis, SmilePlus } from "../Icon.js";
import { post, put } from "../../lib/api.js";
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

/**
 * The message's reactions: what the server says, or the person's click until it confirms.
 * [list, toggle, explain]: `explain(reasons, note)` says why a bot's answer did not help (it
 * puts the 👎 if it is not there; server/feedback.mjs).
 */
export function useReactions(message) {
  const [local, setLocal] = useState(null);
  const server = message.reactions || [];
  const key = JSON.stringify(server);
  useEffect(() => setLocal(null), [key]);
  const list = local || server;
  // The click on 👎 is a toggle: its reasons wait for it, or they could arrive first and the toggle undo them.
  const inflight = useRef(Promise.resolve());
  const toggle = useCallback(async (emoji) => {
    const mine = list.some((r) => r.emoji === emoji && r.by === "user");
    setLocal(mine ? list.filter((r) => !(r.emoji === emoji && r.by === "user")) : [...list, { emoji, by: "user" }]);
    const sent = post("/messages/" + message.id + "/reactions", { emoji });
    inflight.current = sent.catch(() => {});
    try {
      const r = await sent;
      setLocal(r.reactions);
    } catch {
      setLocal(null);
    }
  }, [list, message.id]);
  const explain = useCallback(async (reasons, note) => {
    const rest = list.filter((r) => !(r.emoji === DOWN && r.by === "user"));
    setLocal([...rest, { emoji: DOWN, by: "user", ...(reasons.length || note ? { reasons, note } : {}) }]);
    try {
      await inflight.current;
      const r = await put("/messages/" + message.id + "/feedback", { reasons, note });
      setLocal(r.reactions);
    } catch (error) {
      setLocal(null);
      throw error;
    }
  }, [list, message.id]);
  return [list, toggle, explain];
}

/* ───────────── «No me sirve» and why (server/feedback.mjs) ───────────── */

export const DOWN = "👎";
export const DOWN_REASONS = [
  ["no-pedido", "No hizo lo que pedí"], ["datos", "Datos incorrectos"], ["largo", "Demasiado largo"], ["paso", "Se saltó un paso"],
  ["tono", "Tono"], ["lento", "Lento"], ["otro", "Otro"],
];
const REASON = Object.fromEntries(DOWN_REASONS);
/** The person's 👎 in a list of reactions, with its reasons and note. */
export const myDown = (list) => list.find((r) => r.emoji === DOWN && r.by === "user") || null;
/** «Datos incorrectos, Tono» or «Con una nota», for a 👎 that says why. */
export const downSummary = (r) => (r?.reasons?.length ? r.reasons.map((c) => REASON[c]).filter(Boolean).join(", ") : r?.note ? "Con una nota" : "");

/**
 * The small popover a 👎 opens: what failed (chips, as many as apply) and an optional note.
 * Saving with nothing chosen keeps a plain 👎; «Quitar» takes the 👎 away.
 */
export function DownReasons({ current = null, onSave, onRemove, onClose, style }) {
  const [picked, setPicked] = useState(() => current?.reasons || []);
  const [note, setNote] = useState(() => current?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useDismiss(true, onClose);
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  const flip = (code) => setPicked((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(picked, note.trim());
      onClose();
    } catch (e) {
      setError(e.message || "No se pudo guardar.");
      setBusy(false);
    }
  };
  return (
    <div ref={ref} role="dialog" aria-label="Por qué no te sirve"
      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } }}
      style={{ position: "absolute", zIndex: 30, top: "calc(100% + 6px)", left: "0", width: "min(340px, 86vw)", display: "flex", flexDirection: "column", gap: "10px", padding: "14px", background: "var(--c-card)", border: "1px solid var(--c-line)", borderRadius: "var(--r-lg)", boxShadow: "var(--c-shadow-pop)", textAlign: "left", ...popIn("top left"), ...style }}>
      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <strong style={{ fontSize: "var(--t-ui)", fontWeight: 600, color: "var(--c-text)" }}>{current?.reasons?.length || current?.note ? "Cambiar por qué no sirve" : "¿Qué ha fallado?"}</strong>
        <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.4, color: "var(--c-text-3)" }}>Elige lo que aplique. Sirve para que aprenda; puedes cambiarlo luego.</span>
      </span>
      <div role="group" aria-label="Motivos" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {DOWN_REASONS.map(([code, label], i) => {
          const on = picked.includes(code);
          return (
            <button key={code} ref={i === 0 ? first : null} type="button" className="rm-focus react-chip" aria-pressed={on ? "true" : "false"} onClick={() => flip(code)}
              style={{ ...chip(on), height: "30px", padding: "0 11px", borderRadius: "var(--r-pill)", fontWeight: on ? 600 : 500 }}>
              {label}
            </button>
          );
        })}
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={{ fontSize: "var(--t-meta)", fontWeight: 500, color: "var(--c-text-2)" }}>Una nota <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>(opcional)</span></span>
        <textarea className="c-quiet" rows="2" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: la cifra de marzo es de febrero"
          style={{ padding: "8px 10px", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", resize: "vertical", font: "inherit", fontSize: "var(--t-ui)", lineHeight: 1.45, color: "var(--c-text)" }} />
      </label>
      {error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{error}</span> : null}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {onRemove ? <button type="button" className="rm-focus" aria-label="Quitar «No me sirve»" title="Quitar «No me sirve»" onClick={() => { onRemove(); onClose(); }} style={{ height: "32px", padding: "0 8px", border: 0, borderRadius: "var(--r-sm)", background: "transparent", color: "var(--c-text-2)", fontSize: "var(--t-meta)", whiteSpace: "nowrap", cursor: "pointer" }}>Quitar</button> : null}
        <span style={{ flex: "1" }} />
        <button type="button" className="rm-focus" onClick={onClose} style={{ height: "32px", padding: "0 12px", border: "1px solid var(--c-line)", borderRadius: "var(--r-pill)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-meta)", fontWeight: 500, whiteSpace: "nowrap", cursor: "pointer" }}>Ahora no</button>
        <button type="button" className="rm-focus" onClick={save} disabled={busy} style={{ height: "32px", padding: "0 14px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-meta)", fontWeight: 600, whiteSpace: "nowrap", cursor: busy ? "wait" : "pointer" }}>Guardar</button>
      </div>
    </div>
  );
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
  background: pressed ? "var(--c-accent-soft)" : "var(--c-chip)", border: "1px solid " + (pressed ? "var(--c-accent-ink)" : "var(--c-line)"),
  borderRadius: "var(--r-md)", cursor: "pointer", fontSize: "var(--t-meta)", lineHeight: "1", color: pressed ? "var(--c-accent-ink)" : "var(--c-text-2)",
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
      style={{ position: "absolute", zIndex: 30, top: "calc(100% + 6px)", right: "0", padding: "6px", background: "var(--c-card)", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", boxShadow: "var(--c-shadow-pop)", ...popIn("top right"), ...style }}>
      {other ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "240px", padding: "4px" }}>
          <input ref={input} value={value} onChange={(e) => typed(e.target.value)} aria-label="Cualquier emoji" placeholder="Escribe o pega un emoji"
            onKeyDown={(e) => { if (e.key === "Backspace" && !value) setOther(false); }}
            style={{ height: "36px", padding: "0 10px", border: "1px solid var(--c-line)", borderRadius: "var(--r-sm)", fontSize: "var(--t-body)", font: "inherit" }} />
          <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{value && !isEmoji(value) ? "Solo un emoji." : "Pulsa Windows + . para abrir los emojis del sistema."}</span>
        </div>
      ) : (
        <div role="toolbar" aria-label="Reacciones rápidas" style={{ display: "flex", gap: "2px" }}>
          {QUICK.map((emoji, i) => (
            <button key={emoji} ref={i === 0 ? first : null} data-pick type="button" className="rm-focus react-pick" onClick={() => pick(emoji)}
              aria-pressed={mine.includes(emoji) ? "true" : "false"} aria-label={"Reaccionar con " + emoji}
              style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", background: mine.includes(emoji) ? "var(--c-accent-soft)" : "transparent", border: "0", borderRadius: "var(--r-sm)", cursor: "pointer", fontSize: "var(--t-title)" }}>
              {emoji}
            </button>
          ))}
          <button data-pick type="button" className="rm-focus react-pick" onClick={() => setOther(true)} aria-label="Otro emoji" title="Otro emoji"
            style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "var(--r-sm)", cursor: "pointer", color: "var(--c-text-2)" }}>
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
          style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", background: mine.includes(emoji) ? "var(--c-accent-soft)" : "transparent", border: "0", borderRadius: "var(--r-sm)", cursor: "pointer", fontSize: "var(--t-read)" }}>
          {emoji}
        </button>
      ))}
      <button type="button" className="rm-focus" onClick={() => setOpen(!open)} aria-label="Reaccionar" title="Reaccionar" aria-expanded={open ? "true" : "false"}
        style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", background: open ? "var(--c-chip)" : "transparent", border: "0", borderRadius: "var(--r-sm)", cursor: "pointer", color: "var(--c-text-2)" }}>
        <SmilePlus size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {open ? <ReactionPicker mine={mine} onPick={toggle} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

/**
 * The row of chips under a message: «👍 2», pressed when it is yours; + to add another. On a
 * bot's answer (`explain`), your 👎 asks why (once, when you put it) and shows the reason after.
 */
export function ReactionRow({ list, toggle, bots, id = "", explain = null }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState(false);
  const down = explain ? myDown(list) : null;
  const had = useRef(!!down);
  useEffect(() => {
    if (down && !had.current) setWhy(true);
    had.current = !!down;
  }, [!!down]); // eslint-disable-line react-hooks/exhaustive-deps
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
            <span style={{ fontSize: "var(--t-body)" }} aria-hidden="true">{g.emoji}</span>
            <span key={g.count} className="react-count" style={{ fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>{g.count}</span>
          </button>
        );
      })}
      <span style={{ position: "relative", display: "flex" }}>
        <button type="button" className="rm-focus react-chip" onClick={() => setOpen(!open)} aria-label="Añadir reacción" title="Añadir reacción" aria-expanded={open ? "true" : "false"}
          style={{ ...chip(false), padding: "0 7px", color: "var(--c-text-2)" }}>
          <SmilePlus size={15} strokeWidth={2} aria-hidden="true" />
        </button>
        {open ? <ReactionPicker mine={list.filter((r) => r.by === "user").map((r) => r.emoji)} onPick={toggle} onClose={() => setOpen(false)} style={{ left: "0", right: "auto" }} /> : null}
      </span>
      {down ? (
        <span style={{ position: "relative", display: "flex" }}>
          <button type="button" className="rm-focus" onClick={() => setWhy((v) => !v)} aria-expanded={why ? "true" : "false"} aria-haspopup="dialog"
            title={down.note || undefined} style={{ height: "26px", padding: "0 8px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", color: "var(--c-text-2)", fontSize: "var(--t-meta)", cursor: "pointer" }}>
            {downSummary(down) ? "No sirve: " + downSummary(down) : "¿Por qué no sirve?"}
          </button>
          {why ? <DownReasons current={down} onSave={explain} onRemove={() => toggle(DOWN)} onClose={() => setWhy(false)} /> : null}
        </span>
      ) : null}
    </div>
  );
}
