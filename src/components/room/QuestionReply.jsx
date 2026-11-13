import { useState } from "react";
import { ArrowUp, Ban, Check, Clock, X } from "../Icon.js";
import { post } from "../../lib/api.js";
import { useAction } from "../../lib/store.jsx";
import { closedState } from "../../lib/approvalState.js";
import { time } from "../../lib/format.js";
import "../../styles/conversation.css";

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
      <form onSubmit={send} className="v4-cbox" style={{ minHeight: "44px", padding: "4px 4px 4px 12px", alignItems: "center" }}>
        <label style={{ flex: "1", minWidth: 0, display: "flex" }}>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Responder con tus palabras"}</span>
          <input className="c-bare" value={text} onChange={(e) => setText(e.target.value)} placeholder="O responde con tus palabras…" maxLength={4000}
            style={{ flex: "1", minWidth: 0, height: "40px", border: 0, background: "transparent", fontSize: "var(--t-body)", fontFamily: "inherit", color: "var(--c-text)" }} />
        </label>
        <button type="submit" disabled={busy || !text.trim()} aria-label="Enviar la respuesta" className="rm-focus"
          style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-md)", background: text.trim() ? "var(--c-btn)" : "rgb(var(--c-ink-rgb) / .12)", color: text.trim() ? "var(--c-btn-text)" : "var(--c-text-4)", cursor: text.trim() ? "pointer" : "default", transition: "background .2s ease" }}>
          <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </form>
      <button type="button" className="rm-focus" disabled={busy} onClick={dismiss} title="Se cierra sin respuesta; el bot sigue con la opción más prudente y te lo dice"
        style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px 0 10px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", color: "var(--c-text-3)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600 }}>
        <X size={14} strokeWidth={2.4} aria-hidden="true" />{"Descartar la pregunta"}
      </button>
      {error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--c-error)", fontWeight: 600 }}>{error}</span> : null}
    </div>
  );
}

const TONES = {
  answered: { bg: "var(--c-ok-soft)", fg: "var(--c-ok-ink)", icon: Check },
  approved: { bg: "var(--c-ok-soft)", fg: "var(--c-ok-ink)", icon: Check },
  denied: { bg: "rgb(var(--c-ink-rgb) / .06)", fg: "var(--c-text-2)", icon: X },
  dismissed: { bg: "rgb(var(--c-ink-rgb) / .06)", fg: "var(--c-text-2)", icon: X },
  cancelled: { bg: "rgb(var(--c-ink-rgb) / .06)", fg: "var(--c-text-2)", icon: Ban },
  // Expired is over: neutral (honey only means it still waits for you).
  expired: { bg: "rgb(var(--c-ink-rgb) / .06)", fg: "var(--c-text-2)", icon: Clock },
};

/** The final state of a closed request, as a quiet chip (null while it waits). */
export function ClosedChip({ approval, options }) {
  const closed = closedState(approval, options);
  if (!closed) return null;
  const tone = TONES[closed.state] || TONES.cancelled;
  const Icon = tone.icon;
  return (
    <span data-closed={closed.state} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", minHeight: "30px", padding: "4px 12px 4px 10px", background: tone.bg, borderRadius: "var(--r-lg)", fontSize: "var(--t-meta)", fontWeight: 600, color: tone.fg }}>
      <Icon size={14} strokeWidth={2.6} aria-hidden="true" />
      {closed.label}
      {approval.decidedAt ? ` · ${time(approval.decidedAt)}` : ""}
    </span>
  );
}
