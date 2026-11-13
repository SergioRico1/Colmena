import { useEffect, useRef, useState } from "react";
import { Calendar, FileText, Folder, Mail, MessageSquare } from "lucide-react";
import QuestionFlow from "../../v2/chat/QuestionFlow.jsx";
import { QuestionReply } from "../../room/QuestionReply.jsx";
import { post } from "../../../lib/api.js";
import { roomUrl, time } from "../../../lib/format.js";
import { cancel, schedule, useUndoable } from "../../../lib/undoable.js";
import { later } from "../../../lib/undoToast.js";
import { failureText, groupLine, groupShown, groupTitle } from "../../../lib/approvalGroups.js";
import { GROUP_VERBS } from "../../../lib/approvalCard.js";
import { ApprovalNotes, SendWhat, useApprovalCard } from "../../ApprovalParts.jsx";
import { decideBatch, useBatchFailures } from "../../../lib/useApprovalBatch.js";
import { letterOf, letterStyle, useChoiceKeys } from "../../../lib/choiceKeys.js";
import { snoozeWhen, snoozedLabel } from "../../../lib/snooze.js";
import { useStore } from "../../../lib/store.jsx";
import HoldButton from "../../HoldButton.jsx";
import { withRowBoundary } from "../../RowBoundary.jsx";
import SnoozeMenu, { snooze } from "../../v2/SnoozeMenu.jsx";
import { NeedLabel, Shape, UndoBar, btn } from "./parts.jsx";
import { NoteAsk } from "../../wiki/NoteDiff.jsx";

// «Te necesitan» on Inicio (design/V3Inicio.dc.html): white cards ringed in honey, the oldest
// first. The verbs, the undo line and the expiry line come from lib/approvalCard.js, the same
// in the chat, a room and Revisar: a send shows who gets what and its «Mantén para enviar»
// waits 10 s with «Deshacer»; «No enviar» goes with a 5 s notice. A question offers its options as buttons (your pick also
// waits 10 s) and a free answer. Rooms waiting for a choice or a plan and the questions of
// the bot that watches your apps («Te avisa de lo importante») use the same card. Several
// requests of the same kind in a row fold into one card with «Aprobar todas» (GroupNeed);
// a send or any other red line is approved by holding its button (HoldButton.jsx).
// «Recordar después» (v2/SnoozeMenu.jsx) puts a request off until a time, unless it has a
// deadline that would pass first; SnoozedNeeds lists what is put off («2 pospuestos») and
// brings one back. A question's options read A, B, C… and the letter key answers
// (lib/choiceKeys.js). A card that fails to draw becomes one muted pill (RowBoundary.jsx).

const RING = "0 0 0 1.5px #FFC93C, 0 18px 40px -28px rgba(138,90,0,.45)";
const RING_SM = "0 0 0 1.5px #FFC93C";
const CALM = "0 0 0 1px rgba(18,19,26,.08)";

// What was approved or answered here stays a while, confirmed, then goes.
const done = new Map(); // approval id → {approval, text, at}
const remember = (approval, text) => done.set(approval.id, { approval, text, at: Date.now() });
export const recentlyDone = () => {
  for (const [id, d] of done) if (Date.now() - d.at > 10 * 60e3) done.delete(id);
  return [...done.values()];
};

/**
 * Approves one request with the 10 s to undo, wherever the click comes from (its card, or its
 * row on Inicio): the same wait, the same confirmation afterwards. `model`: its approvalCard.
 */
export function scheduleApproval(a, model, always = false) {
  schedule("approval:" + a.id, async () => {
    await post(`/approvals/${a.id}`, { decision: "approved", revision: a.revision, ...(always ? { always: true } : {}) });
    remember(a, a.kind === "send" ? `Enviado a las ${time(new Date())}. Lo encontrarás en la Biblioteca.` : `${model.doneText} a las ${time(new Date())}.`);
  });
}

const card = (wide, ring) => ({ display: "flex", flexDirection: "column", gap: wide ? "14px" : "12px", padding: "20px 22px", background: "#FFFFFF", borderRadius: "var(--r-xl)", boxShadow: ring, transition: "box-shadow .4s ease", animation: "rise .4s ease-out" });
const title = (wide) => (wide ? { margin: "0", fontSize: "var(--t-lead)", fontWeight: "600", letterSpacing: "-0.01em", lineHeight: "1.3" } : { margin: "0", fontSize: "var(--t-read)", fontWeight: "600", lineHeight: "1.35" });
const body = { margin: "0", fontSize: "var(--t-body)", lineHeight: "1.5", color: "#4A4D57", display: "-webkit-box", WebkitLineClamp: "2", WebkitBoxOrient: "vertical", overflow: "hidden" };
const strong = { fontWeight: "600", color: "#12131A" };
const row = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" };

