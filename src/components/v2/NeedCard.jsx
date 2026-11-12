import { useEffect, useRef, useState } from "react";
import { NoteAsk } from "../wiki/NoteDiff.jsx";
import QuestionFlow from "./chat/QuestionFlow.jsx";
import { QuestionReply } from "../room/QuestionReply.jsx";
import { post } from "../../lib/api.js";
import { roomUrl, time } from "../../lib/format.js";
import { cancel, schedule, useUndoable } from "../../lib/undoable.js";
import { later } from "../../lib/undoToast.js";
import { failureText, groupLine, groupShown, groupTitle } from "../../lib/approvalGroups.js";
import { needsHold } from "../../lib/holdApprove.js";
import { decideBatch, useBatchFailures } from "../../lib/useApprovalBatch.js";
import { letterOf, letterStyle, useChoiceKeys } from "../../lib/choiceKeys.js";
import { isSnoozed, snoozeWhen } from "../../lib/snooze.js";
import { useStore } from "../../lib/store.jsx";
import HoldButton from "../HoldButton.jsx";
import { withRowBoundary } from "../RowBoundary.jsx";
import { BotPresence } from "./Presence.jsx";
import SnoozeMenu, { snooze } from "./SnoozeMenu.jsx";

// «Te necesitan» cards of Colmena 2.0 (design/V2Hoy.dc.html): the only honey on the screen.
// A send shows what goes out and to whom; «Aprobar y enviar» waits 10 s with «Deshacer».
// A question shows its options; your choice also waits 10 s before it is given.
// Several requests of the same kind in a row fold into one card with «Aprobar todas»
// (NeedGroupCard); a send or any other red line is approved by holding its button.
// «Recordar después» (SnoozeMenu.jsx) puts a request off until a time unless a deadline would
// pass first; a card put off turns calm and says when it comes back. A question's options
// read A, B, C… and the letter key answers (lib/choiceKeys.js). A card that fails to draw
// becomes one muted pill (RowBoundary.jsx).
export const HONEY = "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.16), 0 30px 60px -30px rgba(201,138,0,.6)";
export const CALM = "0 1px 2px rgba(18,19,26,.05), 0 16px 40px -22px rgba(18,19,26,.16)";

const tag = (label) => (
  <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "600", color: "#8A5A00" }}>
    <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#FFC93C", animation: "halo 1.8s ease-out infinite" }} />
    {label}
  </span>
);
const QUIET = { height: "50px", padding: "0 14px", border: "0", background: "transparent", cursor: "pointer", fontSize: "15px", fontWeight: "500", color: "#5C606C" };
const APPROVE = { flex: "1", height: "50px", padding: "0 22px", border: "0", borderRadius: "999px", background: "#FFC93C", cursor: "pointer", fontSize: "15px", fontWeight: "600" };
const ext = (name) => (String(name || "").split(".").pop() || "").slice(0, 4).toUpperCase();
const EXT_TINT = { PDF: ["#FBE7DF", "#8E2A1F"], XLSX: ["#E1F4EC", "#0B5A3E"], CSV: ["#E1F4EC", "#0B5A3E"], DOCX: ["#E3EAFB", "#1F3F99"], PPTX: ["#FBEADF", "#8A3B12"] };

function Header({ bot, who, mission, at, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <BotPresence bot={bot} size={30} state="rest" />
      <span style={{ flex: "1", fontSize: "14px", color: "#5C606C" }}>
        <strong style={{ color: "#12131A", fontWeight: "600" }}>{bot?.name || "Un bot"}</strong>
        {who ? " · " + who : null}
        {mission && !mission.conversation ? <>{" · en "}<a href={roomUrl(mission)} style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>{"#" + (mission.room || mission.title)}</a></> : null}
        {at ? " · " + time(at) : null}
      </span>
      {label ? tag(label) : null}
    </div>
  );
}

