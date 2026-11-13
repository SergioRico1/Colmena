import { useEffect, useRef, useState } from "react";
import { Check } from "../Icon.js";
import { NoteAsk } from "../wiki/NoteDiff.jsx";
import QuestionFlow from "./chat/QuestionFlow.jsx";
import { QuestionReply } from "../room/QuestionReply.jsx";
import { post } from "../../lib/api.js";
import { placeName, roomUrl, time } from "../../lib/format.js";
import { cancel, schedule, useUndoable } from "../../lib/undoable.js";
import { later } from "../../lib/undoToast.js";
import { failureText, groupLine, groupShown, groupTitle } from "../../lib/approvalGroups.js";
import { GROUP_VERBS } from "../../lib/approvalCard.js";
import { ApprovalNotes, SendWhat, useApprovalCard } from "../ApprovalParts.jsx";
import { decideBatch, useBatchFailures } from "../../lib/useApprovalBatch.js";
import { letterOf, letterStyle, useChoiceKeys } from "../../lib/choiceKeys.js";
import { isSnoozed, snoozeWhen } from "../../lib/snooze.js";
import { useStore } from "../../lib/store.jsx";
import HoldButton from "../HoldButton.jsx";
import { withRowBoundary } from "../RowBoundary.jsx";
import { BotPresence } from "./Presence.jsx";
import SnoozeMenu, { snooze } from "./SnoozeMenu.jsx";

// «Te necesitan» cards of Colmena 2.0 (design/V2Hoy.dc.html): the only honey on the screen.
// The verbs, the undo line and the expiry line come from lib/approvalCard.js (the same on
// Inicio, in a room and in Revisar). A send shows what goes out and to whom; its «Mantén para
// enviar» waits 10 s with «Deshacer».
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
  <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", fontWeight: "600", color: "var(--c-honey-text)" }}>
    <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "var(--r-circle)", background: "var(--c-honey)", color: "var(--c-honey-ink)", animation: "halo 1.8s ease-out infinite" }} />
    {label}
  </span>
);
const QUIET = { height: "50px", padding: "0 14px", border: "0", background: "transparent", cursor: "pointer", fontSize: "var(--t-body)", fontWeight: "500", color: "var(--c-text-3)" };
// The primary action is the product's dark button: honey stays on the card's ring and its label.
const APPROVE = { flex: "1", height: "50px", padding: "0 22px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", cursor: "pointer", fontSize: "var(--t-body)", fontWeight: "600", whiteSpace: "nowrap" };
const SOFT = { height: "50px", padding: "0 22px", border: "0", borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .06)", color: "var(--c-text)", cursor: "pointer", fontSize: "var(--t-body)", fontWeight: "600", whiteSpace: "nowrap" };
const ext = (name) => (String(name || "").split(".").pop() || "").slice(0, 4).toUpperCase();
const EXT_TINT = { PDF: ["#FBE7DF", "#8E2A1F"], XLSX: ["#E1F4EC", "#0B5A3E"], CSV: ["#E1F4EC", "#0B5A3E"], DOCX: ["#E3EAFB", "#1F3F99"], PPTX: ["#FBEADF", "#8A3B12"] };

