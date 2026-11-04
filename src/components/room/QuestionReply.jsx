import { useState } from "react";
import { ArrowUp, Ban, Check, Clock, X } from "lucide-react";
import { post } from "../../lib/api.js";
import { useAction } from "../../lib/store.jsx";
import { closedState } from "../../lib/approvalState.js";
import { time } from "../../lib/format.js";

// What a bot's question offers besides its options (after assistant-ui approval cards: a
// question takes a free answer and can be dismissed), and how it reads once closed.

/** «Responder con tus palabras» and «Descartar» under a pending question. */
export function QuestionReply({ approval, onDone }) {
  const { act, busy, error } = useAction();
  const [text, setText] = useState("");
  if (!approval || approval.status !== "pending") return null;
  const send = (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    act(async () => { await post(`/approvals/${approval.id}/answer`, { text: body, revision: approval.revision }); setText(""); onDone?.(); });
  };
  const dismiss = () => act(async () => { await post(`/approvals/${approval.id}/dismiss`, { revision: approval.revision }); onDone?.(); });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <form onSubmit={send} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 4px 4px 16px", borderRadius: "999px", background: "#F6F6F3" }}>
        <label style={{ flex: "1", minWidth: 0, display: "flex" }}>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Responder con tus palabras"}</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="O responde con tus palabras…" maxLength={4000}
            style={{ flex: "1", minWidth: 0, height: "40px", border: 0, outline: "none", background: "transparent", fontSize: "15px", fontFamily: "inherit", color: "#12131A" }} />
        </label>
        <button type="submit" disabled={busy || !text.trim()} aria-label="Enviar la respuesta" className="rm-focus"
          style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: text.trim() ? "#12131A" : "#C9CBD1", color: "#FFFFFF", cursor: text.trim() ? "pointer" : "default", transition: "background .2s ease" }}>
          <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </form>
      <button type="button" className="rm-focus" disabled={busy} onClick={dismiss} title="Se cierra sin respuesta; el bot sigue con la opción más prudente y te lo dice"
        style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px 0 10px", border: 0, borderRadius: "999px", background: "transparent", color: "#5C606C", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
        <X size={14} strokeWidth={2.4} aria-hidden="true" />{"Descartar la pregunta"}
      </button>
      {error ? <span role="alert" style={{ fontSize: "13px", color: "#B4372A", fontWeight: 600 }}>{error}</span> : null}
    </div>
  );
}

const TONES = {
  answered: { bg: "#E1F4EC", fg: "#0B5A3E", icon: Check },
  approved: { bg: "#E1F4EC", fg: "#0B5A3E", icon: Check },
  denied: { bg: "rgba(18,19,26,.06)", fg: "#3D404A", icon: X },
  dismissed: { bg: "rgba(18,19,26,.06)", fg: "#3D404A", icon: X },
  cancelled: { bg: "rgba(18,19,26,.06)", fg: "#3D404A", icon: Ban },
  expired: { bg: "#FFF4D1", fg: "#8A5A00", icon: Clock },
};

/** The final state of a closed request, as a quiet chip (null while it waits). */
export function ClosedChip({ approval, options }) {
  const closed = closedState(approval, options);
  if (!closed) return null;
  const tone = TONES[closed.state] || TONES.cancelled;
  const Icon = tone.icon;
  return (
    <span data-closed={closed.state} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", minHeight: "30px", padding: "4px 12px 4px 10px", background: tone.bg, borderRadius: "15px", fontSize: "13px", fontWeight: 600, color: tone.fg }}>
      <Icon size={14} strokeWidth={2.6} aria-hidden="true" />
      {closed.label}
      {approval.decidedAt ? ` · ${time(approval.decidedAt)}` : ""}
    </span>
  );
}
