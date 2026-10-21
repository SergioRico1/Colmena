import { useCallback, useEffect, useRef, useState } from "react";
import { PillText } from "../v2/MentionPill.jsx";
import { createPortal } from "react-dom";
import { Check, Copy, MessageCircleQuestion, Quote } from "lucide-react";
import { copyText } from "./common.jsx";

// Select a passage of a message (OpenClaw chat-selection-popup): a small toolbar appears over
// it — «Citar» puts it in your message as a quote, «Preguntar aparte» asks about it on the
// side, «Copiar». Only inside one message; pressing the toolbar keeps the selection; it goes
// away with Esc, a click elsewhere, scrolling or when the selection collapses.
const I = { size: 14, strokeWidth: 2.3, "aria-hidden": "true" };
const MAX = 4000;

/** `scope`: ref of the element whose messages (marked data-message-id) can be quoted. */
export default function SelectionPopup({ scope, onQuote, onAsk }) {
  const [state, setState] = useState(null); // {text, x, y, below}
  const [copied, setCopied] = useState(false);
  const box = useRef(null);

  const read = useCallback(() => {
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || sel.rangeCount !== 1) return null;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    const bubble = el?.closest?.("[data-message-id]");
    // Across two messages: nothing (OpenClaw).
    if (!bubble || !scope.current?.contains(bubble)) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    const below = r.top < 64;
    return { text: text.slice(0, MAX), x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below };
  }, [scope]);

  useEffect(() => {
    const show = () => setTimeout(() => { setState(read()); setCopied(false); }, 0);
    const onDown = (e) => { if (!box.current?.contains(e.target)) setState(null); };
    const onKey = (e) => { if (e.key === "Escape") setState(null); };
    const onSel = () => { const sel = window.getSelection?.(); if (!sel || sel.isCollapsed) setState(null); };
    const onScroll = (e) => { if (!box.current?.contains(e.target)) setState(null); };
    document.addEventListener("pointerup", show);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("selectionchange", onSel);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerup", show);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("selectionchange", onSel);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [read]);

  if (!state) return null;
  const run = (fn) => { const t = state.text; setState(null); window.getSelection?.().removeAllRanges(); fn(t); };
  const left = Math.min(Math.max(8 + 190, state.x), window.innerWidth - 8 - 190);
  const btn = { display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 10px", background: "transparent", color: "#FFFFFF", border: "0", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap" };
  // Rendered outside the conversation, so it never counts as new content to scroll to.
  return createPortal((
    <div ref={box} role="toolbar" aria-label="Con el texto seleccionado" className="c-pop" onPointerDown={(e) => e.preventDefault()}
      style={{ position: "fixed", zIndex: 60, left: left + "px", top: state.y + "px", transform: state.below ? "translate(-50%, 0)" : "translate(-50%, -100%)", display: "flex", gap: "2px", padding: "4px", background: "#12131A", borderRadius: "11px", boxShadow: "0 10px 24px -10px rgba(18,19,26,.55)" }}>
      {onQuote ? <button type="button" className="rm-focus c-sel-btn" onClick={() => run(onQuote)} title="Lo pone en tu mensaje como cita" style={btn}><Quote {...I} />Citar en el mensaje</button> : null}
      {onAsk ? <button type="button" className="rm-focus c-sel-btn" onClick={() => run(onAsk)} title="Pregunta sobre esto sin interrumpir" style={btn}><MessageCircleQuestion {...I} />Preguntar aparte</button> : null}
      <button type="button" className="rm-focus c-sel-btn" onClick={async () => { await copyText(state.text); setCopied(true); setTimeout(() => setState(null), 700); }} style={btn}>{copied ? <Check {...I} /> : <Copy {...I} />}{copied ? "Copiado" : "Copiar"}</button>
    </div>
  ), document.body);
}

/** «Citar»: the passage goes into the composer of that conversation as a Markdown quote. */
export function quoteInto(missionId, text) {
  window.dispatchEvent(new CustomEvent("colmena:quote", { detail: { missionId, text } }));
}
export const asQuote = (text) => String(text || "").trim().split("\n").map((l) => "> " + l).join("\n") + "\n\n";

/** Your own message as written, with its «> » lines shown as a quote (from «Citar»). */
export function UserText({ text, size = 15 }) {
  const blocks = [];
  for (const line of String(text || "").split("\n")) {
    const quoted = /^>\s?/.test(line);
    const last = blocks.at(-1);
    const value = quoted ? line.replace(/^>\s?/, "") : line;
    if (last && last.quoted === quoted) last.lines.push(value);
    else blocks.push({ quoted, lines: [value] });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {blocks.map((b, i) => {
        const body = b.lines.join("\n").replace(/^\n+|\n+$/g, "");
        if (!body) return null;
        return b.quoted
          ? <blockquote key={i} style={{ margin: 0, padding: "2px 0 2px 12px", borderLeft: "3px solid #FFC93C", color: "#4A4F5C", fontSize: size - 1 + "px", lineHeight: "1.5", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{body}</blockquote>
          : <p key={i} style={{ margin: 0, fontSize: size + "px", lineHeight: "1.5", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><PillText text={body} /></p>;
      })}
    </div>
  );
}
