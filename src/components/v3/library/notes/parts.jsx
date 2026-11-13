import { ArrowLeft, Search } from "../../../Icon.js";
import BotFace from "../../../BotFace.jsx";
import { useDialogFocus } from "../../../../lib/useDialogFocus.js";
import { byName } from "../../../../lib/wikiLinks.js";

// Shared pieces of Biblioteca › Notas, with the same measures as Files.jsx and Memory.jsx:
// pill buttons, grey chips, white cards and the sheet a dialog opens in.

export const PILL = { height: "40px", padding: "0 16px", display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-pill)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-ui)", cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap" };
export const DARK = { ...PILL, border: "0", background: "var(--c-btn)", color: "var(--c-btn-text)", fontWeight: "600" };
export const QUIET = { height: "32px", padding: "0 10px", display: "inline-flex", alignItems: "center", gap: "5px", border: "0", borderRadius: "var(--r-sm)", background: "transparent", fontSize: "var(--t-meta)", color: "var(--c-text-2)", cursor: "pointer", textDecoration: "none" };
export const CHIP = { flex: "none", display: "inline-flex", alignItems: "center", gap: "5px", height: "24px", padding: "0 9px", borderRadius: "var(--r-pill)", background: "var(--c-chip)", color: "var(--c-text-2)", fontSize: "var(--t-caption)", fontWeight: "500", whiteSpace: "nowrap" };
export const CARD = { borderRadius: "var(--r-2xl)", background: "var(--c-card)" };
export const FIELD = { height: "44px", padding: "0 14px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-md)", background: "var(--c-card)", fontSize: "var(--t-body)", color: "var(--c-text)", minWidth: 0 };
export const LABEL = { fontSize: "var(--t-meta)", fontWeight: "600", color: "var(--c-text-3)" };
export const ERROR = { margin: 0, fontSize: "var(--t-ui)", color: "var(--c-error)" };
export const MUTED = { margin: 0, fontSize: "var(--t-ui)", color: "var(--c-text-3)" };
export const SR = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };
export const filterChip = (on) => ({ height: "36px", padding: "0 13px", display: "inline-flex", alignItems: "center", border: "0", borderRadius: "var(--r-pill)", background: on ? "var(--c-btn)" : "var(--c-card)", color: on ? "var(--c-btn-text)" : "var(--c-text-2)", fontSize: "var(--t-ui)", fontWeight: "500", cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap" });

/** The way back: to the list, or to the note from one of its views. */
export function Back({ href = "/biblioteca/notas", label = "Todas las notas" }) {
  return <a href={href} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", fontSize: "var(--t-ui)", color: "var(--c-text-2)", textDecoration: "none" }}><ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />{label}</a>;
}

/** Who changed a page: the bot's shape and name, or «Tú». */
export function Who({ by, bots = [] }) {
  const bot = by?.kind === "bot" ? bots.find((b) => b.id === by.botId) || null : null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      {by?.kind === "bot"
        ? (bot ? <BotFace bot={bot} size={16} decorative /> : <span aria-hidden="true" style={{ flex: "none", width: "11px", height: "11px", background: "var(--c-line-strong)", borderRadius: "var(--r-xs)" }} />)
        : <span aria-hidden="true" style={{ flex: "none", width: "11px", height: "11px", borderRadius: "var(--r-circle)", background: "#12131A" }} />}
      {byName(by)}
    </span>
  );
}

/** A modal sheet: title, body and the buttons row. Escape and the backdrop close it (when `onClose`). */
export function Dialog({ title, onClose = null, width = "520px", children, footer = null, id = "note-dialog-t" }) {
  const box = useDialogFocus({ onEscape: onClose || undefined });
  return (
    <div onMouseDown={(e) => { if (onClose && e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: "40px 20px", background: "rgba(18,19,26,.32)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", animation: "fade .25s ease-out" }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} style={{ width: `min(${width}, 100%)`, maxHeight: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: "16px", padding: "28px", background: "var(--c-card)", borderRadius: "var(--r-3xl)", boxShadow: "0 60px 120px -40px rgba(18,19,26,.6)", animation: "sheet .45s cubic-bezier(.2,.8,.2,1)" }}>
        <h2 id={id} style={{ margin: 0, font: "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.025em", overflowWrap: "anywhere" }}>{title}</h2>
        {children}
        {footer ? <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>{footer}</div> : null}
      </div>
    </div>
  );
}

/** The search box of a list (Files.jsx): a magnifier and a borderless field in a white box. */
export function SearchBox({ value, onChange, label, placeholder }) {
  return (
    <label style={{ flex: "1 1 260px", display: "flex", alignItems: "center", gap: "10px", height: "40px", padding: "0 14px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid rgb(var(--c-ink-rgb) / .08)" }}>
      <Search size={16} color="#5C606C" />
      <span style={SR}>{label}</span>
      <input className="c-bare" type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ flex: "1", minWidth: "0", border: "0", background: "transparent", fontSize: "var(--t-body)" }} />
    </label>
  );
}
