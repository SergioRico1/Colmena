import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronRight, HandPointing, PaperPlaneRight, ShieldAlert } from "../Icon.js";
import { post } from "../../lib/api.js";
import { useAction, useStore } from "../../lib/store.jsx";
import { leave } from "../../lib/motion.js";
import { groupApprovals, groupLine, groupShown, groupTitle } from "../../lib/approvalGroups.js";
import { needsHold } from "../../lib/holdApprove.js";
import { GROUP_VERBS, leftText } from "../../lib/approvalCard.js";
import { cancel, schedule, useUndoFailed, useUndoable } from "../../lib/undoable.js";
import { useApprovalBatch, useBatchFailures } from "../../lib/useApprovalBatch.js";
import { useApprovalCard } from "../ApprovalParts.jsx";
import HoldButton from "../HoldButton.jsx";
import BotFace from "../BotFace.jsx";
import RowBoundary from "../RowBoundary.jsx";
import { UndoBar } from "../v3/dia/parts.jsx";
import { NoteAsk } from "../wiki/NoteDiff.jsx";
import { useCountdown } from "./Dots.jsx";
import { ErrorLine, findBot } from "./common.jsx";
import "../../styles/conversation.css";

// Approvals inside the conversation that asked for them (Colmena 4: design/v4 › .need), pinned
// over the composer so they are always in view. The only honey of the conversation: the «Te
// espera» pill and the card's muted amber ground (no glow), one honey element per decision.
//   «Vera pide tu OK · Caduca en 23 min» and the thin timer; what will run in one box («Enviar
//   la nota a 12 contactos», from where, with what) with «Ver detalles ›» for the rest; then
//   «Mantén para enviar» (a red line is held, lib/holdApprove.js) and «No enviar».
// The verbs are the ones every surface uses (lib/approvalCard.js): «Aprobar», «Siempre en
// <app>», «Revisar» and «No permitir» (optionally saying why). A send approved here waits 10 s
// with «Deshacer»; its full text is one click away in Revisar. A typed «sí» in the chat also
// approves the one pending request (server: messages route).
// Several requests of the same kind in a row fold into one card with «Aprobar todas»
// (lib/approvalGroups.js); a red line is never folded. A card that fails to draw becomes one
// muted pill with the way to Revisar (RowBoundary.jsx); the others keep working.
const INLINE = new Set(["permission", "write", "memory", "read"]);
const DEFAULT_WINDOW = 30 * 60e3; // server/state.mjs approvalExpiresAt

/** «Te espera»: the honey pill, the one honey element of the card. */
export function WaitPill() {
  return <span className="v4-pill-wait"><HandPointing size={13} weight="fill" />{"Te espera"}</span>;
}

/** «Caduca en 23 min» and the thin bar of the time left (none when it waits as long as it takes). */
function deadlineOf(a, model) {
  const end = Date.parse(a.autoSendAt || a.expiresAt || "");
  if (Number.isNaN(end) || !model.expiryLine) return { head: null, bar: null };
  const now = Date.now();
  const start = Date.parse(a.createdAt || "");
  const total = !Number.isNaN(start) && end > start ? end - start : DEFAULT_WINDOW;
  const left = Math.max(0, end - now);
  const auto = !!a.autoSendAt;
  const label = left <= 0 ? "Ha caducado" : auto ? `Se envía en ${leftText(left)}` : `Caduca en ${leftText(left)}`;
  const mins = Math.ceil(left / 60e3);
  return {
    head: <span className="exp" title={model.expiryLine.text}>{label}</span>,
    bar: <div className="v4-timer" role="progressbar" aria-label="Tiempo para decidir" aria-valuemin={0} aria-valuemax={Math.ceil(total / 60e3)} aria-valuenow={mins} aria-valuetext={model.expiryLine.text}><i style={{ width: Math.min(100, Math.max(0, (left / total) * 100)) + "%" }} /></div>,
  };
}

