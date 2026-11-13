import { Clock } from "../Icon.js";
import { QuestionSteps, AnsweredLine, stepsOf } from "../v2/chat/QuestionFlow.jsx";
import { withRowBoundary } from "../RowBoundary.jsx";
import { closedState } from "../../lib/approvalState.js";
import { time } from "../../lib/format.js";
import { plain } from "./Markdown.jsx";

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
 * A bot's question in a conversation (Colmena 4: design/v4 › .q): one step at a time, lettered
 * options, «Otra respuesta…», Volver · dots · Siguiente (QuestionFlow.jsx). It is a neutral card:
 * honey stays for the approval of what leaves your computer, one honey element per decision.
 * Once answered it folds to one line (what it asked, what you said) so a question and an
 * approval fit on one screen. `variant` is kept for callers ("chat" | "room"); both look alike.
 */
function QuestionCard({ approval, text, bots, id }) {
  const pending = approval?.status === "pending";
  if (!approval) {
    // A question message whose request is gone (an old chat): nothing to answer any more.
    return <AnsweredLine question={plain(text || "")} label="Ya no espera respuesta" />;
  }
  if (!pending) {
    const closed = closedState(approval, approval.options || []);
    const steps = stepsOf(approval, text);
    const label = (closed?.label || "Respondida") + (approval.decidedAt ? " · " + time(approval.decidedAt) : "");
    return <div id={id}><AnsweredLine approval={approval} question={plain(steps.length > 1 ? `${steps.length} preguntas de ${bots.find((b) => b.id === approval.botId)?.name || "un bot"}` : steps[0].question)} label={label} answers={approval.answers} /></div>;
  }
  return (
    <div id={id} style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
      <QuestionSteps approval={approval} text={text} />
      <WaitNote approval={approval} bots={bots} />
    </div>
  );
}

export default withRowBoundary(QuestionCard, { label: "No se ha podido mostrar esta pregunta", resetKey: ({ approval, text }) => `${approval?.id}:${approval?.revision}:${approval?.status}:${String(text || "").length}` });
