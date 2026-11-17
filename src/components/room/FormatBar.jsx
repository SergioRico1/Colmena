// The formatting bar of the desktop's message boxes (rooms: RoomParts.jsx › RoomComposer; chats
// with a person: v2/people/PeopleComposer.jsx). «Aa» shows it; it writes Markdown
// (src/chat/formatText.js, flavor "md"), which the bots read and the rooms draw (Emphasis.jsx).
// Ctrl+B, Ctrl+I, Ctrl+Mayús+X, Ctrl+Mayús+U and Ctrl+Mayús+7/8/9 do the same.
import { useState } from "react";
import { Code, CodeBlock, LinkSimple, ListBullets, ListOrdered, Quote, TextAa, TextB, TextItalic, TextStrikethrough } from "../Icon.js";
import { formatText } from "../../chat/formatText.js";

const KEY = "colmena.format";
const remembered = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const FORMATS = [
  ["bold", "Negrita", TextB, "Ctrl+B"], ["italic", "Cursiva", TextItalic, "Ctrl+I"], ["strike", "Tachado", TextStrikethrough, "Ctrl+Mayús+X"],
  null, ["link", "Enlace", LinkSimple, "Ctrl+Mayús+U"], null,
  ["numbers", "Lista numerada", ListOrdered, "Ctrl+Mayús+7"], ["bullets", "Lista", ListBullets, "Ctrl+Mayús+8"], null,
  ["quote", "Cita", Quote, "Ctrl+Mayús+9"], ["code", "Código", Code, null], ["block", "Bloque de código", CodeBlock, null],
];
const SHORT = { b: "bold", i: "italic" };
const SHIFT = { x: "strike", u: "link", Digit7: "numbers", Digit8: "bullets", Digit9: "quote" };

/** {on, toggle, format(kind), onKey(e) → true when it took the key}. */
export function useFormatBar({ text, setText, inputRef }) {
  const [on, setOn] = useState(remembered);
  const format = (kind) => {
    const el = inputRef.current;
    if (!el) return;
    const out = formatText(text, el.selectionStart ?? text.length, el.selectionEnd ?? text.length, kind, { flavor: "md" });
    setText(out.text);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(out.start, out.end); });
  };
  const toggle = () => { const next = !on; setOn(next); try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* private storage */ } };
  const onKey = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
    const kind = e.shiftKey ? SHIFT[e.key.toLowerCase()] || SHIFT[e.code] : SHORT[e.key.toLowerCase()];
    if (!kind) return false;
    e.preventDefault();
    format(kind);
    return true;
  };
  return { on, toggle, format, onKey };
}

const BTN = { flex: "none", width: "30px", height: "28px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-sm)", background: "transparent", color: "var(--c-text-2)", cursor: "pointer" };

/** The bar over the box. */
export function FormatBar({ bar }) {
  if (!bar.on) return null;
  return (
    <div role="toolbar" aria-label="Formato" className="c-pop" style={{ display: "flex", alignItems: "center", gap: "2px", margin: "0 0 6px", padding: "3px 6px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", overflowX: "auto", scrollbarWidth: "none" }}>
      {FORMATS.map((x, i) => {
        if (!x) return <span key={"s" + i} aria-hidden="true" style={{ flex: "none", width: "1px", height: "16px", margin: "0 4px", background: "var(--c-line)" }} />;
        const [kind, label, Icon, keys] = x;
        return <button key={kind} type="button" className="v3-hover" title={label + (keys ? " (" + keys + ")" : "")} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={() => bar.format(kind)} style={BTN}><Icon size={16} /></button>;
      })}
    </div>
  );
}

/** «Aa» in the box: shows or hides the bar. */
export function FormatToggle({ bar, className = "v4-ib", size = 18 }) {
  return (
    <button type="button" className={className} aria-pressed={bar.on} aria-label={bar.on ? "Ocultar el formato" : "Mostrar el formato"} title="Formato" onClick={bar.toggle}
      style={bar.on ? { background: "var(--c-chip)", color: "var(--c-text)" } : undefined}>
      <TextAa size={size} />
    </button>
  );
}
