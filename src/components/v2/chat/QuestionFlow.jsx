import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp } from "../../Icon.js";
import { post } from "../../../lib/api.js";
import { useAction } from "../../../lib/store.jsx";
import { choiceIndex, letterOf, useChoiceKeys } from "../../../lib/choiceKeys.js";

// Several questions from a bot, one at a time (after shadcn's Questionnaire and assistant-ui
// question-flow): «Pregunta 2 de 3», the options with their letter (keys A/B/C choose, for
// the question you are on; 1/2/3 still work with the focus inside the card), a
// free answer beside them, «Saltar» on the optional ones, and the focus moving to the next
// question. The answers go together at the end (server/questions.mjs).

const btn = { height: "40px", padding: "0 16px", border: 0, borderRadius: "var(--r-pill)", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 600 };

export default function QuestionFlow({ approval }) {
  const questions = approval?.questions || [];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({}); // id → { optionId?, text?, skipped? }
  const { act, busy, error } = useAction();
  const heading = useRef(null);
  const first = useRef(true);
  const q = questions[step];
  const current = answers[q?.id] || {};
  const last = step === questions.length - 1;
  // The focus follows the question you are on (not on the first paint: the chat keeps it).
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  // A, B, C… answer the question you are on, while this card has the focus or is the last
  // question waiting on screen, and you are not typing (lib/choiceKeys.js).
  const root = useChoiceKeys({ count: q?.options?.length || 0, enabled: !busy, onChoose: (i) => choose(q.options[i]) });
  if (!q) return null;
  const set = (patch) => setAnswers((all) => ({ ...all, [q.id]: { ...patch } }));
  const answered = (a) => !!(a?.optionId || String(a?.text || "").trim() || a?.skipped);
  const send = (all) => act(() => post(`/approvals/${approval.id}/answer`, {
    revision: approval.revision,
    answers: questions.map((x) => ({ id: x.id, ...(all[x.id]?.optionId ? { optionId: all[x.id].optionId } : {}), ...(String(all[x.id]?.text || "").trim() ? { text: all[x.id].text.trim() } : {}), ...(all[x.id]?.skipped ? { skipped: true } : {}) })),
  }));
  const next = (all = answers) => {
    if (!answered(all[q.id])) return;
    if (last) send(all);
    else setStep(step + 1);
  };
  const choose = (o) => {
    const all = { ...answers, [q.id]: { optionId: o.id } };
    setAnswers(all);
    // Choosing an option is the answer: on to the next one.
    if (!last) setTimeout(() => setStep((s) => Math.min(s + 1, questions.length - 1)), 180);
  };
  const skip = () => { const all = { ...answers, [q.id]: { skipped: true } }; setAnswers(all); next(all); };
  const onKeyDown = (e) => {
    if (e.target?.tagName === "INPUT" || e.altKey || e.ctrlKey || e.metaKey) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= q.options.length) { e.preventDefault(); choose(q.options[n - 1]); return; }
    // The letters, here too: the page-level listener leaves a key already handled alone.
    const at = choiceIndex(e, q.options.length);
    if (at >= 0) { e.preventDefault(); choose(q.options[at]); }
  };
  return (
    <div ref={root} role="group" aria-label={`Pregunta ${step + 1} de ${questions.length}`} onKeyDown={onKeyDown} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ font: "500 var(--t-caption)/1 'Geist Mono', monospace", color: "var(--c-text-3)" }}>{`${step + 1} de ${questions.length}`}</span>
        <span aria-hidden="true" style={{ display: "flex", gap: "4px" }}>
          {questions.map((x, i) => <span key={x.id} style={{ width: i === step ? "18px" : "6px", height: "6px", borderRadius: "var(--r-xs)", background: i < step || answered(answers[x.id]) ? "#12131A" : i === step ? "#12131A" : "rgb(var(--c-ink-rgb) / .15)", transition: "width .2s ease, background .2s ease" }} />)}
        </span>
        {q.optional ? <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{"Opcional"}</span> : null}
      </div>
      <h4 ref={heading} tabIndex={-1} key={q.id} style={{ margin: 0, font: "600 var(--t-title)/1.3 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.015em", animation: "rise .25s ease-out" }}>{q.question}</h4>
      {q.options.length ? (
        <div role="radiogroup" aria-label={q.question} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {q.options.map((o, i) => {
            const on = current.optionId === o.id;
            return (
              <button key={o.id} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-keyshortcuts={letterOf(i) || String(i + 1)} onClick={() => choose(o)} className="rm-focus"
                style={{ display: "flex", alignItems: "center", gap: "14px", minHeight: "52px", padding: "0 16px", textAlign: "left", borderRadius: "var(--r-lg)", cursor: "pointer", transition: "all .2s ease", background: on ? "var(--c-btn)" : "var(--c-hover)", color: on ? "var(--c-btn-text)" : "var(--c-text)", border: 0 }}>
                <span aria-hidden="true" style={{ width: "24px", height: "24px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: on ? "rgba(255,255,255,.16)" : "var(--c-card)", font: "600 var(--t-caption)/1 'Geist Mono', monospace", color: on ? "#FFFFFF" : "#5C606C" }}>{letterOf(i) || i + 1}</span>
                <span style={{ flex: "1", fontSize: "var(--t-body)", fontWeight: 600 }}>{o.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <form className="c-ring" onSubmit={(e) => { e.preventDefault(); next(); }} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 4px 4px 16px", borderRadius: "var(--r-pill)", background: "var(--c-hover)" }}>
        <label style={{ flex: "1", minWidth: 0, display: "flex" }}>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Tu respuesta"}</span>
          <input className="c-bare" value={current.text || ""} onChange={(e) => set({ text: e.target.value })} placeholder={q.options.length ? "O escribe tu respuesta…" : "Tu respuesta…"} maxLength={4000} autoFocus={step > 0 && !q.options.length}
            style={{ flex: "1", minWidth: 0, height: "40px", border: 0, background: "transparent", fontSize: "var(--t-body)", fontFamily: "inherit", color: "var(--c-text)" }} />
        </label>
        <button type="submit" aria-label={last ? "Enviar las respuestas" : "Siguiente pregunta"} disabled={!String(current.text || "").trim()} className="rm-focus"
          style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: String(current.text || "").trim() ? "var(--c-btn)" : "#C9CBD1", color: "var(--c-btn-text)", cursor: "pointer" }}>
          <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </form>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        {step > 0 ? <button type="button" onClick={() => setStep(step - 1)} style={{ ...btn, display: "flex", alignItems: "center", gap: "6px", background: "transparent", color: "var(--c-text-2)", padding: "0 12px" }}><ArrowLeft size={15} strokeWidth={2.4} aria-hidden="true" />{"Atrás"}</button> : null}
        <span style={{ flex: "1" }} />
        {q.optional ? <button type="button" onClick={skip} disabled={busy} style={{ ...btn, background: "rgb(var(--c-ink-rgb) / .06)", color: "var(--c-text)" }}>{"Saltar"}</button> : null}
        {last ? <button type="button" onClick={() => next()} disabled={busy || !answered(current)} style={{ ...btn, background: answered(current) ? "var(--c-btn)" : "#C9CBD1", color: "var(--c-btn-text)", cursor: answered(current) ? "pointer" : "default" }}>{busy ? "Enviando…" : "Enviar respuestas"}</button>
          : <button type="button" onClick={() => next()} disabled={!answered(current)} style={{ ...btn, background: answered(current) ? "var(--c-btn)" : "#C9CBD1", color: "var(--c-btn-text)", cursor: answered(current) ? "pointer" : "default" }}>{"Siguiente"}</button>}
      </div>
      {error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--c-error)", fontWeight: 600 }}>{error}</span> : null}
    </div>
  );
}

/** Your answers to several questions, once answered (under its closed chip). */
export function AnswerList({ answers = [] }) {
  if (!answers?.length) return null;
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
      {answers.map((a, i) => (
        <li key={a.id || i} style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--t-ui)", lineHeight: "1.45" }}>
          <span style={{ color: "var(--c-text-3)" }}>{a.question}</span>
          <strong style={{ fontWeight: 600, color: a.skipped ? "#666A75" : "var(--c-text)" }}>{a.skipped ? "Sin responder" : a.text || a.label}</strong>
        </li>
      ))}
    </ol>
  );
}