function Head({ bot, where, at, label }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
      <Shape bot={bot} size={20} />
      <span style={{ fontSize: "var(--t-ui)", color: "#5C606C", minWidth: 0 }}>
        <strong style={strong}>{bot?.name || "Un bot"}</strong>
        {where ? <>{" · "}{where}</> : null}
        {at ? " · " + time(at) : null}
      </span>
      {label ? <NeedLabel>{label}</NeedLabel> : null}
    </div>
  );
}

function Settled({ text }) {
  return (
    <span role="status" style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "var(--t-body)", fontWeight: "500", color: "#0B6B4A", animation: "fade .3s ease-out" }}>
      <span aria-hidden="true" style={{ width: "20px", height: "20px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "#0B8A5F", animation: "pop .4s ease-out" }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
      </span>
      {text}
    </span>
  );
}

const Lock = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>;
const where = (mission) => (mission && !mission.conversation ? <>{"en "}<a href={roomUrl(mission)}>{mission.room ? "#" + mission.room : mission.title}</a></> : mission?.conversation ? "en el chat" : null);
const LABEL = { send: "Aprobar un envío", question: "Decidir", plan: "Revisar el plan", permission: "Dar permiso", secret: "Revisar", memory: "Revisar", skill: "Revisar", soul: "Revisar", write: "Aprobar" };

// A request that cannot be drawn is still decided in Revisar.
const guard = { label: "No se ha podido mostrar esta petición", action: ({ a }) => (a?.id && a.status === "pending" && a.kind !== "question" ? { href: `/revisar/${a.id}`, text: "Abrir en Revisar" } : null), resetKey: ({ a }) => `${a?.id}:${a?.revision}:${a?.status}` };

