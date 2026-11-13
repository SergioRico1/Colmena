import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleCheck, X } from "../../Icon.js";
import { post } from "../../../lib/api.js";
import { useAction } from "../../../lib/store.jsx";
import { choiceIndex, letterOf, useChoiceKeys } from "../../../lib/choiceKeys.js";
import ApprovalConflict from "../../room/ApprovalConflict.jsx";
import "../../../styles/conversation.css";

// A bot's question, one step at a time (Colmena 4: design/v4/colmena-v4.html › .q): the question,
// «1 de 5», the options as rows lettered A, B, C… (the letter key answers while this card has
// the focus or is the last question waiting on screen, and you are not typing; 1/2/3 still work
// inside the card), «Otra respuesta…» to write your own, and Volver · the dots · Siguiente. Several
// questions are answered one by one and sent together at the end (server/questions.mjs); a
// single question is answered as soon as you pick (or send what you wrote).
//
//   <QuestionSteps approval={a} text={m.text} />          the framed card (a conversation)
//   <QuestionFlow approval={a} />                         the same steps without a frame (inside
//                                                          another card: Inicio, a need row)

/** The steps a request asks: its several questions, or itself as one. */
export function stepsOf(approval, text = "") {
  if (approval?.questions?.length > 1) return approval.questions.map((q) => ({ id: q.id, question: q.question, options: q.options || [], optional: !!q.optional }));
  return [{ id: "main", question: approval?.summary || approval?.title || text || "", options: approval?.options || [], optional: false }];
}

const detailOf = (o) => o?.detail || o?.description || o?.hint || null;

export function QuestionSteps({ approval, text = "", framed = true, title = null, onDone = null }) {
  const steps = stepsOf(approval, text);
  const multi = steps.length > 1;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({}); // id → { optionId?, text?, skipped? }
  const [other, setOther] = useState(false); // «Otra respuesta…» open on this step
  const { act, busy, error, conflict } = useAction();
  const heading = useRef(null);
  const otherInput = useRef(null);
  const first = useRef(true);
  const q = steps[step];
  const current = answers[q?.id] || {};
  const last = step === steps.length - 1;
  const pending = approval?.status === "pending";
  // The focus follows the question you are on (not on the first paint: the chat keeps it).
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => { setOther(!!String(answers[q?.id]?.text || "")); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (other) otherInput.current?.focus(); }, [other]);
  const count = (q?.options?.length || 0) + 1; // the options and «Otra respuesta…»
  const root = useChoiceKeys({ count: pending ? count : 0, enabled: pending && !busy, onChoose: (i) => pickAt(i) });
  if (!q) return null;

  const answered = (a) => !!(a?.optionId || String(a?.text || "").trim() || a?.skipped);
  const sendAll = (all) => act(async () => {
    if (!multi) {
      const a = all[q.id] || {};
      await post(`/approvals/${approval.id}/answer`, a.optionId ? { optionId: a.optionId, revision: approval.revision } : { text: String(a.text || "").trim(), revision: approval.revision });
    } else {
      await post(`/approvals/${approval.id}/answer`, {
        revision: approval.revision,
        answers: steps.map((x) => ({ id: x.id, ...(all[x.id]?.optionId ? { optionId: all[x.id].optionId } : {}), ...(String(all[x.id]?.text || "").trim() ? { text: all[x.id].text.trim() } : {}), ...(all[x.id]?.skipped ? { skipped: true } : {}) })),
      });
    }
    onDone?.();
  });
  const next = (all = answers) => {
    if (!answered(all[q.id]) || busy) return;
    if (last) sendAll(all);
    else setStep(step + 1);
  };
  const choose = (o) => {
    const all = { ...answers, [q.id]: { optionId: o.id } };
    setAnswers(all);
    setOther(false);
    // One question: picking is the answer. Several: on to the next one (sent together at the end).
    if (!multi) sendAll(all);
    else if (!last) setTimeout(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 180);
  };
  function pickAt(i) {
    if (i < q.options.length) choose(q.options[i]);
    else { setOther(true); requestAnimationFrame(() => otherInput.current?.focus()); }
  }
  const skip = () => { const all = { ...answers, [q.id]: { skipped: true } }; setAnswers(all); next(all); };
  const dismiss = () => act(async () => { await post(`/approvals/${approval.id}/dismiss`, { revision: approval.revision }); onDone?.(); });
  const onKeyDown = (e) => {
    if (e.target?.tagName === "INPUT" || e.altKey || e.ctrlKey || e.metaKey) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= count) { e.preventDefault(); pickAt(n - 1); return; }
    // The letters, here too: the page-level listener leaves a key already handled alone.
    const at = choiceIndex(e, count);
    if (at >= 0) { e.preventDefault(); pickAt(at); }
  };
  const typed = String(current.text || "");
  const otherLetter = letterOf(q.options.length);
  const sub = q.options.length ? "Elige una o escribe la tuya. Pulsa la letra para responder." : "Escribe tu respuesta.";

  const body = (
    <div ref={root} role="group" aria-label={multi ? `Pregunta ${step + 1} de ${steps.length}` : title || "Pregunta"} onKeyDown={onKeyDown} style={{ display: "flex", flexDirection: "column" }}>
      <div className="v4-q-h" style={framed ? null : { padding: "0 0 4px" }}>
        {/* Not a heading: the card sits under the room's h1 or inside another card's own outline. */}
        <p ref={heading} tabIndex={-1} key={q.id} className="t" style={{ margin: 0, outline: "none", animation: step ? "rise .2s ease-out" : undefined }}>{q.question}</p>
        {multi ? <span className="c">{`${step + 1} de ${steps.length}`}</span> : null}
      </div>
      <div className="v4-q-sub" style={framed ? null : { padding: "0 0 10px" }}>{q.optional ? sub + " Es opcional." : sub}</div>
      <div className="v4-opts" role="radiogroup" aria-label={q.question} style={framed ? null : { padding: "0 0 12px" }}>
        {q.options.map((o, i) => {
          const on = current.optionId === o.id;
          return (
            <button key={o.id || i} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-keyshortcuts={letterOf(i) || String(i + 1)} disabled={busy || !pending} onClick={() => choose(o)} className="v4-opt">
              <span aria-hidden="true" className="v4-kbd">{letterOf(i) || i + 1}</span>
              <span className="ot">{o.label}{detailOf(o) ? <span className="os">{detailOf(o)}</span> : null}</span>
              {on ? <CircleCheck size={18} weight="fill" className="ok" /> : null}
            </button>
          );
        })}
        {other ? (
          <form className="v4-opt" onSubmit={(e) => { e.preventDefault(); next(); }} style={{ cursor: "text", borderColor: "var(--c-accent)", alignItems: "center" }}>
            <span aria-hidden="true" className="v4-kbd">{otherLetter}</span>
            <label style={{ flex: 1, minWidth: 0, display: "flex" }}>
              <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Tu respuesta"}</span>
              <input ref={otherInput} className="c-bare" value={typed} onChange={(e) => setAnswers((all) => ({ ...all, [q.id]: { text: e.target.value } }))} placeholder="Escribe tu respuesta…" maxLength={4000} disabled={busy || !pending}
                onKeyDown={(e) => { if (e.key === "Escape" && !typed) { e.preventDefault(); setOther(false); } }}
                style={{ flex: 1, minWidth: 0, height: "22px", border: 0, background: "transparent", font: "500 var(--t-ui)/1.35 inherit", color: "var(--c-text)" }} />
            </label>
          </form>
        ) : (
          <button type="button" role="radio" aria-checked="false" aria-keyshortcuts={otherLetter || undefined} disabled={busy || !pending} onClick={() => pickAt(q.options.length)} className="v4-opt other">
            <span aria-hidden="true" className="v4-kbd">{otherLetter || "+"}</span>
            <span className="ot">{"Otra respuesta…"}</span>
          </button>
        )}
      </div>
      <div className="v4-q-f" style={framed ? null : { padding: "10px 0 0" }}>
        {multi && step > 0
          ? <button type="button" className="v4-btn ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={15} />{"Volver"}</button>
          : <button type="button" className="v4-btn ghost" disabled={busy || !pending} onClick={dismiss} title="Se cierra sin respuesta; el bot sigue con la opción más prudente y te lo dice"><X size={15} />{"Descartar"}</button>}
        {multi ? (
          <span className="v4-pips" aria-hidden="true">{steps.map((x, i) => <i key={x.id} className={i === step ? "on" : answered(answers[x.id]) ? "done" : undefined} />)}</span>
        ) : <span style={{ flex: 1 }} />}
        {q.optional ? <button type="button" className="v4-btn ghost" onClick={skip} disabled={busy}>{"Saltar"}</button> : null}
        {multi || other ? (
          <button type="button" className="v4-btn primary" onClick={() => next()} disabled={busy || !pending || !answered(current)}>
            {busy ? "Enviando…" : last ? (multi ? "Enviar respuestas" : "Responder") : "Siguiente"}{!busy && !last ? <ArrowRight size={15} /> : null}
          </button>
        ) : null}
      </div>
      {error && !conflict ? <span role="alert" style={{ marginTop: "8px", padding: framed ? "0 12px 10px" : 0, fontSize: "var(--t-meta)", color: "var(--c-error)", fontWeight: 600 }}>{error}</span> : null}
      <ApprovalConflict error={error} conflict={conflict} />
    </div>
  );
  return framed ? <div className="v4-q">{body}</div> : body;
}

