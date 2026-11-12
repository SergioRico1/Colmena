import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import { post } from "../../lib/api.js";
import { useAction, useStore } from "../../lib/store.jsx";
import { leave } from "../../lib/motion.js";
import { groupApprovals, groupLine, groupShown, groupTitle } from "../../lib/approvalGroups.js";
import { needsHold } from "../../lib/holdApprove.js";
import { useApprovalBatch, useBatchFailures } from "../../lib/useApprovalBatch.js";
import HoldButton from "../HoldButton.jsx";
import RowBoundary from "../RowBoundary.jsx";
import { useCountdown } from "./Dots.jsx";
import { BotAvatar, ErrorLine, findBot } from "./common.jsx";

// Approvals inside the conversation that asked for them (OpenClaw inline approvals): a
// compact row per request above the composer — what, for whom, how long it waits — with
// «Sí, hazlo», «Siempre en <app>» and «Ahora no» (optionally saying why), in plain words —
// like asking a colleague. Only a send opens Revisar, to read and edit it in full. A typed
// «sí» in the chat also approves the one pending request (server: messages route).
// Several requests of the same kind in a row fold into one row with «Aprobar todas»
// (lib/approvalGroups.js); a red line is never folded, and its «Sí, hazlo» is held to approve
// (HoldButton.jsx). A row that fails to draw becomes one muted pill with the way to Revisar
// (RowBoundary.jsx); the others keep working.
const INLINE = new Set(["permission", "write", "memory", "read"]);
const I = { size: 14, strokeWidth: 2.3, "aria-hidden": "true" };

/** «caduca en 12 min» (red under 2 min, OpenClaw's urgent threshold). */
export function ExpiryChip({ expiresAt, style }) {
  const left = useCountdown(expiresAt ? Date.parse(expiresAt) : null);
  if (left == null) return null;
  const urgent = left < 120;
  const text = left === 0 ? "caducada" : left < 60 ? `caduca en ${left} s` : `caduca en ${Math.ceil(left / 60)} min`;
  return <span role="timer" aria-label={text} style={{ font: "500 11px/1 'Geist Mono', monospace", padding: "4px 7px", borderRadius: "5px", background: urgent ? "#FBE7DF" : "#F7F8FA", color: urgent ? "#B4372A" : "#555A68", border: "1px solid " + (urgent ? "#F1B5B7" : "#E6E8EE"), whiteSpace: "nowrap", ...style }}>{text}</span>;
}

const BTN = { height: "38px", padding: "0 16px", borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: "600", whiteSpace: "nowrap", border: "0" };
const BAND = { display: "flex", flexDirection: "column", gap: "12px", padding: "16px 18px", background: "#FFFFFF", borderRadius: "24px", boxShadow: "0 0 0 1px rgba(255,201,60,.6), 0 0 0 6px rgba(255,201,60,.14), 0 20px 40px -24px rgba(201,138,0,.55)" };