/** One approval (send, permission, plan…) or question waiting for you. `wide`: the first, larger card. */
export const ApprovalNeed = withRowBoundary(function ApprovalNeed({ a, bot, mission, wide = false, settled = null }) {
  const key = "approval:" + a.id;
  const { waiting } = useUndoable(key);
  const [error, setError] = useState(null);
  const [choice, setChoice] = useState(null);
  const [free, setFree] = useState(false);
  const failures = useBatchFailures(); // why «Aprobar todas» could not decide this one
  useEffect(() => {
    const onFail = (e) => { if (e.detail?.id === key) setError(e.detail.message || "No se pudo completar. Vuelve a intentarlo."); };
    window.addEventListener("colmena:undo-failed", onFail);
    return () => window.removeEventListener("colmena:undo-failed", onFail);
  }, [key]);
  const isQuestion = a.kind === "question";
  // The same verbs, undo line and expiry line as in the chat, a room and Revisar.
  const model = useApprovalCard(a, bot?.name, { excerpt: wide ? 220 : 140 });
  const approve = (always = false) => {
    setError(null);
    scheduleApproval(a, model, always);
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
      remember(a, `Decidido: ${o.label}. ${bot?.name || "El bot"} sigue con ello.`);
    });
  };
  const undo = () => { cancel(key); setChoice(null); };
  const options = a.options || [];
  const primary = Math.max(0, options.findIndex((o) => o.primary));
  // A, B, C… answer while this is the question in focus (or the last one waiting on screen).
  const single = isQuestion && !(a.questions?.length > 1);
  const keys = useChoiceKeys({ count: options.length, enabled: single && !settled && !waiting, onChoose: (i) => pick(options[i]) });
  const heading = model.title;
  const outside = a.external || a.redLine || a.impact?.tone === "external";

  if (settled) {
    return (
      <article style={card(wide, CALM)}>
        <Head bot={bot} where={where(mission)} at={a.createdAt} />
        <h3 style={title(wide)}>{heading}</h3>
        <Settled text={settled} />
      </article>
    );
  }
  return (
    <article ref={keys} aria-label={heading} style={card(wide, waiting ? CALM : wide ? RING : RING_SM)}>
      <Head bot={bot} where={where(mission)} at={a.createdAt} label={LABEL[a.kind] || "Aprobar"} />
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <h3 style={title(wide)}>{heading}</h3>
        {/* Who it goes to and what it says; the title already carries the subject. */}
        {model.send ? <SendWhat send={model.send} subject={!model.send.subject} /> : a.summary && a.summary !== a.title ? <p style={body}>{a.summary}</p> : null}
      </div>
      {/* A note of «Notas» the bot wants to write: which one, and the lines it adds and removes. */}
      {a.wiki ? <NoteAsk id={a.id} wiki={a.wiki} compact={!wide} /> : null}
      {isQuestion && a.questions?.length > 1 ? (
        // Several questions: one at a time (QuestionFlow.jsx).
        <>
          <QuestionFlow approval={a} />
          <div style={row}><SnoozeMenu items={[a]} style={btn.text} onError={setError} /></div>
        </>
      ) : waiting ? (
        <div style={row}><UndoBar id={key} text={model.waitText} onUndo={undo} /></div>
      ) : isQuestion ? (
        <>
          <div role="group" aria-label={a.title} style={row}>
            {options.map((o, i) => (
              <button key={o.id || i} type="button" aria-pressed={choice === o.id ? "true" : "false"} aria-keyshortcuts={letterOf(i) || undefined} onClick={() => pick(o)} style={{ ...(i === primary ? btn.dark : btn.line), gap: "8px", paddingLeft: "10px" }}>
                {letterOf(i) ? <span aria-hidden="true" style={letterStyle(i === primary)}>{letterOf(i)}</span> : null}
                {o.label}
              </button>
            ))}
            <button type="button" aria-expanded={free ? "true" : "false"} onClick={() => setFree(!free)} style={btn.text}>{options.length ? "Otra respuesta" : "Responder"}</button>
            <SnoozeMenu items={[a]} style={btn.text} onError={setError} />
          </div>
          {free || !options.length ? <QuestionReply approval={a} /> : null}
        </>
      ) : (
        <div style={row}>
          {model.primary.action === "open" ? <a href={model.primary.href} style={btn.dark}>{model.primary.label}</a>
            : model.primary.hold
              ? <HoldButton onConfirm={() => approve()} plainLabel={model.primary.plain} style={btn.dark}>{model.primary.label}</HoldButton>
              : <button type="button" onClick={() => approve()} style={btn.dark}>{model.primary.label}</button>}
          {model.secondary.map((s) => (s.id === "review" ? <a key={s.id} href={s.href} style={btn.line}>{s.label}</a>
            : s.id === "always" ? <button key={s.id} type="button" onClick={() => approve(true)} style={btn.line}>{s.label}</button>
              : <button key={s.id} type="button" onClick={deny} style={btn.text}>{s.label}</button>))}
          {a.kind === "secret" ? null : <SnoozeMenu items={[a]} style={btn.text} onError={setError} />}
          {wide && (outside || a.impact?.headline) ? (
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", color: "#5C606C" }}>
              {outside ? <><Lock />{"Sale de tu empresa: siempre te pregunta"}</> : a.impact.headline}
            </span>
          ) : null}
        </div>
      )}
      {/* The undo window and what happens if nobody decides, wherever this request is shown. */}
      {waiting ? null : <ApprovalNotes model={model} />}
      {error || failures.get(a.id) ? <span role="alert" style={{ fontSize: "var(--t-ui)", color: "#B4232A" }}>{error || failures.get(a.id)}</span> : null}
    </article>
  );
}, guard);

/**
 * Several requests of the same kind from one bot, one after another, as one card: what each
 * one is, «Aprobar todas» (10 s with «Deshacer», like any approval here), «Ver cada una» (the
 * usual cards, each decided alone) and «No permitir» for all of them. Never a red line.
 */