/** What will run, in one box: the action, its two key facts, and «Ver detalles ›» for the rest. */
function ActionBox({ a, model, reviewHref }) {
  const [open, setOpen] = useState(false);
  const send = model.send;
  const Icon = send || model.verb === "enviar" ? PaperPlaneRight : ShieldAlert;
  const head = model.send ? model.title : a.summary || a.title || model.title;
  const to = send ? (send.to.length ? send.to.join(", ") + (send.moreTo ? ` y ${send.moreTo} más` : "") : "nadie todavía") : null;
  const facts = send
    ? ["Para " + to, send.copies ? (send.copies === 1 ? "1 en copia" : `${send.copies} en copia`) : null, send.attachments.length ? "adjunta «" + send.attachments.join("», «") + "»" : null].filter(Boolean).join(" · ")
    : model.impact || (a.summary && a.title && a.summary !== a.title ? a.title : "");
  const detail = send ? send.excerpt : model.text && model.text !== head ? model.text : "";
  const hasMore = !!detail || !!model.truncatedLine || !INLINE.has(a.kind);
  return (
    <>
      <div className="v4-action">
        <span className="v4-ftile" aria-hidden="true"><Icon size={18} /></span>
        <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          <span className="a1">{head}</span>
          {facts ? <span className="a2">{facts}</span> : null}
        </span>
        {hasMore ? <button type="button" className="v4-lnk" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Ocultar" : "Ver detalles"}<ChevronRight size={14} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} /></button> : null}
      </div>
      {open ? (
        <div className="v4-need-detail">
          {detail ? <span style={{ display: "block" }}>{send ? `«${detail}»` : detail}</span> : null}
          {model.truncatedLine ? <span style={{ display: "block", marginTop: detail ? "6px" : 0, color: "var(--c-text-3)" }}>{model.truncatedLine}</span> : null}
          {a.wiki ? <NoteAsk id={a.id} wiki={a.wiki} compact /> : null}
          <a href={reviewHref} className="v4-lnk" style={{ marginTop: "6px", padding: 0 }}>{"Abrir en Revisar"}<ArrowUpRight size={13} /></a>
        </div>
      ) : null}
    </>
  );
}

function Row({ a, bots, note = null }) {
  const { act, busy, error } = useAction();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const self = useRef(null);
  const bot = findBot(bots, a.botId);
  const key = "approval:" + a.id;
  // A red line waits 10 s with «Deshacer», as on Inicio; an ordinary request is done at once
  // (the bot is waiting in this very conversation), so it promises no undo.
  const hold = needsHold(a);
  // You asked for this email yourself: it leaves on its own unless you stop it now.
  const leavesIn = useCountdown(a.autoSendAt ? Date.parse(a.autoSendAt) : null);
  const leaving = a.kind === "send" && leavesIn != null && leavesIn > 0;
  const model = useApprovalCard(a, bot.name, { undo: hold && !leaving, excerpt: 600 });
  const { waiting } = useUndoable(key);
  const [failed, setFailed] = useState(null);
  useUndoFailed(key, setFailed);
  const decide = (decision, always = false, why = "") => act(() => leave(self.current, () => post(`/approvals/${a.id}`, { decision, revision: a.revision, ...(always ? { always: true } : {}), ...(why ? { reason: why } : {}) })));
  const approveHeld = () => { setFailed(null); schedule(key, () => post(`/approvals/${a.id}`, { decision: "approved", revision: a.revision })); };
  // Only what this card cannot show in full (a plan, a key, a skill…) is decided in Revisar.
  const review = a.kind !== "send" && !INLINE.has(a.kind);
  const always = model.secondary.find((s) => s.id === "always");
  const denyLabel = model.secondary.find((s) => s.id === "deny")?.label || "No permitir";
  const reviewHref = `/revisar/${encodeURIComponent(a.id)}`;
  const deadline = deadlineOf(a, model);
  const PrimaryIcon = model.verb === "enviar" ? PaperPlaneRight : null;
  const quiet = [model.undoLine].filter(Boolean).join(" ");
  return (
    <section ref={self} id={"aprobacion-" + a.id} aria-labelledby={"aprobacion-t-" + a.id} className="v4-need c-band" style={{ width: "100%" }}>
      <div className="v4-need-h">
        <WaitPill />
        <span className="t" id={"aprobacion-t-" + a.id}><BotFace bot={bot} size={20} state="wait" decorative />{`${bot.name} pide tu OK`}</span>
        {deadline.head}
      </div>
      {deadline.bar}
      <ActionBox a={a} model={model} reviewHref={reviewHref} />
      {/* Not a <form>: this card sits inside the composer, which is one (a nested form never submits). */}
      {denying ? (
        <div role="group" aria-label="Decir que no" className="v4-need-f c-enter">
          <input className="c-quiet" autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setDenying(false); } else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); if (!busy) decide("denied", false, reason.trim()); } }}
            placeholder={`¿Por qué? Se lo diremos a ${bot.name} (opcional)`} aria-label="Por qué no"
            style={{ flex: "1 1 220px", height: "36px", padding: "0 12px", background: "var(--c-raised)", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", fontSize: "var(--t-ui)", color: "var(--c-text)" }} />
          <button type="button" className="v4-btn primary lg" disabled={busy} onClick={() => decide("denied", false, reason.trim())}>{denyLabel}</button>
          <button type="button" className="v4-btn ghost lg" onClick={() => setDenying(false)}>{"Cancelar"}</button>
        </div>
      ) : waiting ? (
        <div className="v4-need-f"><UndoBar id={key} text={model.waitText} onUndo={() => cancel(key)} /></div>
      ) : (
        <div className="v4-need-f">
          {leaving ? (
            <>
              <button type="button" className="v4-btn primary lg" disabled={busy} onClick={() => decide("denied", false, "Cancelado antes de enviarse")}>{"Cancelar envío"}</button>
              <HoldButton className="v4-btn lg" disabled={busy} onConfirm={() => decide("approved")} plainLabel="Enviar ya" fill="rgb(var(--c-ink-rgb) / .14)">{"Mantén para enviar ya"}</HoldButton>
            </>
          ) : review ? (
            <a href={model.primary?.action === "open" ? model.primary.href : reviewHref} className="v4-btn primary lg">{model.primary?.action === "open" ? model.primary.label : "Revisar"}<ArrowUpRight size={14} /></a>
          ) : (
            <>
              {hold
                ? <HoldButton className="v4-btn primary lg" disabled={busy} onConfirm={approveHeld} plainLabel={model.primary.plain} fill="color-mix(in oklab, var(--c-btn-text) 22%, transparent)">{PrimaryIcon ? <PrimaryIcon size={15} /> : null}<span>{model.primary.label}</span></HoldButton>
                : <button type="button" className="v4-btn primary lg" disabled={busy} onClick={() => decide("approved")}>{model.primary.label}</button>}
              <button type="button" className="v4-btn lg" disabled={busy} onClick={() => setDenying(true)}>{denyLabel}</button>
              {always ? <button type="button" className="v4-btn ghost lg" disabled={busy} onClick={() => decide("approved", true)}>{always.label}</button> : null}
            </>
          )}
          {!review && !leaving && !hold ? <span className="note">{"También puedes responder «sí» en el chat"}</span> : quiet ? <span className="note">{quiet}</span> : null}
        </div>
      )}
      {error || failed || note ? <ErrorLine style={{ padding: "0 14px 12px" }}>{error || failed || note}</ErrorLine> : null}
    </section>
  );
}

