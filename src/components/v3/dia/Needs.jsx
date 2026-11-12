import { useEffect, useRef, useState } from "react";
import { Calendar, FileText, Folder, Mail, MessageSquare } from "lucide-react";
import QuestionFlow from "../../v2/chat/QuestionFlow.jsx";
import { QuestionReply } from "../../room/QuestionReply.jsx";
import { post } from "../../../lib/api.js";
import { roomUrl, time } from "../../../lib/format.js";
import { cancel, schedule, useUndoable } from "../../../lib/undoable.js";
import { later } from "../../../lib/undoToast.js";
import { failureText, groupLine, groupShown, groupTitle } from "../../../lib/approvalGroups.js";
import { needsHold } from "../../../lib/holdApprove.js";
import { decideBatch, useBatchFailures } from "../../../lib/useApprovalBatch.js";
import HoldButton from "../../HoldButton.jsx";
import { NeedLabel, Shape, UndoBar, btn } from "./parts.jsx";

// «Te necesitan» on Inicio (design/V3Inicio.dc.html): white cards ringed in honey, the oldest
// first. A send shows who gets what; «Aprobar y enviar» waits 10 s with «Deshacer»; «No
// enviar» goes with a 5 s notice. A question offers its options as buttons (your pick also
// waits 10 s) and a free answer. Rooms waiting for a choice or a plan and the questions of
// the bot that watches your apps («Te avisa de lo importante») use the same card. Several
// requests of the same kind in a row fold into one card with «Aprobar todas» (GroupNeed);
// a send or any other red line is approved by holding its button (HoldButton.jsx).

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

const card = (wide, ring) => ({ display: "flex", flexDirection: "column", gap: wide ? "14px" : "12px", padding: "20px 22px", background: "#FFFFFF", borderRadius: "20px", boxShadow: ring, transition: "box-shadow .4s ease", animation: "rise .4s ease-out" });
const title = (wide) => (wide ? { margin: "0", fontSize: "18px", fontWeight: "600", letterSpacing: "-0.01em", lineHeight: "1.3" } : { margin: "0", fontSize: "16.5px", fontWeight: "600", lineHeight: "1.35" });
const body = { margin: "0", fontSize: "14.5px", lineHeight: "1.5", color: "#4A4D57", display: "-webkit-box", WebkitLineClamp: "2", WebkitBoxOrient: "vertical", overflow: "hidden" };
const strong = { fontWeight: "600", color: "#12131A" };
const row = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" };