function Row({ a, bots, note = null }) {
  const { act, busy, error } = useAction();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const self = useRef(null);
  const bot = findBot(bots, a.botId);
  const decide = (decision, always = false, why = "") => act(() => leave(self.current, () => post(`/approvals/${a.id}`, { decision, revision: a.revision, ...(always ? { always: true } : {}), ...(why ? { reason: why } : {}) })));
  // A send is read and edited in full in Revisar; everything else is decided right here.
  const review = a.kind === "send" || !INLINE.has(a.kind);
  const btn = BTN;
  // A red line is approved by holding the button, never by a stray click.
  const hold = needsHold(a);
  const always = a.app ? `Siempre en ${a.app}` : `Siempre a ${bot.name}`;
  // You asked for this email yourself: it leaves on its own unless you stop it now.
  const leavesIn = useCountdown(a.autoSendAt ? Date.parse(a.autoSendAt) : null);
  const leaving = a.kind === "send" && leavesIn != null && leavesIn > 0;
  return (
    <div ref={self} id={"aprobacion-" + a.id} role="group" aria-label={`${bot.name} pide permiso: ${a.title}`} className="c-band" style={BAND}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <BotAvatar bot={bot} size={28} state="wait" />
        <div style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", fontSize: "13px", color: "#6B6F7A" }}>
            <strong style={{ color: "#12131A", fontWeight: "600" }}>{bot.name}</strong>
            {a.redLine ? <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "999px", background: "#FBEAE7", color: "#B4372A", fontSize: "12px", fontWeight: "600" }}><ShieldAlert {...I} size={12} />sale de tu cuenta</span> : <span>{"· necesita tu OK"}</span>}
          </span>
          <span style={{ fontSize: "15px", lineHeight: "1.45", color: "#12131A" }}>{a.summary || a.title}</span>
          {a.redLine && a.impact?.headline ? <span style={{ fontSize: "13px", lineHeight: "1.4", color: "#8F1D22" }}>{a.impact.headline}</span> : null}
        </div>
        <ExpiryChip expiresAt={a.expiresAt} />
      </div>
      {denying ? (
        <form className="c-enter" onSubmit={(e) => { e.preventDefault(); decide("denied", false, reason.trim()); }} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", paddingLeft: "40px" }}>
          <input className="c-quiet" autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setDenying(false); } }}
            placeholder={`¿Por qué? Se lo diremos a ${bot.name} (opcional)`} aria-label="Por qué no"
            style={{ flex: "1 1 220px", height: "38px", padding: "0 14px", background: "#F4F4F0", border: "0", borderRadius: "999px", fontSize: "14px" }} />
          <button type="submit" disabled={busy} style={{ ...btn, background: "#12131A", color: "#FFFFFF" }}>No lo hagas</button>
          <button type="button" onClick={() => setDenying(false)} style={{ ...btn, background: "transparent", fontWeight: "500", color: "#5C606C" }}>Cancelar</button>
        </form>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", paddingLeft: "40px" }}>
          {leaving ? (
            <>
              <span role="timer" style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 14px", borderRadius: "999px", background: "#F4F4F0", fontSize: "14px", fontWeight: "600" }}>
                <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#0B8A5F", animation: "halo 1.8s ease-out infinite" }} />
                {`Lo pediste tú · se envía en ${leavesIn} s`}
              </span>
              <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("denied", false, "Cancelado antes de enviarse")} style={{ ...btn, background: "#12131A", color: "#FFFFFF" }}>Cancelar envío</button>
              <HoldButton className="rm-focus" disabled={busy} onConfirm={() => decide("approved")} fill="rgba(18,19,26,.14)" style={{ ...btn, background: "rgba(18,19,26,.06)", color: "#12131A" }}>Enviar ya</HoldButton>
              <a href={`/revisar/${encodeURIComponent(a.id)}`} className="rm-focus" style={{ ...btn, display: "inline-flex", alignItems: "center", gap: "6px", background: "transparent", color: "#5C606C", fontWeight: "500", textDecoration: "none" }}>Revisarlo<ArrowUpRight {...I} /></a>
            </>
          ) : review ? (
            <a href={`/revisar/${encodeURIComponent(a.id)}`} className="rm-focus" style={{ ...btn, display: "inline-flex", alignItems: "center", gap: "6px", background: "#12131A", color: "#FFFFFF", textDecoration: "none" }}>Revisarlo<ArrowUpRight {...I} /></a>
          ) : (
            <>
              {hold
                ? <HoldButton className="rm-focus" disabled={busy} onConfirm={() => decide("approved")} style={{ ...btn, background: "#12131A", color: "#FFFFFF" }}>Sí, hazlo</HoldButton>
                : <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("approved")} style={{ ...btn, background: "#12131A", color: "#FFFFFF" }}>Sí, hazlo</button>}
              {a.canAlways && !a.redLine ? <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("approved", true)} style={{ ...btn, background: "rgba(18,19,26,.06)", color: "#12131A" }}>{always}</button> : null}
              <button type="button" className="rm-focus" disabled={busy} onClick={() => setDenying(true)} style={{ ...btn, background: "transparent", fontWeight: "500", color: "#5C606C" }}>Ahora no</button>
            </>
          )}
          {!review && !leaving && !hold ? <span style={{ marginLeft: "auto", fontSize: "12px", color: "#6B6F7A" }}>{"También puedes responder «sí» en el chat"}</span> : null}
        </div>
      )}
      <ErrorLine style={{ paddingLeft: "40px" }}>{error || note}</ErrorLine>
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
  const soft = { ...BTN, background: "rgba(18,19,26,.06)", color: "#12131A" };
  if (open) {
    return (
      <div role="group" aria-label={title} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "0 6px" }}>
          <span style={{ flex: "1", minWidth: 0, fontSize: "13px", fontWeight: "600", color: "#12131A" }}>{title}</span>
          <button ref={toggle} type="button" className="rm-focus" aria-expanded="true" onClick={flip} style={{ ...BTN, height: "32px", padding: "0 12px", fontSize: "13px", background: "transparent", fontWeight: "500", color: "#5C606C" }}>Ver juntas</button>
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
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", fontSize: "13px", color: "#6B6F7A" }}>
            <strong style={{ color: "#12131A", fontWeight: "600" }}>{bot.name}</strong>
            <span>{"· necesita tu OK"}</span>
          </span>
          <span style={{ fontSize: "15px", lineHeight: "1.45", color: "#12131A" }}>{title}</span>
          <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
            {listed.shown.map((a) => (
              <li key={a.id} style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "14px", lineHeight: "1.4", color: "#3D404A" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupLine(a, bot.name, group.label)}</span>
                {failures.has(a.id) ? <span style={{ fontSize: "13px", color: "#B4372A" }}>{failures.get(a.id)}</span> : null}
              </li>
            ))}
            {listed.more ? <li style={{ fontSize: "13px", color: "#6B6F7A" }}>{`y ${listed.more} más`}</li> : null}
          </ul>
        </div>
      </div>
      {denying ? (
        <form className="c-enter" onSubmit={(e) => { e.preventDefault(); decide("denied", reason.trim()); }} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", paddingLeft: "40px" }}>
          <input className="c-quiet" autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setDenying(false); } }}
            placeholder={`¿Por qué? Se lo diremos a ${bot.name} (opcional)`} aria-label="Por qué no"
            style={{ flex: "1 1 220px", height: "38px", padding: "0 14px", background: "#F4F4F0", border: "0", borderRadius: "999px", fontSize: "14px" }} />
          <button type="submit" disabled={busy} style={{ ...BTN, background: "#12131A", color: "#FFFFFF" }}>No lo hagas</button>
          <button type="button" onClick={() => setDenying(false)} style={{ ...BTN, background: "transparent", fontWeight: "500", color: "#5C606C" }}>Cancelar</button>
        </form>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", paddingLeft: "40px" }}>
          <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("approved")} style={{ ...BTN, background: "#12131A", color: "#FFFFFF" }}>{failed.length ? "Reintentar todas" : "Aprobar todas"}</button>
          <button ref={toggle} type="button" className="rm-focus" aria-expanded="false" onClick={flip} style={soft}>Ver cada una</button>
          <button type="button" className="rm-focus" disabled={busy} onClick={() => setDenying(true)} style={{ ...BTN, background: "transparent", fontWeight: "500", color: "#5C606C" }}>Ahora no</button>
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
      {more > 0 ? <a href="/" style={{ fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>{`Y ${more} más en Hoy`}</a> : null}
    </section>
  );
}