/**
 * Several requests of the same kind, one after another, as one card: what each one is, and
 * «Aprobar todas», «Ver cada una» (the usual cards, each decided alone — «Siempre» lives
 * there) and «No permitir» for all of them.
 */
function GroupRow({ group, bots }) {
  const { run: refresh } = useStore();
  const { busy, error, run } = useApprovalBatch(group.items, refresh);
  const failures = useBatchFailures();
  const [open, setOpen] = useState(false);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const toggle = useRef(null);
  const moved = useRef(false);
  // «Ver cada una» ↔ «Ver juntas» swap places: the keyboard stays on the one that replaced it.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    toggle.current?.focus();
  }, [open]);
  const flip = () => { moved.current = true; setOpen((v) => !v); };
  const bot = findBot(bots, group.botId);
  const title = groupTitle(group, bot.name);
  const failed = group.items.filter((a) => failures.has(a.id));
  const listed = groupShown(group.items);
  // What could not be decided stays here (or on its own card), with its reason.
  const decide = (decision, why = "") => run(decision, why);
  if (open) {
    return (
      <div role="group" aria-label={title} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "0 6px" }}>
          <span style={{ flex: "1", minWidth: 0, fontSize: "var(--t-meta)", fontWeight: "600", color: "var(--c-text)" }}>{title}</span>
          <button ref={toggle} type="button" className="v4-btn ghost" aria-expanded="true" onClick={flip}>{GROUP_VERBS.together}</button>
        </div>
        {group.items.map((a) => <Row key={a.id} a={a} bots={bots} note={failures.get(a.id) || null} />)}
      </div>
    );
  }
  return (
    <section role="group" aria-label={title} className="v4-need c-band" style={{ width: "100%" }}>
      <div className="v4-need-h">
        <WaitPill />
        <span className="t"><BotFace bot={bot} size={20} state="wait" decorative />{`${bot.name} pide tu OK`}</span>
      </div>
      <div className="v4-action" style={{ marginTop: 0, alignItems: "flex-start" }}>
        <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          <span className="a1">{title}</span>
          <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "2px" }}>
            {listed.shown.map((a) => (
              <li key={a.id} className="a2" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupLine(a, bot.name, group.label)}</span>
                {failures.has(a.id) ? <span style={{ color: "var(--c-error)" }}>{failures.get(a.id)}</span> : null}
              </li>
            ))}
            {listed.more ? <li className="a2">{`y ${listed.more} más`}</li> : null}
          </ul>
        </span>
      </div>
      {denying ? (
        <div role="group" aria-label="Decir que no" className="v4-need-f c-enter">
          <input className="c-quiet" autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setDenying(false); } else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); if (!busy) decide("denied", reason.trim()); } }}
            placeholder={`¿Por qué? Se lo diremos a ${bot.name} (opcional)`} aria-label="Por qué no"
            style={{ flex: "1 1 220px", height: "36px", padding: "0 12px", background: "var(--c-raised)", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", fontSize: "var(--t-ui)", color: "var(--c-text)" }} />
          <button type="button" className="v4-btn primary lg" disabled={busy} onClick={() => decide("denied", reason.trim())}>{GROUP_VERBS.deny}</button>
          <button type="button" className="v4-btn ghost lg" onClick={() => setDenying(false)}>{"Cancelar"}</button>
        </div>
      ) : (
        <div className="v4-need-f">
          <button type="button" className="v4-btn primary lg" disabled={busy} onClick={() => decide("approved")}>{failed.length ? GROUP_VERBS.retry : GROUP_VERBS.approve}</button>
          <button ref={toggle} type="button" className="v4-btn lg" aria-expanded="false" onClick={flip}>{GROUP_VERBS.each}</button>
          <button type="button" className="v4-btn ghost lg" disabled={busy} onClick={() => setDenying(true)}>{GROUP_VERBS.deny}</button>
        </div>
      )}
      {error ? <ErrorLine style={{ padding: "0 14px 12px" }}>{error}</ErrorLine> : null}
    </section>
  );
}