export const GroupNeed = withRowBoundary(function GroupNeed({ group, bot, mission, wide = false }) {
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
  const approve = () => {
    setError(null);
    schedule(key, async () => {
      const left = await decideBatch(items, "approved");
      if (left) throw Error(failureText(left, "approved"));
      remember({ ...items[0], id: group.id, title: heading }, `Aprobadas a las ${time(new Date())}.`);
    });
  };
  const deny = () => {
    setError(null);
    later({
      id: "deny:" + group.id, keys: items.map((a) => "approval:" + a.id), text: "No se permiten", error: "No se pudieron descartar",
      run: async () => { const left = await decideBatch(items, "denied"); if (left) throw Error(failureText(left, "denied")); },
    });
  };
  if (open) {
    return (
      <div role="group" aria-label={heading} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ ...row, padding: "0 6px" }}>
          <span style={{ flex: "1", minWidth: 0, fontSize: "var(--t-body)", fontWeight: "600" }}>{heading}</span>
          <button ref={toggle} type="button" aria-expanded="true" onClick={flip} style={btn.text}>{GROUP_VERBS.together}</button>
        </div>
        {items.map((a) => <ApprovalNeed key={a.id} a={a} bot={bot} mission={mission} />)}
      </div>
    );
  }
  return (
    <article aria-label={heading} style={card(wide, waiting ? CALM : wide ? RING : RING_SM)}>
      <Head bot={bot} where={where(mission)} at={items[0].createdAt} label="Aprobar" />
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <h3 style={title(wide)}>{heading}</h3>
        <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
          {listed.shown.map((a) => (
            <li key={a.id} style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--t-body)", lineHeight: "1.45", color: "#4A4D57" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupLine(a, bot?.name, group.label)}</span>
              {failures.has(a.id) ? <span style={{ fontSize: "var(--t-ui)", color: "#B4232A" }}>{failures.get(a.id)}</span> : null}
            </li>
          ))}
          {listed.more ? <li style={{ fontSize: "var(--t-ui)", color: "#5C606C" }}>{`y ${listed.more} más`}</li> : null}
        </ul>
      </div>
      {waiting ? (
        <div style={row}><UndoBar id={key} text="Se aprueban en" onUndo={() => cancel(key)} /></div>
      ) : (
        <>
          <div style={row}>
            <button type="button" onClick={approve} style={btn.dark}>{GROUP_VERBS.approve}</button>
            <button ref={toggle} type="button" aria-expanded="false" onClick={flip} style={btn.line}>{GROUP_VERBS.each}</button>
            <button type="button" onClick={deny} style={btn.text}>{GROUP_VERBS.deny}</button>
            <SnoozeMenu items={items} style={btn.text} onError={setError} />
          </div>
          <span style={{ fontSize: "var(--t-meta)", lineHeight: "1.45", color: "#5C606C" }}>{GROUP_VERBS.undoLine}</span>
        </>
      )}
      {error ? <span role="alert" style={{ fontSize: "var(--t-ui)", color: "#B4232A" }}>{error}</span> : null}
    </article>
  );
}, { label: "No se han podido mostrar estas peticiones", resetKey: ({ group }) => group?.id + ":" + group?.items?.length });

/**
 * What you put off with «Recordar después»: a discreet «2 pospuestos» that unfolds into one
 * line per request — what it is, when it comes back — with «Traer de vuelta».
 */
