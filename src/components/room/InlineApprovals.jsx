import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import { post } from "../../lib/api.js";
import { useAction, useStore } from "../../lib/store.jsx";
import { leave } from "../../lib/motion.js";
import { groupApprovals, groupLine, groupShown, groupTitle } from "../../lib/approvalGroups.js";
import { needsHold } from "../../lib/holdApprove.js";
import { GROUP_VERBS } from "../../lib/approvalCard.js";
import { cancel, schedule, useUndoFailed, useUndoable } from "../../lib/undoable.js";
import { useApprovalBatch, useBatchFailures } from "../../lib/useApprovalBatch.js";
import { ApprovalNotes, SendWhat, useApprovalCard } from "../ApprovalParts.jsx";
import HoldButton from "../HoldButton.jsx";
import RowBoundary from "../RowBoundary.jsx";
import { UndoBar } from "../v3/dia/parts.jsx";
import { NoteAsk } from "../wiki/NoteDiff.jsx";
import { useCountdown } from "./Dots.jsx";
import { BotAvatar, ErrorLine, findBot } from "./common.jsx";

// Approvals inside the conversation that asked for them (OpenClaw inline approvals): a
// compact row per request above the composer: what, for whom, and what happens if nobody
// decides. The verbs are the ones every surface uses (lib/approvalCard.js): «Aprobar»,
// «Siempre en <app>», «Revisar» and «No permitir» (optionally saying why). A send says who it
// goes to and its subject and is approved by holding «Mantén para enviar», then waits 10 s
// with «Deshacer»; its full text is one click away in Revisar. A typed «sí» in the chat also
// approves the one pending request (server: messages route).
// Several requests of the same kind in a row fold into one row with «Aprobar todas»
// (lib/approvalGroups.js); a red line is never folded. A row that fails to draw becomes one
// muted pill with the way to Revisar (RowBoundary.jsx); the others keep working.
const INLINE = new Set(["permission", "write", "memory", "read"]);
const I = { size: 14, strokeWidth: 2.3, "aria-hidden": "true" };