/** The pending approvals of this conversation that can be decided right here. */
export default function InlineApprovals({ approvals = [], bots = [] }) {
  const failures = useBatchFailures();
  const list = approvals.filter((a) => a.status === "pending" && a.kind !== "question" && a.kind !== "plan" && a.kind !== "secret" && a.kind !== "skill" && a.kind !== "soul");
  if (!list.length) return null;
  const entries = groupApprovals(list);
  const shown = entries.slice(0, 3);
  const more = list.length - shown.reduce((n, e) => n + (e.type === "group" ? e.items.length : 1), 0);
  return (
    <section aria-label="Necesitan tu OK" style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "0 0 10px" }}>
      {shown.map((e) => (e.type === "group"
        ? <RowBoundary key={e.id} label="No se han podido mostrar estas peticiones" resetKey={e.id + ":" + e.items.length}><GroupRow group={e} bots={bots} /></RowBoundary>
        : <RowBoundary key={e.a.id} label="No se ha podido mostrar esta petición" action={{ href: `/revisar/${encodeURIComponent(e.a.id)}`, text: "Abrir en Revisar" }} resetKey={e.a.revision}><Row a={e.a} bots={bots} note={failures.get(e.a.id) || null} /></RowBoundary>))}
      {more > 0 ? <a href="/" style={{ fontSize: "var(--t-meta)", fontWeight: "600", color: "var(--c-accent-ink)" }}>{`Y ${more} más en Inicio`}</a> : null}
    </section>
  );
}