export function SnoozedNeeds({ items = [], bots = [] }) {
  const { run } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const toggle = useRef(null);
  if (!items.length) return null;
  const back = async (a) => {
    if (busy) return;
    setBusy(a.id);
    setError(null);
    try {
      await run(() => snooze([a], null));
      // The row is gone: the keyboard stays on the toggle (or leaves with the list).
      toggle.current?.focus({ preventScroll: true });
    } catch (e) {
      setError(e?.message || "No se pudo traer de vuelta.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <button ref={toggle} type="button" aria-expanded={open ? "true" : "false"} aria-controls="snoozed-needs" onClick={() => setOpen((v) => !v)} style={{ ...btn.text, alignSelf: "flex-start", height: "32px", display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "var(--t-ui)", color: "#5C606C" }}>
        {snoozedLabel(items.length)}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease" }}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open ? (
        <ul id="snoozed-needs" aria-label="Pospuestos" style={{ margin: "0", padding: "4px 18px", listStyle: "none", display: "flex", flexDirection: "column", borderRadius: "var(--r-xl)", background: "#FFFFFF", animation: "fade .2s ease-out" }}>
          {items.map((a, i) => {
            const bot = bots.find((b) => b.id === a.botId) || null;
            return (
              <li key={a.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", padding: "10px 0", borderTop: i ? "1px solid rgba(18,19,26,.06)" : "0" }}>
                <Shape bot={bot} size={14} />
                <span style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "var(--t-body)", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                  <span style={{ fontSize: "var(--t-meta)", color: "#5C606C" }}>{`${bot?.name || "Un bot"} · vuelve ${snoozeWhen(a.snoozedUntil)}`}</span>
                </span>
                <button type="button" disabled={busy === a.id} onClick={() => back(a)} style={{ ...btn.line, height: "34px", padding: "0 14px", fontSize: "var(--t-ui)" }}>{"Traer de vuelta"}</button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? <span role="alert" style={{ fontSize: "var(--t-ui)", color: "#B4232A" }}>{error}</span> : null}
    </div>
  );
}

/** A room that waits for you to pick a proposal or approve a plan. */
export function ChoiceNeed({ m, bots, wide = false }) {
  const lead = bots.find((b) => b.id === (m.botIds?.[0] || "atlas")) || bots.find((b) => b.id === "atlas");
  const isPlan = m.status === "awaiting_plan";
  return (
    <article aria-label={m.title} style={card(wide, wide ? RING : RING_SM)}>
      <Head bot={lead} where={where(m)} at={m.updatedAt} label={isPlan ? "Revisar el plan" : "Decidir"} />
      <h3 style={title(wide)}>{isPlan ? `El plan de «${m.title}» espera tu OK.` : m.activityLine && m.activityLine !== m.statusLabel ? m.activityLine : `Las propuestas de «${m.title}» están listas.`}</h3>
      <a href={isPlan ? `/encargo/${m.id}` : `/debate/${m.id}`} style={{ ...btn.dark, alignSelf: "flex-start" }}>{isPlan ? "Revisar el plan" : "Ver y elegir"}</a>
    </article>
  );
}

/**
 * What another person asks of one of your bots and waits for your OK (an errand, «Personas»).
 * It is decided in your conversation with that person, where its card has the details.
 */
export function ErrandNeed({ item, bot, wide = false }) {
  return (
    <article aria-label={item.title} style={card(wide, wide ? RING : RING_SM)}>
      <Head bot={bot} where="de otra persona" at={item.at} label="Decidir" />
      <h3 style={title(wide)}>{item.title}</h3>
      <a href={item.roomId ? `/con/${encodeURIComponent(item.roomId)}` : "/equipo"} style={{ ...btn.dark, alignSelf: "flex-start" }}>{"Ver y decidir"}</a>
    </article>
  );
}

// Where a note comes from (server/watch-sources.mjs «fuente»).
const WHERE = { Correo: ["en tu correo", Mail], Agenda: ["en tu agenda", Calendar], Slack: ["en Slack", MessageSquare], Drive: ["en Drive", FileText], Notion: ["en Notion", FileText], Carpeta: ["en tus carpetas", Folder] };

/** A question the bot that watches your apps left you; one click answers it in its chat. */
export function WatchNeed({ n, bot, wide = false }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const [error, setError] = useState(null);
  const chat = `/chat/${n.botId}?c=${n.missionId}`;
  const answer = async (text) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/watch/notes/${n.id}/reply`, { text });
      setSaid(text);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => {
    setError(null);
    later({ id: "watchnote:" + n.id, keys: ["watchnote:" + n.id], text: "Aviso descartado", error: "No se pudo descartar", run: () => post(`/watch/notes/${n.id}/dismiss`, {}) });
  };
  const replies = n.replies?.length ? n.replies : ["Sí, hazlo", "No hace falta"];
  const from = WHERE[n.sources?.[0]?.fuente] || WHERE.Correo;
  return (
    <article aria-label={n.question || n.title} style={card(wide, said ? CALM : wide ? RING : RING_SM)}>
      <Head bot={bot} where={from[0]} at={n.createdAt} label={said ? null : "Responder"} />
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <h3 style={title(wide)}>{n.question || n.title}</h3>
        {n.text ? <p style={body}>{n.text}</p> : null}
      </div>
      {n.sources?.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {n.sources.slice(0, 3).map((s, i) => {
            const Icon = (WHERE[s.fuente] || WHERE.Correo)[1];
            return (
              <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.asunto} style={{ display: "inline-flex", alignItems: "center", gap: "6px", maxWidth: "100%", height: "28px", padding: "0 10px", borderRadius: "var(--r-pill)", background: "#F3F3EF", fontSize: "var(--t-meta)", color: "#3D404A" }}>
                <Icon size={13} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.asunto || "Ver el original"}</span>
              </a>
            );
          })}
        </div>
      ) : null}
      {said ? (
        <div style={{ ...row, justifyContent: "space-between" }}>
          <Settled text={`Le has dicho «${said}». ${bot?.name || "El bot"} se pone con ello.`} />
          <a href={chat} style={{ fontSize: "var(--t-ui)", fontWeight: "500" }}>{"Ver el chat"}</a>
        </div>
      ) : (
        <div style={row}>
          {replies.map((r, i) => <button key={r} type="button" disabled={busy} onClick={() => answer(r)} style={{ ...(i === 0 ? btn.dark : btn.line), opacity: busy ? 0.6 : 1 }}>{r}</button>)}
          <a href={chat} style={{ ...btn.text, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>{"Contestar en el chat"}</a>
          <button type="button" onClick={dismiss} style={btn.text}>{"Ahora no"}</button>
        </div>
      )}
      {error ? <span role="alert" style={{ fontSize: "var(--t-ui)", color: "#B4232A" }}>{error}</span> : null}
    </article>
  );
}
