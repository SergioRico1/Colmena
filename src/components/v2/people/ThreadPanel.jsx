import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import PeopleMessage from "./PeopleMessage.jsx";
import PeopleComposer from "./PeopleComposer.jsx";
import { useThread } from "../../../lib/peers.js";
import { flash } from "../../../lib/reveal.js";
import { isHidden } from "../../../lib/undoToast.js";

// A thread (design/V2Personas.dc.html, paso hilo): beside the conversation, its first message
// and the replies. Only those in it get a notice: whoever started it, whoever replies and
// whoever is named.
// Below this width the conversation keeps its room and the thread floats over it.
const NARROW = "(max-width: 1180px)";
function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === "function" && matchMedia(NARROW).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const mq = matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export default function ThreadPanel({ shareId, rootId, dm, botOf, shared, composer, revealId = null, onClose, onDelete, onError }) {
  const thread = useThread(shareId, rootId);
  const list = useRef(null);
  const narrow = useNarrow();
  const count = thread.messages.filter((m) => !m.deleted).length;
  // New replies keep the end in view; a reply you jumped to is centred and lit once.
  useEffect(() => { const el = list.current; if (el && !revealId) el.scrollTop = el.scrollHeight; }, [thread.messages.length, revealId]);
  useEffect(() => {
    if (!revealId || thread.loading) return;
    const el = list.current?.querySelector(`[data-message-id="${CSS.escape(revealId)}"]`);
    if (el) { el.scrollIntoView({ block: "center" }); flash(el); }
  }, [revealId, thread.loading]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented && !document.activeElement?.matches?.("textarea:not(:placeholder-shown)")) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const common = { dm, botOf, shared, inThread: true, onReact: thread.react, onRetry: thread.retry, onEdit: thread.edit, onError };
  return (
    <aside aria-label="Hilo" style={{ flex: "none", width: narrow ? "min(440px, 100%)" : "clamp(340px, 34vw, 440px)", height: "100%", display: "flex", flexDirection: "column", background: "#FBFBF9", borderLeft: "1px solid rgba(18,19,26,.07)", animation: narrow ? "sheet .35s cubic-bezier(.2,.8,.2,1)" : "fade .25s ease-out", ...(narrow ? { position: "absolute", top: 0, right: 0, bottom: 0, zIndex: 30, boxShadow: "-30px 0 60px -30px rgba(18,19,26,.35)", borderRadius: "28px 0 0 28px" } : {}) }}>
      <header style={{ flex: "none", display: "flex", alignItems: "center", gap: "12px", padding: "22px 20px 16px 24px" }}>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
          <strong style={{ font: "600 20px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Hilo"}</strong>
          <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{"Solo avisa a quien está en él"}</span>
        </span>
        <button type="button" aria-label="Cerrar el hilo" onClick={onClose} style={{ width: "38px", height: "38px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.05)", cursor: "pointer", color: "#3D404A" }}><X size={18} strokeWidth={2.2} aria-hidden="true" /></button>
      </header>
      <div ref={list} style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "6px 24px 18px", display: "flex", flexDirection: "column", gap: "4px" }}>
        {thread.error === "missing" ? <p style={{ margin: "20px 0", fontSize: "15px", color: "#5C606C" }}>{"Este hilo ya no está."}</p> : null}
        {thread.root ? <PeopleMessage m={thread.root} {...common} onDelete={onDelete} /> : null}
        {thread.root ? (
          <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 0 6px", fontSize: "13px", color: "#6B6F7A" }}>
            {count === 0 ? "Aún sin respuestas" : count === 1 ? "1 respuesta" : count + " respuestas"}
            <span style={{ flex: 1, height: "1px", background: "rgba(18,19,26,.08)" }} />
          </div>
        ) : null}
        {thread.messages.filter((m) => !isHidden("peermsg:" + m.id)).map((m) => <PeopleMessage key={m.id} m={m} {...common} onDelete={onDelete} />)}
      </div>
      <div style={{ flex: "none", padding: "6px 18px 20px" }}>
        <PeopleComposer {...composer} compact resetKey={rootId} placeholder="Responde en el hilo…" onSend={(text, bots, people) => thread.send(text, bots, people)} onError={onError} />
      </div>
    </aside>
  );
}