const BTN = { height: "38px", padding: "0 16px", borderRadius: "var(--r-pill)", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: "600", whiteSpace: "nowrap", border: "0" };
const BAND = { display: "flex", flexDirection: "column", gap: "12px", padding: "16px 18px", background: "var(--c-card)", borderRadius: "var(--r-2xl)", boxShadow: "0 0 0 1px rgba(255,201,60,.6), 0 0 0 6px rgba(255,201,60,.14), 0 20px 40px -24px rgba(201,138,0,.55)" };

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
  const model = useApprovalCard(a, bot.name, { undo: hold && !leaving, excerpt: 160 });
  const { waiting } = useUndoable(key);
  const [failed, setFailed] = useState(null);
  useUndoFailed(key, setFailed);
  const decide = (decision, always = false, why = "") => act(() => leave(self.current, () => post(`/approvals/${a.id}`, { decision, revision: a.revision, ...(always ? { always: true } : {}), ...(why ? { reason: why } : {}) })));
  const approveHeld = () => { setFailed(null); schedule(key, () => post(`/approvals/${a.id}`, { decision: "approved", revision: a.revision })); };
  // Only what this row cannot show in full (a plan, a key, a skill…) is decided in Revisar.
  const review = a.kind !== "send" && !INLINE.has(a.kind);
  const btn = BTN;
  const always = model.secondary.find((s) => s.id === "always");
  const denyLabel = model.secondary.find((s) => s.id === "deny")?.label || "No permitir";
  const reviewHref = `/revisar/${encodeURIComponent(a.id)}`;
  return (
    <div ref={self} id={"aprobacion-" + a.id} role="group" aria-label={`${bot.name} pide permiso: ${model.title}`} className="c-band" style={BAND}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <BotAvatar bot={bot} size={28} state="wait" />
        <div style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
            <strong style={{ color: "var(--c-text)", fontWeight: "600" }}>{bot.name}</strong>
            {a.redLine || a.kind === "send" ? <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "var(--r-pill)", background: "var(--c-error-soft)", color: "var(--c-error)", fontSize: "var(--t-caption)", fontWeight: "600" }}><ShieldAlert {...I} size={12} />sale de tu cuenta</span> : <span>{"· necesita tu OK"}</span>}
          </span>
          <span style={{ fontSize: "var(--t-body)", lineHeight: "1.45", color: "var(--c-text)" }}>{model.send ? model.title : a.summary || a.title}</span>
          {/* A send says who it goes to and what it says before it can be approved here. */}
          {model.send ? <SendWhat send={model.send} subject={!model.send.subject} size="var(--t-ui)" /> : null}
          {!model.send && model.impact ? <span style={{ fontSize: "var(--t-meta)", lineHeight: "1.4", color: "var(--c-error)" }}>{model.impact}</span> : null}
          {/* A note of «Notas» the bot wants to write: which one, and its changes behind «Ver los cambios». */}
          {a.wiki ? <NoteAsk id={a.id} wiki={a.wiki} compact /> : null}
        </div>
      </div>
      {/* Not a <form>: this card can sit inside the composer, which is one (a nested form never submits). */}
      {denying ? (
        <div role="group" aria-label="Decir que no" className="c-enter" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", paddingLeft: "40px" }}>
          <input className="c-quiet" autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setDenying(false); } else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); if (!busy) decide("denied", false, reason.trim()); } }}
            placeholder={`¿Por qué? Se lo diremos a ${bot.name} (opcional)`} aria-label="Por qué no"
            style={{ flex: "1 1 220px", height: "38px", padding: "0 14px", background: "var(--c-sunken)", border: "0", borderRadius: "var(--r-pill)", fontSize: "var(--t-ui)" }} />
          <button type="button" disabled={busy} onClick={() => decide("denied", false, reason.trim())} style={{ ...btn, background: "var(--c-btn)", color: "var(--c-btn-text)" }}>{denyLabel}</button>
          <button type="button" onClick={() => setDenying(false)} style={{ ...btn, background: "transparent", fontWeight: "500", color: "var(--c-text-3)" }}>Cancelar</button>
        </div>
      ) : waiting ? (
        <div style={{ display: "flex", paddingLeft: "40px" }}><UndoBar id={key} text={model.waitText} onUndo={() => cancel(key)} /></div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", paddingLeft: "40px" }}>
          {leaving ? (
            <>
              <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("denied", false, "Cancelado antes de enviarse")} style={{ ...btn, background: "var(--c-btn)", color: "var(--c-btn-text)" }}>Cancelar envío</button>
              <HoldButton className="rm-focus" disabled={busy} onConfirm={() => decide("approved")} plainLabel="Enviar ya" fill="rgba(18,19,26,.14)" style={{ ...btn, background: "rgb(var(--c-ink-rgb) / .06)", color: "var(--c-text)" }}>Mantén para enviar ya</HoldButton>
              <a href={reviewHref} className="rm-focus" style={{ ...btn, display: "inline-flex", alignItems: "center", gap: "6px", background: "transparent", color: "var(--c-text-3)", fontWeight: "500", textDecoration: "none" }}>Revisar<ArrowUpRight {...I} /></a>
            </>
          ) : review ? (
            <a href={model.primary?.action === "open" ? model.primary.href : reviewHref} className="rm-focus" style={{ ...btn, display: "inline-flex", alignItems: "center", gap: "6px", background: "var(--c-btn)", color: "var(--c-btn-text)", textDecoration: "none" }}>{model.primary?.action === "open" ? model.primary.label : "Revisar"}<ArrowUpRight {...I} /></a>
          ) : (
            <>
              {hold
                ? <HoldButton className="rm-focus" disabled={busy} onConfirm={approveHeld} plainLabel={model.primary.plain} style={{ ...btn, background: "var(--c-btn)", color: "var(--c-btn-text)" }}>{model.primary.label}</HoldButton>
                : <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("approved")} style={{ ...btn, background: "var(--c-btn)", color: "var(--c-btn-text)" }}>{model.primary.label}</button>}
              {always ? <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("approved", true)} style={{ ...btn, background: "rgb(var(--c-ink-rgb) / .06)", color: "var(--c-text)" }}>{always.label}</button> : null}
              <a href={reviewHref} className="rm-focus" style={{ ...btn, display: "inline-flex", alignItems: "center", gap: "6px", background: "rgb(var(--c-ink-rgb) / .06)", color: "var(--c-text)", textDecoration: "none" }}>Revisar<ArrowUpRight {...I} /></a>
              <button type="button" className="rm-focus" disabled={busy} onClick={() => setDenying(true)} style={{ ...btn, background: "transparent", fontWeight: "500", color: "var(--c-text-3)" }}>{denyLabel}</button>
            </>
          )}
          {!review && !leaving && !hold ? <span style={{ marginLeft: "auto", fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{"También puedes responder «sí» en el chat"}</span> : null}
        </div>
      )}
      {/* The undo window (where there is one) and what happens if nobody decides in time. */}
      {denying || waiting ? null : <ApprovalNotes model={model} style={{ paddingLeft: "40px" }} />}
      <ErrorLine style={{ paddingLeft: "40px" }}>{error || failed || note}</ErrorLine>
    </div>
  );
}