function Header({ bot, who, mission, at, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <BotPresence bot={bot} size={30} state="rest" />
      <span style={{ flex: "1", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>
        <strong style={{ color: "var(--c-text)", fontWeight: "600" }}>{bot?.name || "Un bot"}</strong>
        {who ? " · " + who : null}
        {mission && !mission.conversation ? <>{" · en "}<a href={roomUrl(mission)} style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>{placeName(mission)}</a></> : null}
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
        <span role="status" style={{ fontSize: "var(--t-body)", fontWeight: "500" }}>{`${text} ${secs} s`}</span>
        <button type="button" onClick={onUndo} style={{ height: "40px", padding: "0 18px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: "600" }}>{"Deshacer"}</button>
      </div>
      <span style={{ height: "4px", borderRadius: "var(--r-xs)", background: "rgb(var(--c-ink-rgb) / .08)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", background: "#12131A", transition: "width .25s linear", width: Math.round(fraction * 100) + "%" }} />
      </span>
    </div>
  );
}

function Sent({ text }) {
  return (
    <span role="status" style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "var(--t-body)", fontWeight: "500", color: "var(--c-ok-ink)", animation: "fade .3s ease-out" }}>
      <span aria-hidden="true" style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "#0B8A5F", animation: "pop .4s ease-out" }}>
        <Check size={12} weight="bold" color="#FFFFFF" />
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
      <span role="status" style={{ flex: "1", minWidth: "200px", fontSize: "var(--t-body)", color: "var(--c-text-3)" }}>{`${items.length > 1 ? "Pospuestas: vuelven" : "Pospuesto: vuelve"} ${snoozeWhen(items[0].snoozedUntil)}.`}</span>
      <button type="button" disabled={busy} onClick={back} style={{ height: "40px", padding: "0 18px", border: "0", borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .06)", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: "600" }}>{"Traer de vuelta"}</button>
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
  // The same verbs, undo line and expiry line as on Inicio, in a room and in Revisar.
  const model = useApprovalCard(a, bot?.name);
  const approve = (always = false) => {
    setError(null);
    schedule(key, async () => {
      await post(`/approvals/${a.id}`, { decision: "approved", revision: a.revision, ...(always ? { always: true } : {}) });
    });
  };
  const deny = () => {
    setError(null);
    later({ id: "deny:" + a.id, keys: [key], text: model.denyToast, error: "No se pudo descartar", run: () => post(`/approvals/${a.id}`, { decision: "denied", revision: a.revision }) });
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
      <article style={{ padding: "26px", background: "var(--c-card)", borderRadius: "var(--r-3xl)", display: "flex", flexDirection: "column", gap: "18px", transition: "box-shadow .5s ease", boxShadow: CALM }}>
        <Header bot={bot} mission={mission} at={a.createdAt} />
        <h3 style={{ margin: "0", font: "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.025em" }}>{a.title}</h3>
        <Sent text={settled} />
      </article>
    );
  }
  return (
    <article ref={keys} style={{ padding: "26px", background: "var(--c-card)", borderRadius: inline ? "var(--r-3xl)" : "var(--r-3xl)", display: "flex", flexDirection: "column", gap: "18px", transition: "box-shadow .5s ease", boxShadow: waiting || snoozed ? CALM : HONEY, animation: inline ? "rise .4s ease-out" : undefined }}>
      {inline ? (snoozed ? null : tag("Te necesita")) : <Header bot={bot} who={a.external ? "fuera de tu empresa" : null} mission={mission} at={a.createdAt} label={snoozed ? null : label} />}
      <h3 style={{ margin: "0", font: inline ? "600 var(--t-heading)/1.25 'Bricolage Grotesque', sans-serif" : "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: inline ? "-0.02em" : "-0.025em" }}>{model.title}</h3>
      {isSend && email ? (
        <div style={{ padding: "18px", background: "var(--c-hover)", borderRadius: "var(--r-xl)", display: "flex", flexDirection: "column", gap: "10px", fontSize: "var(--t-body)", lineHeight: "1.55" }}>
          {/* Who it goes to and what it says; the title already carries the subject. */}
          <SendWhat send={model.send} subject={!model.send.subject} size="var(--t-body)" />
          {(email.attachments || []).map((f, i) => {
            const e = ext(f.name || f);
            const [bg, fg] = EXT_TINT[e] || ["#EEF0F4", "#4A4F5C"];
            return (
              <span key={i} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px 6px 6px", background: "var(--c-card)", borderRadius: "var(--r-md)", fontSize: "var(--t-meta)" }}>
                <span aria-hidden="true" style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: bg, color: fg, font: "600 var(--t-micro)/1 'Geist Mono', monospace" }}>{e}</span>
                {f.name || f}
              </span>
            );
          })}
        </div>
      ) : !isQuestion && a.summary ? (
        <p style={{ margin: "0", fontSize: "var(--t-body)", lineHeight: "1.55", color: "var(--c-text-2)" }}>{a.summary}</p>
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
          {a.summary && a.summary !== a.title ? <p style={{ margin: "0", fontSize: "var(--t-body)", lineHeight: "1.55", color: "var(--c-text-2)" }}>{a.summary}</p> : null}
          <div role="radiogroup" aria-label={a.title} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {options.map((o, i) => {
              const on = choice === o.id;
              return (
                <button key={o.id || i} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-keyshortcuts={letterOf(i) || undefined} disabled={waiting && !on} onClick={() => (on ? undo() : pick(o))}
                  style={{ display: "flex", alignItems: "center", gap: "14px", minHeight: "56px", padding: "0 18px", textAlign: "left", borderRadius: "var(--r-xl)", cursor: "pointer", transition: "all .25s ease", background: on ? "var(--c-btn)" : "var(--c-hover)", color: on ? "var(--c-btn-text)" : "var(--c-text)", border: on ? "1px solid var(--c-text)" : "1px solid transparent" }}>
                  {letterOf(i) ? <span aria-hidden="true" style={letterStyle(on, 24)}>{letterOf(i)}</span> : null}
                  <span style={{ flex: "1", fontSize: "var(--t-body)", fontWeight: "600" }}>{o.label}</span>
                  {i === primary && options.length > 1 ? <span style={{ fontSize: "var(--t-meta)", opacity: ".7" }}>{"Recomendada"}</span> : null}
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
        <Countdown id={key} onUndo={undo} text={model.waitText} />
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {model.primary.action === "open" ? <a href={model.primary.href} style={{ ...APPROVE, display: "flex", alignItems: "center", justifyContent: "center" }}>{model.primary.label}</a>
              : model.primary.hold
                ? <HoldButton onConfirm={() => approve()} plainLabel={model.primary.plain} style={APPROVE}>{model.primary.label}</HoldButton>
                : <button type="button" onClick={() => approve()} style={APPROVE}>{model.primary.label}</button>}
            {model.secondary.map((s) => (s.id === "review" ? <a key={s.id} href={s.href} style={{ ...SOFT, display: "flex", alignItems: "center" }}>{s.label}</a>
              : s.id === "always" ? <button key={s.id} type="button" onClick={() => approve(true)} style={SOFT}>{s.label}</button>
                : <button key={s.id} type="button" onClick={deny} style={QUIET}>{s.label}</button>))}
            {a.kind === "secret" ? null : <SnoozeMenu items={[a]} style={QUIET} onError={setError} />}
          </div>
          <ApprovalNotes model={model} size="var(--t-ui)" />
        </>
      )}
      {error || failures.get(a.id) ? <span role="alert" style={{ fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error || failures.get(a.id)}</span> : null}
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
          <span style={{ flex: "1", minWidth: 0, fontSize: "var(--t-body)", fontWeight: "600" }}>{heading}</span>
          <button ref={toggle} type="button" aria-expanded="true" onClick={flip} style={{ ...quiet, height: "40px" }}>{GROUP_VERBS.together}</button>
        </div>
        {items.map((a) => <NeedCard key={a.id} a={a} bot={bot} mission={mission} inline={inline} />)}
      </div>
    );
  }
  return (
    <article aria-label={heading} style={{ padding: "26px", background: "var(--c-card)", borderRadius: inline ? "var(--r-3xl)" : "var(--r-3xl)", display: "flex", flexDirection: "column", gap: "18px", transition: "box-shadow .5s ease", boxShadow: waiting || snoozed ? CALM : HONEY, animation: inline ? "rise .4s ease-out" : undefined }}>
      {inline ? (snoozed ? null : tag("Te necesita")) : <Header bot={bot} mission={mission} at={items[0].createdAt} label={snoozed ? null : "Aprobar"} />}
      <h3 style={{ margin: "0", font: inline ? "600 var(--t-heading)/1.25 'Bricolage Grotesque', sans-serif" : "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: inline ? "-0.02em" : "-0.025em" }}>{heading}</h3>
      <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
        {listed.shown.map((a) => (
          <li key={a.id} style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--t-body)", lineHeight: "1.5", color: "var(--c-text-2)" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupLine(a, bot?.name, group.label)}</span>
            {failures.has(a.id) ? <span style={{ fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{failures.get(a.id)}</span> : null}
          </li>
        ))}
        {listed.more ? <li style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{`y ${listed.more} más`}</li> : null}
      </ul>
      {snoozed ? (
        <SnoozedLine items={items} onError={setError} />
      ) : waiting ? (
        <Countdown id={key} onUndo={() => cancel(key)} text="Se aprueban en" />
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            <button type="button" onClick={approve} style={APPROVE}>{GROUP_VERBS.approve}</button>
            <button ref={toggle} type="button" aria-expanded="false" onClick={flip} style={SOFT}>{GROUP_VERBS.each}</button>
            <button type="button" onClick={deny} style={quiet}>{GROUP_VERBS.deny}</button>
            <SnoozeMenu items={items} style={quiet} onError={setError} />
          </div>
          <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.45", color: "var(--c-text-3)" }}>{GROUP_VERBS.undoLine}</span>
        </>
      )}
      {error ? <span role="alert" style={{ fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</span> : null}
    </article>
  );
}, { label: "No se han podido mostrar estas peticiones", resetKey: ({ group }) => group?.id + ":" + group?.items?.length });

/** A room that waits for you to pick a proposal or approve a plan. */
export function ChoiceCard({ m, bots }) {
  const lead = bots.find((b) => b.id === (m.botIds?.[0] || "atlas")) || bots.find((b) => b.id === "atlas");
  const isPlan = m.status === "awaiting_plan";
  return (
    <article style={{ padding: "26px", background: "var(--c-card)", borderRadius: "var(--r-3xl)", display: "flex", flexDirection: "column", gap: "18px", boxShadow: HONEY }}>
      <Header bot={lead} mission={m} at={m.updatedAt} label={isPlan ? "Revisar" : "Elegir"} />
      <h3 style={{ margin: "0", font: "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.025em" }}>{m.title}</h3>
      <p style={{ margin: "0", fontSize: "var(--t-body)", lineHeight: "1.55", color: "var(--c-text-2)" }}>{isPlan ? "El plan está listo. Revísalo y dale el OK para que empiecen." : m.activityLine || "Las propuestas están listas: elige una."}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        <a href={isPlan ? `/encargo/${m.id}` : `/debate/${m.id}`} style={{ flex: "1", display: "flex", alignItems: "center", justifyContent: "center", height: "50px", padding: "0 22px", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-body)", fontWeight: "600" }}>{isPlan ? "Revisar el plan" : "Ver las propuestas"}</a>
      </div>
    </article>
  );
}