function Countdown({ id, onUndo, text = "Se envía en" }) {
  const { secs, fraction } = useUndoable(id);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", animation: "fade .3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <span role="status" style={{ fontSize: "15px", fontWeight: "500" }}>{`${text} ${secs} s`}</span>
        <button type="button" onClick={onUndo} style={{ height: "40px", padding: "0 18px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>{"Deshacer"}</button>
      </div>
      <span style={{ height: "4px", borderRadius: "2px", background: "rgba(18,19,26,.08)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", background: "#12131A", transition: "width .25s linear", width: Math.round(fraction * 100) + "%" }} />
      </span>
    </div>
  );
}

function Sent({ text }) {
  return (
    <span role="status" style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "15px", fontWeight: "500", color: "#0B6B4A", animation: "fade .3s ease-out" }}>
      <span aria-hidden="true" style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: "#0B8A5F", animation: "pop .4s ease-out" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
      </span>
      {text}
    </span>
  );
}

/** «Pospuesto: vuelve mañana a las 9:00 · Traer de vuelta» on a card you put off. */
function SnoozedLine({ items, onError }) {
  const { run } = useStore();
  const [busy, setBusy] = useState(false);
  const back = async () => {
    if (busy) return;
    setBusy(true);
    onError(null);
    try { await run(() => snooze(items, null)); } catch (e) { onError(e?.message || "No se pudo traer de vuelta."); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
      <span role="status" style={{ flex: "1", minWidth: "200px", fontSize: "15px", color: "#5C606C" }}>{`${items.length > 1 ? "Pospuestas: vuelven" : "Pospuesto: vuelve"} ${snoozeWhen(items[0].snoozedUntil)}.`}</span>
      <button type="button" disabled={busy} onClick={back} style={{ height: "40px", padding: "0 18px", border: "0", borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>{"Traer de vuelta"}</button>
    </div>
  );
}

// A request that cannot be drawn is still decided in Revisar.
const guard = { label: "No se ha podido mostrar esta petición", action: ({ a }) => (a?.id && a.status === "pending" && a.kind !== "question" ? { href: `/revisar/${a.id}`, text: "Abrir en Revisar" } : null), resetKey: ({ a }) => `${a?.id}:${a?.revision}:${a?.status}` };

/** One approval (send, permission, plan…) or question waiting for you. */
export const NeedCard = withRowBoundary(function NeedCard({ a, bot, mission, settled = null, inline = false }) {
  const key = "approval:" + a.id;
  const { waiting } = useUndoable(key);
  const [error, setError] = useState(null);
  const [choice, setChoice] = useState(null);
  const failures = useBatchFailures(); // why «Aprobar todas» could not decide this one
  useEffect(() => {
    const onFail = (e) => { if (e.detail?.id === key) setError(e.detail.message || "No se pudo completar. Vuelve a intentarlo."); };
    window.addEventListener("colmena:undo-failed", onFail);
    return () => window.removeEventListener("colmena:undo-failed", onFail);
  }, [key]);
  const isSend = a.kind === "send";
  const isQuestion = a.kind === "question";
  const approve = () => {
    setError(null);
    schedule(key, async () => {
      await post(`/approvals/${a.id}`, { decision: "approved", revision: a.revision });
    });
  };
  const pick = (o) => {
    setError(null);
    setChoice(o.id);
    schedule(key, async () => {
      await post(`/approvals/${a.id}/answer`, { optionId: o.id, revision: a.revision });
    });
  };
  const undo = () => { cancel(key); setChoice(null); };
  const email = a.email;
  const label = isSend ? "Aprobar" : isQuestion ? "Decidir" : a.kind === "plan" ? "Revisar" : "Aprobar";
  const options = a.options || [];
  const primary = Math.max(0, options.findIndex((o) => o.primary));
  const snoozed = isSnoozed(a);
  // A, B, C… answer while this is the question in focus (or the last one waiting on screen).
  const single = isQuestion && !(a.questions?.length > 1);
  const keys = useChoiceKeys({ count: options.length, enabled: single && !settled && !waiting && !snoozed, onChoose: (i) => pick(options[i]) });

  if (settled) {
    return (
      <article style={{ padding: "26px", background: "#FFFFFF", borderRadius: "30px", display: "flex", flexDirection: "column", gap: "18px", transition: "box-shadow .5s ease", boxShadow: CALM }}>
        <Header bot={bot} mission={mission} at={a.createdAt} />
        <h3 style={{ margin: "0", font: "600 24px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.025em" }}>{a.title}</h3>
        <Sent text={settled} />
      </article>
    );
  }
  return (
    <article ref={keys} style={{ padding: "26px", background: "#FFFFFF", borderRadius: inline ? "28px" : "30px", display: "flex", flexDirection: "column", gap: "18px", transition: "box-shadow .5s ease", boxShadow: waiting || snoozed ? CALM : HONEY, animation: inline ? "rise .4s ease-out" : undefined }}>
      {inline ? (snoozed ? null : tag("Te necesita")) : <Header bot={bot} who={a.external ? "fuera de tu empresa" : null} mission={mission} at={a.createdAt} label={snoozed ? null : label} />}
      <h3 style={{ margin: "0", font: inline ? "600 22px/1.25 'Bricolage Grotesque', sans-serif" : "600 24px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: inline ? "-0.02em" : "-0.025em" }}>{isSend && email?.subject ? `Enviar «${email.subject}»` : isQuestion && a.questions?.length > 1 ? `${bot?.name || "El bot"} tiene ${a.questions.length} preguntas` : a.title}</h3>
      {isSend && email ? (
        <div style={{ padding: "18px", background: "#F6F6F3", borderRadius: "20px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "15px", lineHeight: "1.55" }}>
          <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{"Para " + (email.to || []).join(", ")}</span>
          <span style={{ display: "-webkit-box", WebkitLineClamp: "3", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{String(email.body || "").replace(/\s+/g, " ").trim()}</span>
          {(email.attachments || []).map((f, i) => {
            const e = ext(f.name || f);
            const [bg, fg] = EXT_TINT[e] || ["#EEF0F4", "#4A4F5C"];
            return (
              <span key={i} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px 6px 6px", background: "#FFFFFF", borderRadius: "12px", fontSize: "13px" }}>
                <span aria-hidden="true" style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", borderRadius: "8px", background: bg, color: fg, font: "600 9px/1 'Geist Mono', monospace" }}>{e}</span>
                {f.name || f}
              </span>
            );
          })}
        </div>
      ) : !isQuestion && a.summary ? (
        <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#3D404A" }}>{a.summary}</p>
      ) : null}
      {/* A note of «Notas» the bot wants to write: which one, and the lines it adds and removes. */}
      {a.wiki && !snoozed ? <NoteAsk id={a.id} wiki={a.wiki} compact={inline} /> : null}
      {snoozed ? (
        <SnoozedLine items={[a]} onError={setError} />
      ) : isQuestion && a.questions?.length > 1 ? (
        // Several questions: one at a time (QuestionFlow.jsx).
        <>
          <QuestionFlow approval={a} />
          <div style={{ display: "flex" }}><SnoozeMenu items={[a]} style={{ ...QUIET, height: "40px", padding: "0 10px" }} onError={setError} /></div>
        </>
      ) : isQuestion ? (
        <>
          {a.summary && a.summary !== a.title ? <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#3D404A" }}>{a.summary}</p> : null}
          <div role="radiogroup" aria-label={a.title} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {options.map((o, i) => {
              const on = choice === o.id;
              return (
                <button key={o.id || i} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-keyshortcuts={letterOf(i) || undefined} disabled={waiting && !on} onClick={() => (on ? undo() : pick(o))}
                  style={{ display: "flex", alignItems: "center", gap: "14px", minHeight: "56px", padding: "0 18px", textAlign: "left", borderRadius: "18px", cursor: "pointer", transition: "all .25s ease", background: on ? "#12131A" : "#F6F6F3", color: on ? "#FFFFFF" : "#12131A", border: on ? "1px solid #12131A" : "1px solid transparent" }}>
                  {letterOf(i) ? <span aria-hidden="true" style={letterStyle(on, 24)}>{letterOf(i)}</span> : null}
                  <span style={{ flex: "1", fontSize: "15px", fontWeight: "600" }}>{o.label}</span>
                  {i === primary && options.length > 1 ? <span style={{ fontSize: "13px", opacity: ".7" }}>{"Recomendada"}</span> : null}
                </button>
              );
            })}
          </div>
          {waiting ? <Countdown id={key} onUndo={undo} text="Se decide en" /> : (
            <>
              <QuestionReply approval={a} />
              <div style={{ display: "flex" }}><SnoozeMenu items={[a]} style={{ ...QUIET, height: "40px", padding: "0 10px" }} onError={setError} /></div>
            </>
          )}
        </>
      ) : waiting ? (
        <Countdown id={key} onUndo={undo} text={isSend ? "Se envía en" : "Se aprueba en"} />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          <a href={a.kind === "plan" && a.missionId ? `/sala/${a.missionId}#plan` : `/revisar/${a.id}`} style={{ display: "flex", alignItems: "center", height: "50px", padding: "0 22px", borderRadius: "999px", background: "rgba(18,19,26,.06)", fontSize: "15px", fontWeight: "600" }}>{"Revisar"}</a>
          {a.kind === "secret" || a.kind === "plan" ? null : needsHold(a) ? (
            <HoldButton onConfirm={approve} fill="rgba(18,19,26,.16)" style={APPROVE}>{isSend ? "Aprobar y enviar" : "Aprobar"}</HoldButton>
          ) : (
            <button type="button" onClick={approve} style={APPROVE}>{isSend ? "Aprobar y enviar" : "Aprobar"}</button>
          )}
          <SnoozeMenu items={[a]} style={QUIET} onError={setError} />
        </div>
      )}
      {error || failures.get(a.id) ? <span role="alert" style={{ fontSize: "14px", color: "#B4372A" }}>{error || failures.get(a.id)}</span> : null}
    </article>
  );
}, guard);

/**
 * Several requests of the same kind from one bot, one after another, as one card: what each
 * one is, «Aprobar todas» (10 s with «Deshacer»), «Ver cada una» (the usual cards, each
 * decided alone) and «No permitir» for all of them. Never a red line.
 */
export const NeedGroupCard = withRowBoundary(function NeedGroupCard({ group, bot, mission, inline = false }) {
  const key = "approvals:" + group.id;
  const { waiting } = useUndoable(key);
  const failures = useBatchFailures();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const toggle = useRef(null);
  const moved = useRef(false);
  useEffect(() => {
    const onFail = (e) => { if (e.detail?.id === key) setError(e.detail.message || "No se pudo completar. Vuelve a intentarlo."); };
    window.addEventListener("colmena:undo-failed", onFail);
    return () => window.removeEventListener("colmena:undo-failed", onFail);
  }, [key]);
  // «Ver cada una» ↔ «Ver juntas» swap places: the keyboard stays on the one that replaced it.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    toggle.current?.focus();
  }, [open]);
  const flip = () => { moved.current = true; setOpen((v) => !v); };
  const items = group.items;
  const heading = groupTitle(group, bot?.name);
  const listed = groupShown(items);
  const snoozed = items.every((a) => isSnoozed(a));
  const approve = () => {
    setError(null);
    schedule(key, async () => {
      const left = await decideBatch(items, "approved");
      if (left) throw Error(failureText(left, "approved"));
    });
  };
  const deny = () => {
    setError(null);
    later({
      id: "deny:" + group.id, keys: items.map((a) => "approval:" + a.id), text: "No se permiten", error: "No se pudieron descartar",
      run: async () => { const left = await decideBatch(items, "denied"); if (left) throw Error(failureText(left, "denied")); },
    });
  };
  const quiet = QUIET;
  if (open) {
    return (
      <div role="group" aria-label={heading} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "0 6px" }}>
          <span style={{ flex: "1", minWidth: 0, fontSize: "15px", fontWeight: "600" }}>{heading}</span>
          <button ref={toggle} type="button" aria-expanded="true" onClick={flip} style={{ ...quiet, height: "40px" }}>{"Ver juntas"}</button>
        </div>
        {items.map((a) => <NeedCard key={a.id} a={a} bot={bot} mission={mission} inline={inline} />)}
      </div>
    );
  }
  return (
    <article aria-label={heading} style={{ padding: "26px", background: "#FFFFFF", borderRadius: inline ? "28px" : "30px", display: "flex", flexDirection: "column", gap: "18px", transition: "box-shadow .5s ease", boxShadow: waiting || snoozed ? CALM : HONEY, animation: inline ? "rise .4s ease-out" : undefined }}>
      {inline ? (snoozed ? null : tag("Te necesita")) : <Header bot={bot} mission={mission} at={items[0].createdAt} label={snoozed ? null : "Aprobar"} />}
      <h3 style={{ margin: "0", font: inline ? "600 22px/1.25 'Bricolage Grotesque', sans-serif" : "600 24px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: inline ? "-0.02em" : "-0.025em" }}>{heading}</h3>
      <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
        {listed.shown.map((a) => (
          <li key={a.id} style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "15px", lineHeight: "1.5", color: "#3D404A" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupLine(a, bot?.name, group.label)}</span>
            {failures.has(a.id) ? <span style={{ fontSize: "14px", color: "#B4372A" }}>{failures.get(a.id)}</span> : null}
          </li>
        ))}
        {listed.more ? <li style={{ fontSize: "14px", color: "#6B6F7A" }}>{`y ${listed.more} más`}</li> : null}
      </ul>
      {snoozed ? (
        <SnoozedLine items={items} onError={setError} />
      ) : waiting ? (
        <Countdown id={key} onUndo={() => cancel(key)} text="Se aprueban en" />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          <button ref={toggle} type="button" aria-expanded="false" onClick={flip} style={{ height: "50px", padding: "0 22px", border: "0", borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "15px", fontWeight: "600" }}>{"Ver cada una"}</button>
          <button type="button" onClick={approve} style={APPROVE}>{"Aprobar todas"}</button>
          <button type="button" onClick={deny} style={quiet}>{"No permitir"}</button>
          <SnoozeMenu items={items} style={quiet} onError={setError} />
        </div>
      )}
      {error ? <span role="alert" style={{ fontSize: "14px", color: "#B4372A" }}>{error}</span> : null}
    </article>
  );
}, { label: "No se han podido mostrar estas peticiones", resetKey: ({ group }) => group?.id + ":" + group?.items?.length });

/** A room that waits for you to pick a proposal or approve a plan. */
export function ChoiceCard({ m, bots }) {
  const lead = bots.find((b) => b.id === (m.botIds?.[0] || "atlas")) || bots.find((b) => b.id === "atlas");
  const isPlan = m.status === "awaiting_plan";
  return (
    <article style={{ padding: "26px", background: "#FFFFFF", borderRadius: "30px", display: "flex", flexDirection: "column", gap: "18px", boxShadow: HONEY }}>
      <Header bot={lead} mission={m} at={m.updatedAt} label={isPlan ? "Revisar" : "Elegir"} />
      <h3 style={{ margin: "0", font: "600 24px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.025em" }}>{m.title}</h3>
      <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#3D404A" }}>{isPlan ? "El plan está listo. Revísalo y dale el OK para que empiecen." : m.activityLine || "Las propuestas están listas: elige una."}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        <a href={isPlan ? `/encargo/${m.id}` : `/debate/${m.id}`} style={{ flex: "1", display: "flex", alignItems: "center", justifyContent: "center", height: "50px", padding: "0 22px", borderRadius: "999px", background: "#FFC93C", fontSize: "15px", fontWeight: "600" }}>{isPlan ? "Revisar el plan" : "Ver las propuestas"}</a>
      </div>
    </article>
  );
}
