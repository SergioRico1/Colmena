import { Clock } from "../Icon.js";
import { post } from "../../lib/api.js";
import QuestionFlow, { AnswerList } from "../v2/chat/QuestionFlow.jsx";
import { useAction } from "../../lib/store.jsx";
import { letterOf, letterStyle, useChoiceKeys } from "../../lib/choiceKeys.js";
import { withRowBoundary } from "../RowBoundary.jsx";
import { BotAvatar } from "./common.jsx";
import ApprovalConflict from "./ApprovalConflict.jsx";
import Markdown from "./Markdown.jsx";
import { ClosedChip, QuestionReply } from "./QuestionReply.jsx";

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bolds bot names inside a sentence («Las facturas las lleva **Tomás**»). */
function BoldNames({ text, bots }) {
  const names = bots.map((b) => b.name).filter(Boolean);
  if (!names.length) return text;
  const re = new RegExp(`(${names.map(escapeRe).join("|")})`, "g");
  return String(text || "").split(re).map((part, i) => (names.includes(part) ? <strong key={i}>{part}</strong> : part));
}

/**
 * A timed question: before its wait ends, when the bot will go on by itself; after it, that
 * the bot went on with the prudent option and the question can still be answered.
 */
function WaitNote({ approval, bots }) {
  const name = bots.find((b) => b.id === approval.botId)?.name || "El bot";
  const until = approval.waitUntil ? new Date(approval.waitUntil) : null;
  const text = approval.stillOpen
    ? `Sigue abierta: ${name} ha seguido con lo más prudente mientras tanto. Si respondes, se lo paso y lo ajusta.`
    : until && !Number.isNaN(until.getTime())
      ? `Si no respondes antes de las ${until.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}, ${name} seguirá con lo más prudente y podrás responder igual.`
      : null;
  if (!text) return null;
  return (
    <p style={{ margin: "0", display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", lineHeight: "1.45", color: "var(--c-text-3)" }}>
      <Clock size={14} aria-hidden="true" style={{ flex: "none" }} />
      <span>{text}</span>
    </p>
  );
}

/**
 * Highlighted question from a bot («Lo que te bloquea, siempre arriba»: black border + honey shadow).
 * variant "chat" (Chat mockup) or "room" (Sala / En directo mockups).
 * The options read A, B, C… and the letter key answers while this is the question in focus,
 * or the last one waiting on screen, and you are not typing (lib/choiceKeys.js).
 */
function QuestionCard({ approval, text, bots, variant = "room", id }) {
  const { act, busy, error, conflict } = useAction();
  const chat = variant === "chat";
  const question = approval?.summary || approval?.title || text || "";
  const options = approval?.options || [];
  const pending = approval?.status === "pending";
  const primaryIndex = Math.max(0, options.findIndex((o) => o.primary));
  // The answer is bound to the question exactly as shown (revision); a 409 shows the new one.
  const answer = (option) => act(() => post(`/approvals/${approval.id}/answer`, { optionId: option.id, revision: approval.revision }));
  const mentioned = (label) => bots.find((b) => new RegExp(`\\b${escapeRe(b.name)}\\b`, "i").test(label));
  const helper = chat ? options.map((o) => mentioned(o.label)).find(Boolean) : null;
  const keys = useChoiceKeys({ count: options.length, enabled: pending && !busy && !(approval?.questions?.length > 1), onChoose: (i) => answer(options[i]) });

  // Colmena 2.0: honey glow while it waits for you; a calm card once answered (no hard shadows).
  const card = { maxWidth: chat ? "none" : "640px", background: "var(--c-card)", borderRadius: "var(--r-2xl)", boxShadow: "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.16), 0 30px 60px -30px rgba(201,138,0,.6)", padding: "20px 22px", display: "flex", flexDirection: "column", gap: "14px" };
  const answered = approval && !pending;

  return (
    <div ref={keys} id={id} style={answered ? { ...card, boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 16px 40px -22px rgba(18,19,26,.16)" } : card}>
      {/[*_`#[\n]/.test(question)
        ? <Markdown text={question} size={chat ? 16 : 15} mentions={(bots || []).map((b) => b.name)} />
        : <p style={{ margin: "0", fontSize: chat ? "var(--t-read)" : "var(--t-body)", lineHeight: "1.55" }}><BoldNames text={question} bots={bots} /></p>}
      {answered ? (
        // Closed: its final state (answered, left unanswered, cancelled, expired), no dead buttons.
        <>
          <ClosedChip approval={approval} options={options} />
          <AnswerList answers={approval.answers} />
        </>
      ) : approval?.questions?.length > 1 ? (
        <QuestionFlow approval={approval} />
      ) : options.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {options.map((o, i) => {
            const primary = i === primaryIndex;
            const helperBot = chat && primary ? mentioned(o.label) : null;
            // Colmena 2.0 pills: the recommended option in ink, the rest on a soft surface.
            const style = primary
              ? { display: "flex", alignItems: "center", gap: "8px", minHeight: "46px", padding: "0 20px 0 12px", background: "var(--c-btn)", color: "var(--c-btn-text)", border: "0", borderRadius: "var(--r-pill)", cursor: "pointer", fontWeight: "600", fontSize: "var(--t-body)" }
              : { display: "flex", alignItems: "center", gap: "8px", minHeight: "46px", padding: "0 18px 0 12px", background: "var(--c-hover)", color: "var(--c-text)", border: "0", borderRadius: "var(--r-pill)", cursor: "pointer", fontWeight: "600", fontSize: "var(--t-body)" };
            return (
              <button key={o.id || i} type="button" className="rm-focus" disabled={busy || !pending} aria-busy={busy ? "true" : undefined} aria-keyshortcuts={letterOf(i) || undefined} onClick={() => answer(o)} style={style}>
                {letterOf(i) ? <span aria-hidden="true" style={letterStyle(primary)}>{letterOf(i)}</span> : null}
                {helperBot ? <BotAvatar bot={helperBot} size={20} /> : null}
                {o.label}
              </button>
            );
          })}
        </div>
      ) : !approval ? (
        // A question message whose request is gone (an old chat): nothing to answer any more.
        <span style={{ alignSelf: "flex-start", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Ya no espera respuesta"}</span>
      ) : null}
      {pending && !(approval.questions?.length > 1) ? <QuestionReply approval={approval} /> : null}
      {pending ? <WaitNote approval={approval} bots={bots} /> : null}
      {chat && helper && !answered ? (
        <p style={{ margin: "0", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{`${helper.name} contestará aquí mismo. No hace falta crear una sala.`}</p>
      ) : null}
      <ApprovalConflict error={error} conflict={conflict} />
    </div>
  );
}

export default withRowBoundary(QuestionCard, { label: "No se ha podido mostrar esta pregunta", resetKey: ({ approval, text }) => `${approval?.id}:${approval?.revision}:${approval?.status}:${String(text || "").length}` });
