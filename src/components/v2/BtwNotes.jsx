import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { post } from "../../lib/api.js";
import { btwQuestion } from "../../lib/btw.js";
import Markdown from "../room/Markdown.jsx";

// «/btw …» (OpenClaw docs/tools/btw.md): a quick question to the bot while it works. It never
// enters the conversation nor steers the turn (server/btw.mjs); the answer appears here, over
// the composer, as a quiet note you close with ✕ or Esc. Notes live only on this screen: they
// are gone when you leave it or reload, as in OpenClaw.

const MAX_NOTES = 3;
let seq = 0;

/** Side questions of one place: `path` is its /btw route (e.g. /missions/:id/btw); null disables them. */
export function useBtw(path) {
  const [notes, setNotes] = useState([]);
  const live = useRef(path);
  live.current = path;
  useEffect(() => setNotes([]), [path]);
  const update = (id, changes) => setNotes((list) => list.map((n) => (n.id === id ? { ...n, ...changes } : n)));
  const run = useCallback((id, question) => {
    const from = live.current;
    post(from, { question })
      .then((r) => { if (live.current === from) update(id, { busy: false, error: null, answer: r.answer, botId: r.botId || null }); })
      .catch((e) => { if (live.current === from) update(id, { busy: false, retryable: true, error: e.message || "No ha podido contestar." }); });
  }, []);
  const ask = useCallback((question) => {
    const id = "btw-" + ++seq;
    const empty = !question.trim();
    setNotes((list) => [...list.slice(-(MAX_NOTES - 1)), { id, question, busy: !empty, error: empty ? "Escribe tu pregunta después de /btw: por ejemplo, /btw ¿qué te falta?" : null, answer: null }]);
    if (!empty) run(id, question);
  }, [run]);
  const retry = useCallback((id) => {
    const note = notes.find((n) => n.id === id);
    if (!note?.question.trim() || !live.current) return;
    update(id, { busy: true, error: null });
    run(id, note.question);
  }, [notes, run]);
  const dismiss = useCallback((id) => setNotes((list) => list.filter((n) => n.id !== id)), []);
  /** Esc closes the newest note before anything else the box does with it. */
  const handleKey = useCallback((e) => {
    if (e.key !== "Escape" || !notes.length) return false;
    e.preventDefault();
    dismiss(notes[notes.length - 1].id);
    return true;
  }, [notes, dismiss]);
  /** Sends `text` as a side question when it is one; true when it was. */
  const intercept = useCallback((text) => {
    const question = btwQuestion(text);
    if (question === null) return false;
    // Nothing is going on yet: there is nothing to ask about on the side.
    if (!path) setNotes((list) => [...list.slice(-(MAX_NOTES - 1)), { id: "btw-" + ++seq, question, busy: false, error: "«/btw» pregunta al margen de una conversación en marcha. Escribe primero tu mensaje.", answer: null }]);
    else ask(question);
    return true;
  }, [ask, path]);
  return { notes, ask, retry, dismiss, handleKey, intercept };
}

const INK = "#12131A", MUTED = "#5C606C", FAINT = "#8A8D96";
const shimmer = { fontSize: "15px", fontWeight: "500", background: `linear-gradient(90deg, ${FAINT} 0%, ${FAINT} 35%, ${INK} 50%, ${FAINT} 65%, ${FAINT} 100%)`, backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2.2s linear infinite" };

function BtwNote({ note, botName, onDismiss, onRetry }) {
  return (
    <section role="note" aria-label={"Pregunta al margen: " + note.question} aria-busy={note.busy || undefined}
      style={{ position: "relative", display: "flex", flexDirection: "column", gap: "8px", padding: "14px 52px 16px 20px", background: "#FFFFFF", borderRadius: "20px", border: "1px solid rgba(18,19,26,.06)", boxShadow: "0 1px 2px rgba(18,19,26,.04), 0 12px 32px -12px rgba(18,19,26,.14)", animation: "rise .32s cubic-bezier(.2,.8,.2,1) both" }}>
      <span style={{ display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0, fontSize: "13px", color: MUTED }}>
        <span style={{ flex: "none", font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: FAINT }}>{"Al margen"}</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={note.question}>{note.question || "/btw"}</span>
      </span>
      {note.busy ? (
        <span role="status" style={shimmer}>{(botName || "Tu bot") + " lo mira sin dejar lo que hace…"}</span>
      ) : note.error ? (
        <span role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", fontSize: "14px", lineHeight: "1.45", color: "#8E2A1F" }}>
          {note.error}
          {note.retryable ? <button type="button" onClick={() => onRetry(note.id)} style={{ height: "30px", padding: "0 12px", border: "0", borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "12px", fontWeight: "600", color: INK }}>{"Reintentar"}</button> : null}
        </span>
      ) : (
        <div style={{ color: INK, maxHeight: "38vh", overflowY: "auto", overflowWrap: "anywhere" }}><Markdown text={note.answer} size={15} /></div>
      )}
      {!note.busy && !note.error ? <span style={{ fontSize: "12px", color: FAINT }}>{(botName ? botName + " · " : "") + "No entra en la conversación"}</span> : null}
      <button type="button" onClick={() => onDismiss(note.id)} aria-label="Cerrar la respuesta al margen" title="Cerrar (Esc)"
        style={{ position: "absolute", top: "10px", right: "10px", width: "32px", height: "32px", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: "transparent", color: MUTED, cursor: "pointer", transition: "background .15s ease" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(18,19,26,.06)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </section>
  );
}

/** The notes over the composer, newest last (nearest to where you write). */
export default function BtwNotes({ btw, botName = null, nameOf = null, style = null }) {
  if (!btw?.notes.length) return null;
  return (
    <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "10px", margin: "0 0 12px", ...(style || {}) }}>
      {btw.notes.map((n) => <BtwNote key={n.id} note={n} botName={(nameOf && n.botId ? nameOf(n.botId) : null) || botName} onDismiss={btw.dismiss} onRetry={btw.retry} />)}
    </div>
  );
}