/**
 * Several requests of the same kind, one after another, as one row: what each one is, and
 * «Aprobar todas», «Ver cada una» (the usual rows, each decided alone — «Siempre» lives
 * there) and «Ahora no» for all of them.
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
  // What could not be decided stays here (or on its own row), with its reason.
  const decide = (decision, why = "") => run(decision, why);
  const soft = { ...BTN, background: "rgb(var(--c-ink-rgb) / .06)", color: "var(--c-text)" };
  if (open) {
    return (
      <div role="group" aria-label={title} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "0 6px" }}>
          <span style={{ flex: "1", minWidth: 0, fontSize: "var(--t-meta)", fontWeight: "600", color: "var(--c-text)" }}>{title}</span>
          <button ref={toggle} type="button" className="rm-focus" aria-expanded="true" onClick={flip} style={{ ...BTN, height: "32px", padding: "0 12px", fontSize: "var(--t-meta)", background: "transparent", fontWeight: "500", color: "var(--c-text-3)" }}>{GROUP_VERBS.together}</button>
        </div>
        {group.items.map((a) => <Row key={a.id} a={a} bots={bots} note={failures.get(a.id) || null} />)}
      </div>
    );
  }
  return (
    <div role="group" aria-label={title} className="c-band" style={BAND}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <BotAvatar bot={bot} size={28} state="wait" />
        <div style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
            <strong style={{ color: "var(--c-text)", fontWeight: "600" }}>{bot.name}</strong>
            <span>{"· necesita tu OK"}</span>
          </span>
          <span style={{ fontSize: "var(--t-body)", lineHeight: "1.45", color: "var(--c-text)" }}>{title}</span>
          <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
            {listed.shown.map((a) => (
              <li key={a.id} style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--t-ui)", lineHeight: "1.4", color: "var(--c-text-2)" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupLine(a, bot.name, group.label)}</span>
                {failures.has(a.id) ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{failures.get(a.id)}</span> : null}
              </li>
            ))}
            {listed.more ? <li style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{`y ${listed.more} más`}</li> : null}
          </ul>
        </div>
      </div>
      {denying ? (
        <div role="group" aria-label="Decir que no" className="c-enter" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", paddingLeft: "40px" }}>
          <input className="c-quiet" autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setDenying(false); } else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); if (!busy) decide("denied", reason.trim()); } }}
            placeholder={`¿Por qué? Se lo diremos a ${bot.name} (opcional)`} aria-label="Por qué no"
            style={{ flex: "1 1 220px", height: "38px", padding: "0 14px", background: "var(--c-sunken)", border: "0", borderRadius: "var(--r-pill)", fontSize: "var(--t-ui)" }} />
          <button type="button" disabled={busy} onClick={() => decide("denied", reason.trim())} style={{ ...BTN, background: "var(--c-btn)", color: "var(--c-btn-text)" }}>{GROUP_VERBS.deny}</button>
          <button type="button" onClick={() => setDenying(false)} style={{ ...BTN, background: "transparent", fontWeight: "500", color: "var(--c-text-3)" }}>Cancelar</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", paddingLeft: "40px" }}>
          <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("approved")} style={{ ...BTN, background: "var(--c-btn)", color: "var(--c-btn-text)" }}>{failed.length ? GROUP_VERBS.retry : GROUP_VERBS.approve}</button>
          <button ref={toggle} type="button" className="rm-focus" aria-expanded="false" onClick={flip} style={soft}>{GROUP_VERBS.each}</button>
          <button type="button" className="rm-focus" disabled={busy} onClick={() => setDenying(true)} style={{ ...BTN, background: "transparent", fontWeight: "500", color: "var(--c-text-3)" }}>{GROUP_VERBS.deny}</button>
        </div>
      )}
      <ErrorLine style={{ paddingLeft: "40px" }}>{error}</ErrorLine>
    </div>
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
    <section aria-label="Necesitan tu OK" style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "0 0 10px" }}>
      {shown.map((e) => (e.type === "group"
        ? <RowBoundary key={e.id} label="No se han podido mostrar estas peticiones" resetKey={e.id + ":" + e.items.length}><GroupRow group={e} bots={bots} /></RowBoundary>
        : <RowBoundary key={e.a.id} label="No se ha podido mostrar esta petición" action={{ href: `/revisar/${encodeURIComponent(e.a.id)}`, text: "Abrir en Revisar" }} resetKey={e.a.revision}><Row a={e.a} bots={bots} note={failures.get(e.a.id) || null} /></RowBoundary>))}
      {more > 0 ? <a href="/" style={{ fontSize: "var(--t-meta)", fontWeight: "600", color: "var(--c-accent-ink)" }}>{`Y ${more} más en Hoy`}</a> : null}
    </section>
  );
}