/** Several questions inside another card (Inicio, a need row): the steps without a frame. */
export default function QuestionFlow({ approval }) {
  return <QuestionSteps approval={approval} framed={false} />;
}

/** Your answers to several questions, once answered (under its closed line). */
export function AnswerList({ answers = [] }) {
  if (!answers?.length) return null;
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
      {answers.map((a, i) => (
        <li key={a.id || i} style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--t-ui)", lineHeight: "1.45" }}>
          <span style={{ color: "var(--c-text-3)" }}>{a.question}</span>
          <strong style={{ fontWeight: 600, color: a.skipped ? "var(--c-text-4)" : "var(--c-text)" }}>{a.skipped ? "Sin responder" : a.text || a.label}</strong>
        </li>
      ))}
    </ol>
  );
}

/** An answered question in one line: what it asked and what you said; the rest on request. */
export function AnsweredLine({ approval, question, label, answers = [] }) {
  const [open, setOpen] = useState(false);
  const many = answers?.length > 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "min(540px, 100%)" }}>
      <div className="v4-q-done" data-closed={approval?.status || undefined}>
        <CircleCheck size={16} weight="fill" style={{ flex: "none", color: "var(--c-text-3)" }} />
        <span className="q" title={question}>{question}</span>
        <b style={{ flex: "none", maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>{label}</b>
        {many ? <button type="button" className="v4-lnk" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Ocultar" : `Ver las ${answers.length}`}</button> : null}
      </div>
      {many && open ? <div style={{ padding: "0 12px" }}><AnswerList answers={answers} /></div> : null}
    </div>
  );
}