function Head({ bot, where, at, label }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
      <Shape bot={bot} size={20} />
      <span style={{ fontSize: "13.5px", color: "#5C606C", minWidth: 0 }}>
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
    <span role="status" style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14.5px", fontWeight: "500", color: "#0B6B4A", animation: "fade .3s ease-out" }}>
      <span aria-hidden="true" style={{ width: "20px", height: "20px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: "#0B8A5F", animation: "pop .4s ease-out" }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
      </span>
      {text}
    </span>
  );
}

const Lock = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>;
const where = (mission) => (mission && !mission.conversation ? <>{"en "}<a href={roomUrl(mission)}>{mission.room ? "#" + mission.room : mission.title}</a></> : mission?.conversation ? "en el chat" : null);
const LABEL = { send: "Aprobar un envío", question: "Decidir", plan: "Revisar el plan", permission: "Dar permiso", secret: "Revisar", memory: "Revisar", skill: "Revisar", soul: "Revisar", write: "Aprobar" };

/** One approval (send, permission, plan…) or question waiting for you. `wide`: the first, larger card. */
export function ApprovalNeed({ a, bot, mission, wide = false, settled = null }) {
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
  const isSend = a.kind === "send";
  const isQuestion = a.kind === "question";
  const email = a.email;
  const approve = () => {
    setError(null);
    schedule(key, async () => {
      await post(`/approvals/${a.id}`, { decision: "approved", revision: a.revision });
      remember(a, isSend ? `Enviado a las ${time(new Date())}. Lo encontrarás en la Biblioteca.` : `Aprobado a las ${time(new Date())}.`);
    });
  };
  const deny = () => {
    setError(null);
    later({ id: "deny:" + a.id, keys: [key], text: isSend ? "No se envía" : "No se permite", error: "No se pudo descartar", run: () => post(`/approvals/${a.id}`, { decision: "denied", revision: a.revision }) });
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
  const heading = isSend && email?.subject ? `Enviar «${email.subject}»` : isQuestion && a.questions?.length > 1 ? `${bot?.name || "El bot"} tiene ${a.questions.length} preguntas` : a.title;
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
    <article aria-label={heading} style={card(wide, waiting ? CALM : wide ? RING : RING_SM)}>
      <Head bot={bot} where={where(mission)} at={a.createdAt} label={LABEL[a.kind] || "Aprobar"} />
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <h3 style={title(wide)}>{heading}</h3>
        {isSend && email ? (
          <p style={body}>
            {"Para "}<strong style={strong}>{(email.to || []).join(", ") || "nadie todavía"}</strong>
            {(email.attachments || []).length ? <>{" con "}<strong style={strong}>{(email.attachments || []).map((f) => f.name || f).join(", ")}</strong></> : null}
            {email.body ? `: «${String(email.body).replace(/\s+/g, " ").trim().slice(0, 220)}…»` : null}
          </p>
        ) : a.summary && a.summary !== a.title ? <p style={body}>{a.summary}</p> : null}
      </div>
      {isQuestion && a.questions?.length > 1 ? (
        // Several questions: one at a time (QuestionFlow.jsx).
        <QuestionFlow approval={a} />
      ) : waiting ? (
        <div style={row}><UndoBar id={key} text={isSend ? "Se envía en" : isQuestion ? "Se decide en" : "Se aprueba en"} onUndo={undo} /></div>
      ) : isQuestion ? (
        <>
          <div role="group" aria-label={a.title} style={row}>
            {options.map((o, i) => (
              <button key={o.id || i} type="button" aria-pressed={choice === o.id ? "true" : "false"} onClick={() => pick(o)} style={i === primary ? btn.dark : btn.line}>{o.label}</button>
            ))}
            <button type="button" aria-expanded={free ? "true" : "false"} onClick={() => setFree(!free)} style={btn.text}>{options.length ? "Otra respuesta" : "Responder"}</button>
          </div>
          {free || !options.length ? <QuestionReply approval={a} /> : null}
        </>
      ) : (
        <div style={row}>
          {a.kind === "plan" ? <a href={a.missionId ? `/sala/${a.missionId}#plan` : `/revisar/${a.id}`} style={btn.dark}>{"Revisar el plan"}</a>
            : a.kind === "secret" ? <a href={`/revisar/${a.id}`} style={btn.dark}>{"Revisar"}</a>
              : <>
                {needsHold(a)
                  ? <HoldButton onConfirm={approve} style={btn.dark}>{isSend ? "Aprobar y enviar" : "Aprobar"}</HoldButton>
                  : <button type="button" onClick={approve} style={btn.dark}>{isSend ? "Aprobar y enviar" : "Aprobar"}</button>}
                <a href={`/revisar/${a.id}`} style={btn.line}>{isSend ? "Revisar y editar" : "Revisar"}</a>
                <button type="button" onClick={deny} style={btn.text}>{isSend ? "No enviar" : "No permitir"}</button>
              </>}
          {wide && (outside || a.impact?.headline) ? (
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#5C606C" }}>
              {outside ? <><Lock />{"Sale de tu empresa: siempre te pregunta"}</> : a.impact.headline}
            </span>
          ) : null}
        </div>
      )}
      {error || failures.get(a.id) ? <span role="alert" style={{ fontSize: "14px", color: "#B4232A" }}>{error || failures.get(a.id)}</span> : null}
    </article>
  );
}

/**
 * Several requests of the same kind from one bot, one after another, as one card: what each
 * one is, «Aprobar todas» (10 s with «Deshacer», like any approval here), «Ver cada una» (the
 * usual cards, each decided alone) and «No permitir» for all of them. Never a red line.
 */
export function GroupNeed({ group, bot, mission, wide = false }) {
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
          <span style={{ flex: "1", minWidth: 0, fontSize: "14.5px", fontWeight: "600" }}>{heading}</span>
          <button ref={toggle} type="button" aria-expanded="true" onClick={flip} style={btn.text}>{"Ver juntas"}</button>
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
            <li key={a.id} style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "14.5px", lineHeight: "1.45", color: "#4A4D57" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupLine(a, bot?.name, group.label)}</span>
              {failures.has(a.id) ? <span style={{ fontSize: "13.5px", color: "#B4232A" }}>{failures.get(a.id)}</span> : null}
            </li>
          ))}
          {listed.more ? <li style={{ fontSize: "13.5px", color: "#5C606C" }}>{`y ${listed.more} más`}</li> : null}
        </ul>
      </div>
      {waiting ? (
        <div style={row}><UndoBar id={key} text="Se aprueban en" onUndo={() => cancel(key)} /></div>
      ) : (
        <div style={row}>
          <button type="button" onClick={approve} style={btn.dark}>{"Aprobar todas"}</button>
          <button ref={toggle} type="button" aria-expanded="false" onClick={flip} style={btn.line}>{"Ver cada una"}</button>
          <button type="button" onClick={deny} style={btn.text}>{"No permitir"}</button>
        </div>
      )}
      {error ? <span role="alert" style={{ fontSize: "14px", color: "#B4232A" }}>{error}</span> : null}
    </article>
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
              <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.asunto} style={{ display: "inline-flex", alignItems: "center", gap: "6px", maxWidth: "100%", height: "28px", padding: "0 10px", borderRadius: "999px", background: "#F3F3EF", fontSize: "12.5px", color: "#3D404A" }}>
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
          <a href={chat} style={{ fontSize: "14px", fontWeight: "500" }}>{"Ver el chat"}</a>
        </div>
      ) : (
        <div style={row}>
          {replies.map((r, i) => <button key={r} type="button" disabled={busy} onClick={() => answer(r)} style={{ ...(i === 0 ? btn.dark : btn.line), opacity: busy ? 0.6 : 1 }}>{r}</button>)}
          <a href={chat} style={{ ...btn.text, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>{"Contestar en el chat"}</a>
          <button type="button" onClick={dismiss} style={btn.text}>{"Ahora no"}</button>
        </div>
      )}
      {error ? <span role="alert" style={{ fontSize: "14px", color: "#B4232A" }}>{error}</span> : null}
    </article>
  );
}
